// ── Digital Cards module — the ONE public projection of a card (ADR-049) ──────
//
// Every website read of a `digitalCard` (the /link pages, the vCard routes, the
// hit endpoint's id check) filters it with DIGITAL_CARD_PUBLIC — this
// project's, published (never a draft), not archived, not unpublished
// (publicFilterFor('digitalCard'), ADR-032) — and projects it with the
// fragments below. The public-delivery coverage test scans queries.ts.
//
// What is NOT here, on purpose: the Sanity _id, projectSlug, retiredUrlNames
// (only the retired-name lookup reads it), lifecycle dates, hidden links.
// The person comes ONLY through PERSON_PUBLIC_FIELDS (People, ADR-043 D5) and
// only while listable (not off, not anonymised, not archived — D6); nothing
// private (person_private) is ever read.
//
// Site data (logo, name, contacts, socials, locations) is READ from
// siteConfig (D3) — the card stores switches only. Contacts in the result are
// PLAIN: the renderer must encode them with encodeContact() before they reach
// the HTML (D9), and must apply the card's `show` switches (resolveShow()).
//
// Needs $projectSlug, $locale and $defaultLocale, like every website query.
// (No backticks in the GROQ comments: these are JS template literals.)

import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { PERSON_LISTABLE, PERSON_PUBLIC_FIELDS, type PersonPublic, type PersonPublicPhoto } from '@/lib/modules/people/projection'
import type { BusinessLocation, ResolvedImage, SocialLink } from '@/lib/sanity/types'
import { NAV_CATALOGUE_TARGET_FIELDS, NAV_CATALOGUE_TARGET_FILTER } from '@/lib/modules/catalogue/nav-target-groq'
import type { CatalogueNavTarget } from '@/lib/modules/catalogue/nav-target'
import { DIGITAL_CARD_TYPE, type DigitalCardKind, type DigitalCardLinkKind, type DigitalCardNameMode } from './model'

const loc = (field: string) =>
  `coalesce(${field}[$locale], ${field}[$defaultLocale], ${field}.en, select(!defined(${field}._type) => ${field}))`

const PUBLISHED = `!(_id in path("drafts.**"))`

/** Live on the website right now: this project's, published, not archived, not unpublished. Needs $projectSlug. */
export const DIGITAL_CARD_PUBLIC = /* groq */ `_type == "${DIGITAL_CARD_TYPE}" && projectSlug == $projectSlug && ${PUBLISHED} && ${publicFilterFor('digitalCard')}`

/** What a Media Library asset projects to as a card image (focal point included). Needs $locale / $defaultLocale. */
export const DIGITAL_CARD_MEDIA_IMAGE_PROJECTION = /* groq */ `{
      "asset": image.asset,
      "hotspot": image.hotspot,
      "crop": image.crop,
      "alt": ${loc('altText')},
      "lqip": image.asset->metadata.lqip,
      "dimensions": image.asset->metadata.dimensions { width, height, aspectRatio }
    }`

/** A Media Library image reference (field on the current document) with its focal point, only when it belongs to this project. */
const mediaImage = (field: string) => /* groq */ `select(${field}->projectSlug == $projectSlug => ${field}->${DIGITAL_CARD_MEDIA_IMAGE_PROJECTION})`

/** A link's logo (Amendment A, 10): the Media Library image's asset, URL, type and size — only when it belongs to this project. */
export const DIGITAL_CARD_LOGO_PROJECTION = /* groq */ `{
        "asset": image.asset,
        "url": image.asset->url,
        "mime": image.asset->mimeType,
        "dimensions": image.asset->metadata.dimensions { width, height }
      }`

/**
 * Amendment B — a page link's catalogue target (landing page, collection,
 * item): navigationLink's own projection (NAV_CATALOGUE_TARGET_FILTER / _FIELDS, ADR-033
 * Amendment G — project-scoped, lifecycle rule, explicit-reference
 * visibility, slug in the request locale only, segment of the enabled
 * installation), plus the title the card shows when the link has no label.
 * null when the reference is not a public catalogue target of this project.
 */
export const DIGITAL_CARD_CATALOGUE_TITLE = /* groq */ `"title": coalesce(heroTitle[$locale], name[$locale], heroTitle[$defaultLocale], name[$defaultLocale], heroTitle.en, name.en)`
export const DIGITAL_CARD_CATALOGUE_TARGET = /* groq */ `select(defined(page) => *[^.page._ref == _id && ${NAV_CATALOGUE_TARGET_FILTER}][0]{${NAV_CATALOGUE_TARGET_FIELDS},
        ${DIGITAL_CARD_CATALOGUE_TITLE}
      })`

