// ── People module — website queries (ADR-043 D4, D7) ──────────────────────────
//
// Every person read here goes through PERSON_PUBLIC_FIELDS and one of the
// visibility conditions in projection.ts. Placement fragments (team section,
// post authors, event hosts) are spliced into src/lib/sanity/queries.ts from
// the same file, so there is exactly one way a person reaches the website.
//
// Profile pages follow the Publicly Routable Content Pattern (CLAUDE.md):
// primary lookup with NO slug fallback, a redirect lookup on redirectFrom,
// and a sitemap list. The base path (/team, /insegnanti …) is the People
// module config `profileSegment`, never hardcoded — the route owns it.

import { PERSON_HAS_PAGE, PERSON_LISTABLE, PERSON_ORDER, PERSON_PUBLIC_FIELDS, PERSON_RENDERABLE, personRefsProjection } from './projection'

// Top-level person reads exclude drafts explicitly: the website client reads
// the published perspective anyway, but preview routes read "raw".

// ── Placement fragments (spliced into the website queries) ───────────────────

/**
 * teamSection (ADR-043 D5): hand-picked `people` (listing rule, editor's
 * order) and/or `groupFilter` (one group key, the global order). Hand-picked
 * wins: `groupPeople` is only computed when no person is hand-picked.
 * `peopleCount` counts the STORED references, so a section that has chosen
 * people never falls back to its deprecated inline `members`, even while
 * those people are drafts, off or archived (the renderer decides).
 */
export const TEAM_SECTION_PEOPLE_FIELDS = /* groq */ `
      "people": ${personRefsProjection('people', 'listing')},
      "peopleCount": count(people),
      groupFilter,
      "groupPeople": select(count(coalesce(people, [])) == 0 && defined(groupFilter) => *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && ^.groupFilter in groups && ${PERSON_LISTABLE}] | ${PERSON_ORDER} { ${PERSON_PUBLIC_FIELDS} })`

/** post.authors (first = main author). Archived authors still show (D4). */
export const POST_AUTHORS_FIELDS = /* groq */ `
    "authors": ${personRefsProjection('authors', 'named')},
    "authorCount": count(authors)`

/** event.hostPeople. Archived hosts still show (D4). */
export const EVENT_HOST_PEOPLE_FIELDS = /* groq */ `
  "hostPeople": ${personRefsProjection('hostPeople', 'named')},
  "hostPeopleCount": count(hostPeople)`

// ── Stand-alone website reads ─────────────────────────────────────────────────

/**
 * People named by publicId (event schedules store instructors by publicId —
 * ADR-038 D2 / ADR-043 D9). Archived people are included (they are named by
 * content); off and anonymised ones are not. Order is the caller's ($publicIds).
 */
export const PEOPLE_BY_PUBLIC_IDS_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && publicId in $publicIds && ${PERSON_RENDERABLE}] { ${PERSON_PUBLIC_FIELDS} }
`

/** A team listing by one group key, in the global order. */
export const PEOPLE_BY_GROUP_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && $group in groups && ${PERSON_LISTABLE}] | ${PERSON_ORDER} { ${PERSON_PUBLIC_FIELDS} }
`

/** Every listed person of the site, in the global order (a people index). */
export const PEOPLE_LISTING_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && ${PERSON_LISTABLE}] | ${PERSON_ORDER} { ${PERSON_PUBLIC_FIELDS} }
`

/** Profile page — primary lookup, NO slug fallback. */
export const PERSON_BY_SLUG_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && slug[$locale].current == $slug && ${PERSON_HAS_PAGE}][0] {
    "slugMap": slug,
    ${PERSON_PUBLIC_FIELDS}
  }
`

/** Profile page — redirect lookup on a retired slug. */
export const PERSON_BY_OLD_SLUG_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && $slug in redirectFrom[$locale] && ${PERSON_HAS_PAGE}][0] {
    "currentSlug": slug[$locale].current
  }
`

/**
 * A slug (current or retired) of a person who no longer has a page because
 * they were ARCHIVED (D4: the page 308s to the site's people page). Returns
 * true/false only — never content.
 */
export const PERSON_SLUG_ARCHIVED_QUERY = /* groq */ `
  count(*[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && defined(archivedAt) && !defined(anonymisedAt)
    && (slug[$locale].current == $slug || $slug in redirectFrom[$locale])]) > 0
`

/** An old team-member anchor (/teachers#florian-parra) → the person's page slug, when they have one (D10.4). */
export const PERSON_BY_LEGACY_ANCHOR_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && $anchor in legacyAnchors && ${PERSON_HAS_PAGE}][0] {
    "currentSlug": slug[$locale].current
  }
`

/** Sitemap: people with an own page; one URL per locale where a slug is set. */
export const SITEMAP_PEOPLE_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && ${PERSON_HAS_PAGE}] {
    "slugMap": slug,
    _updatedAt
  }
`
