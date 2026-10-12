/**
 * ADR-032 D12 — which "Browse …" link the branded unavailable page offers.
 *
 * Pure. The answer depends ONLY on the requested path's route segment and on
 * which listing modules the site has enabled — never on the item, its slug or
 * its lifecycle state, so an unpublished URL and one that never existed get
 * the identical page.
 */

export type BrowseTarget = 'blog' | 'events' | 'news'

/** First route segment → the listing it belongs to, and its owning module. */
const ROUTE_TO_TARGET: Record<string, BrowseTarget> = {
  blog: 'blog',
  category: 'blog',
  events: 'events',
  news: 'news',
}

/** Listing → owning module id in MODULE_REGISTRY, and its index route. */
export const BROWSE_TARGETS: Record<BrowseTarget, { moduleId: string; path: string }> = {
  blog: { moduleId: 'blog', path: '/blog' },
  events: { moduleId: 'events', path: '/events' },
  news: { moduleId: 'news', path: '/news' },
}

/**
 * The route segment after the site base. Accepts both public URL forms —
 * `/{locale}/{tenant}/…` and the host-scoped `/{locale}/…` — by stripping the
 * locale and then the tenant segment when they lead the path.
 */
export function routeSegmentAfterBase(pathname: string | null | undefined, locale: string, tenantId: string): string | null {
  if (!pathname) return null
  const parts = pathname.split(/[?#]/, 1)[0].split('/').filter(Boolean)
  if (parts[0] === locale) parts.shift()
  if (parts[0] === tenantId) parts.shift()
  return parts[0] ?? null
}

/**
 * The listing to offer, or null.
 *
 * `enabledModuleIds === null` (module config unavailable) offers nothing: a
 * link to a listing that may be bare is worse than no link. Unlike section
 * gating, there is no existing content here to protect by failing open.
 */
export function resolveBrowseTarget(
  pathname: string | null | undefined,
  locale: string,
  tenantId: string,
  enabledModuleIds: readonly string[] | null | undefined,
): BrowseTarget | null {
  const segment = routeSegmentAfterBase(pathname, locale, tenantId)
  if (!segment) return null
  const target = ROUTE_TO_TARGET[segment]
  if (!target || !enabledModuleIds) return null
  return enabledModuleIds.includes(BROWSE_TARGETS[target].moduleId) ? target : null
}
