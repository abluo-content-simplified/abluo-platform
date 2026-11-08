/**
 * Arriving from the dashboard search (ADR-047 D6). Search results and "See all
 * in {Module}" link to the list screens with `?q=…` (and `?open={id}` for
 * Media and Contact requests).
 *
 * The rule for remembered filters, the same on every screen:
 *   - `?q=` wins over any remembered list query for the search text.
 *   - The person's other remembered filters are NOT applied on that visit (a
 *     remembered "This year" or "Published" could hide the very item they
 *     searched for), and the visit does not overwrite them. The screens'
 *     built-in defaults that would hide matches (a date range such as "last 7
 *     days", "Coming up") are widened to "all" for that visit.
 *   - Once applied, the box behaves normally; clearing it removes `q` from the
 *     address (URL-synced screens) or the param is stripped on arrival (local-
 *     state screens), so it is never re-applied.
 *
 * Pure helpers (server and client); the hook is in use-search-landing.ts.
 */

/** Longest search text taken from the address. */
export const SEARCH_Q_MAX = 100

type SearchParams = Record<string, string | string[] | undefined>

/** `?q=` as clean search text: a string, trimmed, at most 100 characters; '' otherwise. */
export function cleanSearchQ(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, SEARCH_Q_MAX).trim() : ''
}

/** `?open=` accepted only when it matches the screen's id format; '' otherwise. */
export function cleanOpenId(value: unknown, isValid: (id: string) => boolean): string {
  return typeof value === 'string' && isValid(value) && value.length <= 200 ? value : ''
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuidId = (id: string): boolean => UUID_RE.test(id)
/** A Sanity asset id (`image-…`, `file-…`, media-library ids): URL-safe characters only. */
export const isAssetId = (id: string): boolean => /^[A-Za-z0-9._:-]{1,200}$/.test(id)

/** A query string with its `q` cleaned (dropped when empty); other keys untouched. */
export function normalizeListQuery(query: string): string {
  const p = new URLSearchParams(query)
  if (p.has('q')) {
    const q = cleanSearchQ(p.get('q'))
    if (q) p.set('q', q)
    else p.delete('q')
  }
  return p.toString()
}

/** The address of a URL-synced list page as a clean query string (string params only, `q` cleaned). */
export function landingListQuery(searchParams: SearchParams): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === 'string') p.set(k, v)
  return normalizeListQuery(p.toString())
}

/** True when the address is just `?q=…`: a visit from the search, not the screen's own filter URL. */
export function isSearchLanding(query: string): boolean {
  const p = new URLSearchParams(query)
  return [...p.keys()].length === 1 && p.has('q') && cleanSearchQ(p.get('q')) !== ''
}
