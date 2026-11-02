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