/** One shown link, its target resolved. Hidden links are left out. */
export const DIGITAL_CARD_LINK_FIELDS = /* groq */ `
      _key,
      kind,
      "label": ${loc('label')},
      "description": ${loc('description')},
      "primary": coalesce(primary, false),
      "url": select(kind == "url" => url),
      "value": select(kind in ["phone", "email", "whatsapp"] => value),
      "page": select(kind in ["page", "form", "booking"] => *[_type == "page" && _id == ^.page._ref && projectSlug == $projectSlug && ${PUBLISHED}][0]{
        pageType,
        "slug": coalesce(slug[$locale].current, slug[$defaultLocale].current),
        "title": ${loc('title')},
        "access": access{ visibility, navigation }
      }),
      "hasPageRef": defined(page),
      "catalogue": select(kind == "page" => ${DIGITAL_CARD_CATALOGUE_TARGET}),
      "internalPage": select(kind == "page" && !defined(page) => internalPage),
      "moduleId": select(kind == "page" && !defined(page) && !defined(internalPage) => moduleId),
      "file": select(kind == "file" => *[_type == "mediaAsset" && _id == ^.file._ref && projectSlug == $projectSlug][0]{
        mediaType,
        "url": coalesce(image.asset->url, animation.asset->url, videoUrl),
        "title": coalesce(${loc('title')}, name)
      }),
      "logo": select(defined(logo) => *[_type == "mediaAsset" && _id == ^.logo._ref && projectSlug == $projectSlug && defined(image.asset)][0]${DIGITAL_CARD_LOGO_PROJECTION})
`

/** The card's own fields (both kinds). */
export const DIGITAL_CARD_FIELDS = /* groq */ `
    publicId,
    kind,
    urlName,
    "description": ${loc('description')},
    "links": links[hidden != true]{ ${DIGITAL_CARD_LINK_FIELDS} },
    "background": ${mediaImage('background')},
    show
`

/** The Website Settings and module facts a card renders (D3). Never stored on the card. */
export const DIGITAL_CARD_SITE_FIELDS = /* groq */ `
    "site": *[_type == "siteConfig" && projectSlug == $projectSlug && ${PUBLISHED}][0]{
      siteName,
      "tagline": ${loc('tagline')},
      logo { asset, hotspot, crop, "alt": ${loc('alt')} },
      logoLight { asset, hotspot, crop, "alt": ${loc('alt')} },
      phone,
      email,
      "whatsappNumber": coalesce(*[_type == "project" && projectSlug == $projectSlug && ${PUBLISHED}][0].moduleInstallations[moduleId == "whatsapp" && enabled != false][0].config.whatsappNumber, whatsappNumber),
      socialLinks[] { _key, platform, url },
      locations[] {
        _key,
        key,
        "name": ${loc('name')},
        address { street, postalCode, city, state, country },
        mapsUrl,
        shortName
      },
      location { street, postalCode, city, state, country },
      "seoDefaultDescription": ${loc('seoDefaultDescription')}
    },
    "project": *[_type == "project" && projectSlug == $projectSlug && ${PUBLISHED}][0]{
      customDomain,
      "enabledModules": coalesce(moduleInstallations[enabled != false].moduleId, []),
      // Amendment B — the same shape as navigationLink's moduleSegments (module page links).
      "moduleSegments": moduleInstallations[enabled != false]{ moduleId, "segment": config.publicSegment },
      "peopleProfileSegment": moduleInstallations[moduleId == "people" && enabled != false][0].config.profileSegment
    }
`

/** The person of a person card: People public fields only, and only while listable (D6: off / anonymised / archived → offline). */
export const DIGITAL_CARD_PERSON_FIELD = /* groq */ `"person": *[_type == "person" && _id == ^.person._ref && projectSlug == $projectSlug && ${PUBLISHED} && ${PERSON_LISTABLE}][0]{ ${PERSON_PUBLIC_FIELDS} }`

/** A person card inherits the site card's background (D4) and links its business name to it when it is live. */
export const DIGITAL_CARD_SITE_CARD_FIELD = /* groq */ `"siteCard": *[${DIGITAL_CARD_PUBLIC} && kind == "site"][0]{ "background": ${mediaImage('background')} }`

// ── TypeScript shapes ─────────────────────────────────────────────────────────

/** A Media Library image as mediaImage() returns it. */
export type DigitalCardImage = PersonPublicPhoto

/** A link's logo as the projection returns it. */
export interface DigitalCardLinkLogo {
  asset?: { _ref: string; _type: 'reference' } | null
  url?: string | null
  /** e.g. image/svg+xml, image/png. */
  mime?: string | null
  dimensions?: { width?: number | null; height?: number | null } | null
}

/** A page link's catalogue target as projected (CatalogueNavTarget + its title). */
export type DigitalCardCatalogueTarget = CatalogueNavTarget & { title?: string | null }

