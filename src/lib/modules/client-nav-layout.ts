/**
 * Phone navigation helpers for the client dashboard — browser-safe (no server
 * imports), so `ClientSidebar` can use them without pulling server Sanity code
 * into the browser bundle (guarded by private-dataset-readiness.test.ts).
 */
import type { ClientNavItem } from './client-navigation'

/**
 * Is `href` the current page (or a page under it)? `pathname` and `href` are
 * both locale-agnostic (`/{projectSlug}/…`). `/livener/posts` is active on
 * `/livener/posts/abc`, never on `/livener/postsx`.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Which items earn the two phone tab slots, in priority order. Whatever the
 * project actually has first; after these, the remaining nav items in their
 * existing (fixed menu) order fill any slot left, so the bar is never half
 * empty and no tenant needs a special case.
 */
export const PHONE_TAB_PRIORITY = ['blog', 'forms', 'events', 'catalogue', 'gallery'] as const

export type PhoneNavLayout = {
  /** The two tab slots, left then right of "+". Fewer only when the project has fewer than two nav items. */
  tabs: ClientNavItem[]
  /** Everything else: reached through "More", exactly once. */
  overflow: ClientNavItem[]
}

/**
 * Splits the dashboard nav for phones: two tabs picked from the items the
 * project has (PHONE_TAB_PRIORITY, then menu order), and the rest, which only
 * "More" (the drawer) reaches. Every item lands in exactly one place. Pure.
 */
export function phoneNavLayout(items: ClientNavItem[]): PhoneNavLayout {
  const rank = (i: ClientNavItem) => {
    const n = (PHONE_TAB_PRIORITY as readonly string[]).indexOf(i.moduleId)
    return n === -1 ? PHONE_TAB_PRIORITY.length : n
  }
  // Stable sort: ties (unprioritised items) keep their existing menu order.
  const ranked = items.map((item, n) => ({ item, n })).sort((a, b) => rank(a.item) - rank(b.item) || a.n - b.n)
  const tabs = ranked.slice(0, 2).map((r) => r.item)
  const overflow = items.filter((i) => !tabs.includes(i))
  return { tabs, overflow }
}
