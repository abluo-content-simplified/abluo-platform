/**
 * Remembered list filters (Tom, 2026-11-04).
 *
 * A list screen keeps its filters in the address (`?when=year&…`), so opening
 * an item and coming back — or arriving from the sidebar — used to land on the
 * defaults again ("last 7 days"). Each list now also remembers its last query
 * per person, per site, in a small cookie:
 *
 *   client — `rememberListQuery()` after every filter change (empty = forget)
 *   server — the page uses `rememberedListQuery()` as its initial query when
 *            the address carries none, so the first render already shows the
 *            remembered selection (no flash of the defaults, no redirect).
 *
 * Only the filter query is stored — never content.
 */

export type RememberedList = 'posts' | 'galleries' | 'faq-sets'

/** Longest query worth keeping; anything longer is ignored. */
export const LIST_QUERY_MAX = 1500
const MAX_AGE_DAYS = 90

export function listQueryCookieName(list: RememberedList, projectSlug: string): string {
  return `abluo-list-${list}-${projectSlug}`.replace(/[^A-Za-z0-9_-]/g, '-')
}

/** A stored value as a clean query string, or '' when unusable. */
export function cleanListQuery(value: string | null | undefined): string {
  if (!value || value.length > LIST_QUERY_MAX) return ''
  try {
    return new URLSearchParams(value).toString()
  } catch {
    return ''
  }
}

/** Client: remember (or, for an empty query, forget) this list's filters. */
export function rememberListQuery(list: RememberedList, projectSlug: string, query: string): void {
  if (typeof document === 'undefined') return
  const name = listQueryCookieName(list, projectSlug)
  const value = cleanListQuery(query)
  try {
    document.cookie = value
      ? `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE_DAYS * 86400}; samesite=lax`
      : `${name}=; path=/; max-age=0; samesite=lax`
  } catch {
    /* cookies unavailable — the list simply starts from its defaults */
  }
}

/**
 * Server: the query a list page should start from. The address wins when it
 * has any parameters; otherwise the remembered query (or '').
 */
export function initialListQuery(
  addressQuery: string,
  remembered: string | null | undefined
): string {
  if (addressQuery) return addressQuery
  return cleanListQuery(remembered)
}
