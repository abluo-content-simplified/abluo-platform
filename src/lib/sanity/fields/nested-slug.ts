/**
 * Nested page paths (D1).
 *
 * A `page` slug may be a PATH, not a single segment: "servizi/terapia-individuale"
 * is a legal value, and `src/app/[locale]/(website)/[tenant]/[...slug]/page.tsx`
 * joins its captured segments back into exactly this string before querying.
 *
 * The nesting lives in the DATA rather than in a parent/child document model,
 * and that is what makes it locale-aware without any extra mechanism: the path
 * is stored per language under `slug[locale]`, so the German page is
 * "dienstleistungen/einzeltherapie" — a different path, not a translated leaf
 * hanging off an Italian parent.
 *
 * Both helpers here exist because Sanity's DEFAULT slugifier deletes "/". An
 * editor who retyped a nested slug in the Studio would silently get
 * "servizitherapia-individuale" — no error, no clue, a 404 on a live page.
 */

/** Slugify each path SEGMENT and keep the separators. */
export function slugifyNestedPath(input: string, maxLength = 96): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split('/')
    .map((segment) => segment.trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/')
    .slice(0, maxLength)
}

/** The shape a stored slug must have: lowercase segments joined by single "/". */
export const NESTED_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

/**
 * Returns `true` when valid, or the message to show. Matches the signature
 * Sanity's `Rule.custom` expects.
 */
export function validateNestedSlug(current?: string): true | string {
  if (!current) return true
  if (current.startsWith('/') || current.endsWith('/')) {
    return 'A slug must not start or end with "/" — write "servizi/terapia-individuale", not "/servizi/".'
  }
  if (current.includes('//')) return 'A slug must not contain an empty path segment ("//").'
  if (!NESTED_SLUG_PATTERN.test(current)) {
    return 'Use lowercase letters, digits and "-", with "/" between path segments.'
  }
  return true
}

/** `['servizi','terapia-individuale']` → `'servizi/terapia-individuale'`. */
export function joinSlugSegments(segments: string[]): string {
  return segments.map((s) => decodeURIComponent(s)).join('/')
}
