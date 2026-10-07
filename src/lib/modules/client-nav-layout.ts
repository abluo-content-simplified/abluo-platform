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

/** The modules that get their own slot in the phone tab bar (Home · Content · + · Forms · More). */
export const PHONE_TAB_MODULE_IDS = ['blog', 'forms'] as const

export type PhoneNavLayout = {
  /** The Content tab (blog), when the project has it. */
  content: ClientNavItem | null
  /** The Forms tab, when the project has it. */
  forms: ClientNavItem | null
  /** Everything else (Galleries, Media, People, …): reached through "More". */
  overflow: ClientNavItem[]
}

/**
 * Splits the dashboard nav for phones: the two items with a fixed tab, and the
 * rest, which only "More" (the drawer) reaches. Every item lands in exactly one
 * place, so nothing on the desktop sidebar is unreachable on a phone. Pure.
 */
export function phoneNavLayout(items: ClientNavItem[]): PhoneNavLayout {
  const tabIds: readonly string[] = PHONE_TAB_MODULE_IDS
  return {
    content: items.find((i) => i.moduleId === 'blog') ?? null,
    forms: items.find((i) => i.moduleId === 'forms') ?? null,
    overflow: items.filter((i) => !tabIds.includes(i.moduleId)),
  }
}

