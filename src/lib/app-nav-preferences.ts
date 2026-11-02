/**
 * Sidebar preferences (ADR-042 N3, N4, N4a, section 4).
 *
 * Per-person preferences, same cookie pattern as the theme and text size
 * (`app-theme.ts`) so the server renders the remembered state on the first
 * paint: no flash. They are kept PER LAYOUT: the desktop and the tablet
 * collapsed/expanded choices are independent, so a breakpoint change never
 * overwrites the other layout's preference.
 *
 *   - `desktop` / `tablet`: 'expanded' | 'rail'. Unset = first-use default:
 *     desktop expanded, tablet rail (N4a). Once set, the person's choice wins.
 *   - `groups`: open (true) / closed (false) per group id. Unset = open.
 *     Unknown or removed groups are ignored when read.
 *
 * Pure module: no I/O. Read in `[tenant]/layout.tsx`, written by the sidebar.
 */
import { HEADED_NAV_GROUPS } from '@/lib/client/surfaces'

export const APP_NAV_COOKIE = 'abluo-app-nav'
export const APP_NAV_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type NavLayout = 'desktop' | 'tablet'
export type NavMode = 'expanded' | 'rail'

export type NavPreferences = {
  desktop?: NavMode
  tablet?: NavMode
  groups: Record<string, boolean>
}

/** First-use defaults (N4a). */
export const NAV_DEFAULT_MODE: Record<NavLayout, NavMode> = { desktop: 'expanded', tablet: 'rail' }

export const EMPTY_NAV_PREFERENCES: NavPreferences = { groups: {} }

const isMode = (v: unknown): v is NavMode => v === 'expanded' || v === 'rail'

/** Anything unknown, missing or tampered with means "defaults". Unknown groups are dropped. */
export function parseNavPreferences(value: string | undefined | null, knownGroups: readonly string[] = HEADED_NAV_GROUPS): NavPreferences {
  if (!value) return { groups: {} }
  try {
    const raw = JSON.parse(decodeURIComponent(value)) as { d?: unknown; t?: unknown; g?: unknown }
    const groups: Record<string, boolean> = {}
    if (raw.g && typeof raw.g === 'object') {
      for (const [id, open] of Object.entries(raw.g as Record<string, unknown>)) if (knownGroups.includes(id) && typeof open === 'boolean') groups[id] = open
    }
    return { ...(isMode(raw.d) ? { desktop: raw.d } : {}), ...(isMode(raw.t) ? { tablet: raw.t } : {}), groups }
  } catch {
    return { groups: {} }
  }
}

export function serializeNavPreferences(prefs: NavPreferences): string {
  return encodeURIComponent(JSON.stringify({ ...(prefs.desktop ? { d: prefs.desktop } : {}), ...(prefs.tablet ? { t: prefs.tablet } : {}), g: prefs.groups }))
}

/** The cookie string the sidebar writes (client side). */
export function appNavCookie(prefs: NavPreferences): string {
  return `${APP_NAV_COOKIE}=${serializeNavPreferences(prefs)}; path=/; max-age=${APP_NAV_COOKIE_MAX_AGE}; SameSite=Lax`
}

/** The mode a layout renders: the person's choice, else the first-use default. */
export function navModeFor(prefs: NavPreferences, layout: NavLayout): NavMode {
  return prefs[layout] ?? NAV_DEFAULT_MODE[layout]
}

/** Changing one layout leaves the other untouched. */
export function withNavMode(prefs: NavPreferences, layout: NavLayout, mode: NavMode): NavPreferences {
  return { ...prefs, [layout]: mode }
}

/** Is a group open? Remembered state, else open. */
export function isNavGroupOpen(prefs: NavPreferences, group: string): boolean {
  return prefs.groups[group] ?? true
}

export function withNavGroupOpen(prefs: NavPreferences, group: string, open: boolean): NavPreferences {
  return { ...prefs, groups: { ...prefs.groups, [group]: open } }
}

/**
 * Auto-open (N3): the group holding the current destination is open. Returns
 * the preferences unchanged when it already is (or there is no such group).
 */
export function withActiveGroupOpen(prefs: NavPreferences, activeGroup: string | null, knownGroups: readonly string[] = HEADED_NAV_GROUPS): NavPreferences {
  if (!activeGroup || !knownGroups.includes(activeGroup) || isNavGroupOpen(prefs, activeGroup)) return prefs
  return withNavGroupOpen(prefs, activeGroup, true)
}

/**
 * Is a group shown open? Its remembered state, or (N3) it holds the current
 * destination and the person has not just closed it. `suppressAutoOpen` is true
 * from the moment they close the active group until they go somewhere else.
 */
export function effectiveGroupOpen(prefs: NavPreferences, group: string, activeGroup: string | null, suppressAutoOpen: boolean): boolean {
  return isNavGroupOpen(prefs, group) || (group === activeGroup && !suppressAutoOpen)
}
