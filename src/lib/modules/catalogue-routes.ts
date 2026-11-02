/**
 * Catalogue dashboard routes (ADR-042 N2 / N2a). Pure and browser-safe.
 *
 * Items, Collections and Options are three routes. `/catalogue` redirects to
 * Items; the former `?view=` switch maps to the matching route so old links
 * (bookmarks, back links, emails) keep working.
 */
const VIEW_PATH: Record<string, string> = { items: 'items', collections: 'collections', optionLists: 'option-lists' }

/** Where `/{projectSlug}/catalogue?…` goes. Only `status` and `sort` are carried over. */
export function catalogueRedirectTarget(projectSlug: string, query: Record<string, string | string[] | undefined>): string {
  const view = typeof query.view === 'string' ? query.view : ''
  const path = Object.hasOwn(VIEW_PATH, view) ? VIEW_PATH[view] : 'items'
  const carry = new URLSearchParams()
  for (const key of ['status', 'sort'] as const) {
    const value = query[key]
    if (typeof value === 'string' && value) carry.set(key, value)
  }
  const qs = carry.toString()
  return `/${projectSlug}/catalogue/${path}${qs ? `?${qs}` : ''}`
}

/** The list route of one Catalogue view — what back links point at (never `/catalogue?view=…`). */
export function catalogueListPath(projectSlug: string, view: 'items' | 'collections' | 'optionLists'): string {
  return `/${projectSlug}/catalogue/${VIEW_PATH[view]}`
}

/**
 * The query string a list screen writes back while filtering: `status` and `sort` only (defaults
 * removed). The route is the view, so a stale `view` parameter is dropped, never written.
 */
export function catalogueListSearch(search: string, status: string, sort: string | null): string {
  const u = new URLSearchParams(search)
  u.delete('view')
  if (status === 'all') u.delete('status')
  else u.set('status', status)
  if (sort === null) u.delete('sort')
  else u.set('sort', sort)
  const qs = u.toString()
  return qs ? `?${qs}` : ''
}
