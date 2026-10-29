/**
 * Phone navigation helpers for the client dashboard — browser-safe (no server
 * imports), so `ClientSidebar` can use them without pulling server Sanity code
 * into the browser bundle (guarded by private-dataset-readiness.test.ts).
 */
import type { ClientNavItem } from './client-navigation'
import { moduleGroupOf, type ModuleGroupId } from './order'

export { formatBadgeCount } from '@/components/app/ui/CountBadge'

/**
 * Is `href` the current page (or a page under it)? `pathname` and `href` are
 * both locale-agnostic (`/{projectSlug}/…`). `/livener/posts` is active on
 * `/livener/posts/abc`, never on `/livener/postsx`.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Phone bottom bar (Tom, 2026-10-29): Home · Content · Requests · Media · More.
 * Fixed slots, no priority guessing — the bar looks the same for every project
 * and simply omits the slots the project does not have.
 *
 *   • Content: the nav items of the "Publish" and "Show" module groups
 *     (src/lib/modules/order.ts), in menu order. Several → a bottom sheet lists
 *     them; exactly one → the tab links straight to it; none → no tab.
 *   • Requests: the forms item (Contact Requests), when the person has it.
 *   • Media: the media item, when present.
 *   • More: opens the drawer. `overflow` is what only More reaches.
 *
 * Invariant (tested): every nav item is placed exactly ONCE — in `content`,
 * as `requests`, as `media`, or in `overflow`. Decision: items in the Content
 * sheet are NOT repeated in `overflow`, so the active state of More means "you
 * are on a page that has no tab of its own" and nothing is listed twice by
 * this model. (The drawer that More opens is the full sidebar and still lists
 * every destination, like the desktop sidebar; that is navigation, not a slot.)
 */
export const PHONE_CONTENT_GROUPS: readonly ModuleGroupId[] = ['publish', 'show']

export type PhoneNavLayout = {
  /** Content-sheet items (Publish + Show modules), menu order. 0 → no tab, 1 → direct link, 2+ → sheet. */
  content: ClientNavItem[]
  /** Contact Requests, or null. */
  requests: ClientNavItem | null
  /** Media library, or null. */
  media: ClientNavItem | null
  /** Everything else: reached through "More", exactly once. */
  overflow: ClientNavItem[]
}

/** Splits the dashboard nav for phones into the fixed slots. Pure; keeps the input (menu) order. */
export function phoneNavLayout(items: ClientNavItem[]): PhoneNavLayout {
  const content = items.filter((i) => PHONE_CONTENT_GROUPS.includes(moduleGroupOf(i.moduleId)) && i.moduleId !== 'forms' && i.moduleId !== 'media')
  const requests = items.find((i) => i.moduleId === 'forms') ?? null
  const media = items.find((i) => i.moduleId === 'media') ?? null
  const overflow = items.filter((i) => !content.includes(i) && i !== requests && i !== media)
  return { content, requests, media, overflow }
}