export interface DigitalCardLinkPublic {
  _key: string
  kind: DigitalCardLinkKind
  /** Locale-resolved; null = use the standard label of the kind (site dictionary). */
  label?: string | null
  /** Locale-resolved one-liner under the label; null/empty = none. Never in the vCard. */
  description?: string | null
  primary: boolean
  /** kind url. */
  url?: string | null
  /** kind phone / email / whatsapp — PLAIN: encode before rendering (D9). */
  value?: string | null
  /** kind page / form / booking — null when the target is not a `page` (or gone, or a draft). */
  page?: { pageType?: string | null; slug?: string | null; title?: string | null; access?: { visibility?: string | null; navigation?: string | null } | null } | null
  /** A target reference is set (with no `page` / `catalogue` it is not public → the link is left out). */
  hasPageRef?: boolean | null
  /** kind page (Amendment B) — a public catalogue landing page / collection / item of this project, else null. */
  catalogue?: DigitalCardCatalogueTarget | null
  /** kind page (Amendment B) — a built-in section (navigationLink.internalPage). */
  internalPage?: string | null
  /** kind page (Amendment B) — an installed module's public page (navigationLink moduleId). */
  moduleId?: string | null
  /** kind file — null when the asset is gone or belongs to another project. */
  file?: { mediaType?: string | null; url?: string | null; title?: string | null } | null
  /** Optional small logo on the button (Amendment A, 10); null when none, gone, or another project's. Never in the vCard. */
  logo?: DigitalCardLinkLogo | null
}

/** The raw `show` object as stored (may be missing or partial): pass it through resolveShow(kind, show, available). */
export type DigitalCardShowRaw = Partial<{
  name: boolean
  description: boolean
  phone: boolean
  email: boolean
  whatsapp: boolean
  saveContact: boolean
  /** Before Amendment A: the shown profiles. No longer read. */
  socials: string[]
  /** The profiles turned off (Amendment A). */
  hiddenSocials: string[]
  logo: boolean
  businessName: boolean
  locations: string[]
  photo: boolean
  role: boolean
  nameMode: DigitalCardNameMode
  profileLink: boolean
}> | null

export interface DigitalCardSitePublic {
  siteName?: string | null
  tagline?: string | null
  logo?: ResolvedImage | null
  logoLight?: ResolvedImage | null
  /** PLAIN — encode before rendering. */
  phone?: string | null
  /** PLAIN — encode before rendering. */
  email?: string | null
  /** WhatsApp module number, else the legacy siteConfig one. PLAIN — encode before rendering. */
  whatsappNumber?: string | null
  socialLinks?: Array<SocialLink & { _key?: string }> | null
  locations?: Array<{
    _key: string
    key?: string | null
    name?: string | null
    address?: BusinessLocation | null
    mapsUrl?: string | null
    shortName?: string | null
  }> | null
  /** The single Website Settings address — the card's one location when `locations[]` is empty. */
  location?: BusinessLocation | null
  seoDefaultDescription?: string | null
}

export interface DigitalCardProjectPublic {
  customDomain?: string | null
  /** Enabled module ids: gate on 'digital-cards'; booking links need 'reservations'. */
  enabledModules: string[]
  /** Enabled installations' public segments (navigationLink's moduleSegments) — module page links. */
  moduleSegments?: Array<{ moduleId?: string | null; segment?: string | null }> | null
  /** People module config — the profile base path per language (for the "More about …" link). */
  peopleProfileSegment?: Record<string, string> | string | null
}

/** Fields every card result has. */
export interface DigitalCardBase {
  publicId: string
  kind: DigitalCardKind
  urlName?: string | null
  description?: string | null
  links?: DigitalCardLinkPublic[] | null
  background?: DigitalCardImage | null
  show?: DigitalCardShowRaw
  site?: DigitalCardSitePublic | null
  project?: DigitalCardProjectPublic | null
}

/** DIGITAL_CARD_SITE_QUERY result (null = no live site card). */
export interface DigitalCardSiteResult extends DigitalCardBase {
  kind: 'site'
}

/** DIGITAL_CARD_PERSON_QUERY result (null = no live card with that name). */
export interface DigitalCardPersonResult extends DigitalCardBase {
  kind: 'person'
  urlName: string
  /** null = the person is gone, off, anonymised or archived → the card is offline (redirect to /link, D6). */
  person?: PersonPublic | null
  /** The live site card (null = none): its background is inherited when the card has none; business name links to /link only when set. */
  siteCard?: { background?: DigitalCardImage | null } | null
}

/** DIGITAL_CARD_BY_RETIRED_NAME_QUERY result: 308 to /link/<urlName>. */
export interface DigitalCardRetiredResult {
  urlName: string
}

/** DIGITAL_CARD_ROUTE_STATE_QUERY result: a card that exists in any state (routing only, no content). */
export interface DigitalCardRouteState {
  kind: DigitalCardKind
  urlName?: string | null
  /** false = unpublished / archived (D6 redirect); true = live. */
  live: boolean
}

/** DIGITAL_CARD_KNOWN_IDS_QUERY result: what the hit endpoint accepts. */
export interface DigitalCardKnownIds {
  publicId: string
  linkKeys: string[]
}
