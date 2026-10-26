/**
 * Site Access — the GROQ side of the page rule (ADR-040 §9). Pure strings,
 * client-safe. The TypeScript twin is `parseAccessPolicy()` in ./policy.ts;
 * `src/lib/access/__tests__/page-groq.test.ts` runs both against the same
 * documents and fails if they ever disagree.
 *
 * A page is OPEN (public) iff it has no `access` object, or
 * `access.visibility == "public"`. Anything else — restricted, a typo, a
 * missing visibility — is closed. A page is open ALONG ITS PATH only when it
 * and every page at a prefix of its slug (its path ancestors, D1 nested
 * routing) are open.
 */

/** Open-predicate for the document at `path` ('' = the current document). */
export function pageIsOpen(path = ''): string {
  return `(!defined(${path}access) || ${path}access.visibility == "public")`
}

/**
 * Closed path ancestors of the current page, for the request locale. Binds
 * `$projectSlug`, `$locale` and `$ancestorPaths` (slugAncestorPaths()).
 */
export const CLOSED_PAGE_ANCESTORS = /* groq */ `*[_type == "page" && projectSlug == $projectSlug && slug[$locale].current in $ancestorPaths && !${pageIsOpen()}]`

/** The current page is open and so is every page above it. */
export const PAGE_OPEN_ALONG_PATH = /* groq */ `(${pageIsOpen()} && count(${CLOSED_PAGE_ANCESTORS}) == 0)`

/**
 * What a route needs to decide BEFORE any content is loaded: the page's own
 * policy and the policies of the closed pages above it. Never content.
 */
export const PAGE_ACCESS_PROJECTION = /* groq */ `
    "access": access{ visibility, groups, navigation },
    "ancestorAccess": ${CLOSED_PAGE_ANCESTORS}{ "access": access{ visibility, groups } },
    "contentWithheld": !${PAGE_OPEN_ALONG_PATH}`

/**
 * Wraps a content projection so it is returned only when the page is open
 * along its path, or when the caller has ALREADY authorised the visitor and
 * binds `$unlocked: true`. A restricted page therefore never leaves Sanity on
 * the first read.
 */
export function onlyWhenReadable(contentProjection: string): string {
  return `(${PAGE_OPEN_ALONG_PATH} || $unlocked == true) => {${contentProjection}
    }`
}
