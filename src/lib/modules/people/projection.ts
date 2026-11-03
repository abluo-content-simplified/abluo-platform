// ── People module — the ONE public projection of a person (ADR-043 D5) ─────────
//
// Every website query that reads a `person` — a team section, a post's authors,
// an event's hosts, a profile page, the sitemap — projects it with
// PERSON_PUBLIC_FIELDS and nothing else. A test
// (src/lib/modules/people/__tests__/projection.test.ts) scans the website
// queries and fails on any person projection that is not exactly this one.
//
// What is NOT here, on purpose: the Sanity `_id`, `projectSlug`, `sortOrder`
// (order is applied in GROQ), `anonymisedAt` (anonymised people are filtered
// out, never rendered), `archivedBy`, `redirectFrom` (only the slug lookup
// reads it), translation status, and anything private — private contacts,
// birthday and notes live in Supabase person_private and never reach Sanity.
//
// Visibility (ADR-043 D4), as GROQ conditions on the person document:
//   PERSON_RENDERABLE — visibility is not "off" and not anonymised. Used by
//                       placements that NAME a person (post authors, event
//                       hosts): an archived person is still shown there.
//   PERSON_LISTABLE   — renderable and not archived. Used by team listings
//                       (hand-picked or by group) and the people index.
//   PERSON_HAS_PAGE   — listable, visibility "page". Own profile page.
//
// Needs $locale, $defaultLocale and $projectSlug, like every website query.
// (No backticks in the GROQ comments: these are JS template literals.)

import { publicFilterForAnyType } from '@/lib/lifecycle/public-types'
import type { PortableTextContent, ResolvedImage } from '@/lib/sanity/types'
import type { PersonContactKind, PersonVisibility } from './model'

export { personDisplayName, personFullName, personInitials } from './model'

const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}[$defaultLocale], ${field}.en, select(!defined(${field}._type) => ${field}))`

/** Visibility conditions — see the header. `p` is an accessor prefix ('' or '@->'). */
export const PERSON_RENDERABLE = /* groq */ `(coalesce(visibility, "listed") != "off" && !defined(anonymisedAt))`
export const PERSON_LISTABLE = /* groq */ `(${PERSON_RENDERABLE} && !defined(archivedAt))`
export const PERSON_HAS_PAGE = /* groq */ `(${PERSON_LISTABLE} && visibility == "page")`

/** The global site order (D6): sortOrder, then last and first name. */
export const PERSON_ORDER = /* groq */ `order(coalesce(sortOrder, 999999) asc, lower(lastName) asc, lower(firstName) asc)`

// The long bio: restricted rich text whose internal links are dereferenced the
// same way as article bodies (plain text when the target is not public).
const BIO = /* groq */ `(${loc('bio')})[]{
      ...,
      markDefs[]{
        ...,
        _type == "link" && defined(internal._ref) => {
          "internalTarget": internal->{
            _type, pageType, projectSlug,
            "slug": slug[$locale].current,
            "live": ${publicFilterForAnyType()},
            hasPage,
            "segment": select(string::startsWith(_type, "catalogue") => *[_type == "project" && projectSlug == $projectSlug][0].moduleInstallations[moduleId == "catalogue" && enabled != false][0].config.publicSegment)
          }
        }
      }
    }`

export const PERSON_PUBLIC_FIELDS = /* groq */ `
    publicId,
    firstName,
    lastName,
    displayName,
    "honorific": ${loc('honorific')},
    "jobTitle": ${loc('jobTitle')},
    groups,
    "photo": select(photo->projectSlug == $projectSlug => photo->{
      "asset": image.asset,
      "hotspot": image.hotspot,
      "crop": image.crop,
      "alt": ${loc('altText')},
      "lqip": image.asset->metadata.lqip,
      "dimensions": image.asset->metadata.dimensions { width, height, aspectRatio }
    }),
    "shortBio": ${loc('shortBio')},
    "bio": ${BIO},
    languages,
    website,
    contacts[] { _key, kind, value, label, preferred },
    qualifications[] { _key, "title": ${loc('title')}, issuer, issuedOn, expiresOn },
    "visibility": coalesce(visibility, "listed"),
    "archived": defined(archivedAt),
    "hasPage": ${PERSON_HAS_PAGE} && defined(slug[$locale].current),
    "slug": { "current": slug[$locale].current },
    legacyAnchors
`

/**
 * A placement's people, in the editor's order, dereferenced and filtered.
 * `listing` = a team listing (archived people left out); otherwise a placement
 * that names people (authors, hosts) and keeps archived ones (D4).
 * The projectSlug condition keeps a hand-edited reference to another website's
 * person from rendering; dangling references (deleted, draft-only) drop out.
 */
export function personRefsProjection(field: string, mode: 'listing' | 'named'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new Error(`personRefsProjection: bad field "${field}"`)
  const rule = mode === 'listing' ? PERSON_LISTABLE : PERSON_RENDERABLE
  return /* groq */ `(${field}[]->)[_type == "person" && projectSlug == $projectSlug && ${rule}]{ ${PERSON_PUBLIC_FIELDS} }`
}

// ── TypeScript shape of PERSON_PUBLIC_FIELDS ─────────────────────────────────

export interface PersonPublicContact {
  _key: string
  kind: PersonContactKind
  value: string
  label?: string | null
  preferred?: boolean | null
}

export interface PersonPublicQualification {
  _key: string
  title?: string | null
  issuer?: string | null
  /** YYYY-MM-DD */
  issuedOn?: string | null
  /** YYYY-MM-DD */
  expiresOn?: string | null
}

export type PersonPublicPhoto = ResolvedImage & {
  lqip?: string | null
  dimensions?: { width?: number; height?: number; aspectRatio?: number } | null
}

/** A person as every website query returns it (locale-resolved). */
export interface PersonPublic {
  publicId: string
  firstName?: string | null
  lastName?: string | null
  displayName?: string | null
  honorific?: string | null
  jobTitle?: string | null
  /** Stable group keys (Categories & Tags, module "people"). */
  groups?: string[] | null
  photo?: PersonPublicPhoto | null
  shortBio?: string | null
  /** Restricted rich text with resolved internal link targets. */
  bio?: PortableTextContent | null
  /** ISO 639-1 codes. */
  languages?: string[] | null
  website?: string | null
  /** PUBLIC contact methods only. Emails must be obfuscated by the renderer (D7). */
  contacts?: PersonPublicContact[] | null
  qualifications?: PersonPublicQualification[] | null
  visibility: PersonVisibility
  /** Archived: shown where content names them, never in listings, no own page. */
  archived: boolean
  /** Has an own profile page in the request language. */
  hasPage: boolean
  /** The slug in the request language (no fallback — routing), null when none. */
  slug: { current?: string | null }
  /** anchorIds of migrated team members. */
  legacyAnchors?: string[] | null
}

/** Top-level keys of PERSON_PUBLIC_FIELDS — the whitelist the projection test enforces. */
export const PERSON_PUBLIC_KEYS = [
  'publicId',
  'firstName',
  'lastName',
  'displayName',
  'honorific',
  'jobTitle',
  'groups',
  'photo',
  'shortBio',
  'bio',
  'languages',
  'website',
  'contacts',
  'qualifications',
  'visibility',
  'archived',
  'hasPage',
  'slug',
  'legacyAnchors',
] as const satisfies readonly (keyof PersonPublic)[]
