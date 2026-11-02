/**
 * Phone navigation helpers for the client dashboard — browser-safe (no server
 * imports), so `ClientSidebar` can use them without pulling server Sanity code
 * into the browser bundle (guarded by private-dataset-readiness.test.ts).
 */
import type { ClientNavItem } from './client-navigation'
import { HEADED_NAV_GROUPS, type HeadedNavGroup, type NavGroup } from '@/lib/client/surfaces'

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
 * Which destination is current? Candidates are the items whose own path
 * contains `pathname`, or whose `owns` rule claims it (Catalogue -> Items owns
 * `/catalogue/<id>` and `/catalogue/new`). The most specific candidate wins, so
 * exactly one destination is current. Returns the item's `moduleId`, or null.
 */
export function resolveActiveNavId(pathname: string, items: readonly ClientNavItem[]): string | null {
  let best: { id: string; score: number } | null = null
  for (const item of items) {
    let score = -1
    if (isNavItemActive(pathname, item.href)) score = item.href.length
    else if (item.owns && isNavItemActive(pathname, item.owns.base)) {
      const next = pathname.slice(item.owns.base.length + 1).split('/')[0]
      if (!item.owns.except.includes(next)) score = item.owns.base.length
    }
    if (score > (best?.score ?? -1)) best = { id: item.moduleId, score }
  }
  return best?.id ?? null
}

/** The sidebar as ADR-042 lays it out: headed groups (with their destinations), then the unheaded bottom block. Empty groups are left out. */
export type SidebarGroup = { group: HeadedNavGroup; items: ClientNavItem[] }
export function sidebarGroups(items: readonly ClientNavItem[]): { groups: SidebarGroup[]; bottom: ClientNavItem[] } {
  return {
    groups: HEADED_NAV_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0),
    bottom: items.filter((i) => i.group === 'bottom'),
  }
}

/** The group a destination is in, or null. */
export function groupOfNavId(items: readonly ClientNavItem[], id: string | null): NavGroup | null {
  return items.find((i) => i.moduleId === id)?.group ?? null
}

/**
 * Phone bottom bar (Tom, 2026-10-29): Home / Content / Requests / Media / More.
 * Fixed slots, no priority guessing: the bar looks the same for every project
 * and simply omits the slots the project does not have.
 *
 *   - Content (ADR-042 N5, rebuilt from the N1 groups): the destinations of the
 *     Content and Catalogue groups, in sidebar order. Several -> a bottom sheet
 *     lists them (under their group headings); exactly one -> the tab links
 *     straight to it; none -> no tab.
 *   - Requests: the forms item (Contact Requests), when the person has it.
 *   - Media: the media item, when present.
 *   - More: opens the drawer. `overflow` is what only More reaches.
 *
 * Invariant (tested): every nav item is placed exactly ONCE: in `content`,
 * as `requests`, as `media`, or in `overflow`. (The drawer that More opens is
 * the full sidebar and still lists every destination; that is navigation, not a slot.)
 */
export const PHONE_CONTENT_GROUPS: readonly NavGroup[] = ['content', 'catalogue']

export type PhoneNavLayout = {
  /** Content-sheet items (Content + Catalogue groups), menu order. 0 -> no tab, 1 -> direct link, 2+ -> sheet. */
  content: ClientNavItem[]
  /** Contact Requests, or null. */
  requests: ClientNavItem | null
  /** Media library, or null. */
  media: ClientNavItem | null
  /** Everything else: reached through "More", exactly once. */
  overflow: ClientNavItem[]
}

export type ContentSheetSection = {
  group: NavGroup
  /** Id of the rendered group heading, or null when no heading is rendered (a single group) — then no `aria-labelledby`. */
  headingId: string | null
  rows: ClientNavItem[]
}

/** The phone content sheet's sections, in PHONE_CONTENT_GROUPS order; empty groups skipped; headings only when 2+ groups. */
export function contentSheetSections(content: readonly ClientNavItem[]): ContentSheetSection[] {
  const groups = PHONE_CONTENT_GROUPS.map((group) => ({ group, rows: content.filter((i) => i.group === group) })).filter((g) => g.rows.length > 0)
  const headed = groups.length > 1
  return groups.map((g) => ({ ...g, headingId: headed ? `content-sheet-${g.group}` : null }))
}

/** Splits the dashboard nav for phones into the fixed slots. Pure; keeps the input (menu) order. */
export function phoneNavLayout(items: ClientNavItem[]): PhoneNavLayout {
  const content = items.filter((i) => PHONE_CONTENT_GROUPS.includes(i.group))
  const requests = items.find((i) => i.moduleId === 'forms') ?? null
  const media = items.find((i) => i.moduleId === 'media') ?? null
  const overflow = items.filter((i) => !content.includes(i) && i !== requests && i !== media)
  return { content, requests, media, overflow }
}
