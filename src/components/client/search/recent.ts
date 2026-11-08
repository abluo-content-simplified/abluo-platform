/**
 * Recently opened search results (ADR-047 v1): the last few results and "Go to"
 * destinations a person opened, remembered per project in this browser only.
 * Pure helpers + guarded localStorage access: when storage is unavailable
 * (private window, blocked) nothing is read or written and the "Recent" group
 * simply does not appear.
 */
export type RecentEntry = {
  /** Locale-agnostic `/{projectSlug}/…` href. */
  href: string
  title: string
  subtitle?: string
  thumbUrl?: string
  /** Key of the icon to draw when there is no thumbnail (a module id). */
  iconKey?: string
}

export const RECENT_MAX = 6
const key = (projectSlug: string) => `abluo.search.recent.v1.${projectSlug}`

/** The new list after opening `entry`: first, deduplicated by href, capped. Pure. */
export function addRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...list.filter((e) => e.href !== entry.href)].slice(0, RECENT_MAX)
}

function isEntry(v: unknown, projectSlug: string): v is RecentEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.href === 'string' && e.href.startsWith(`/${projectSlug}/`) && typeof e.title === 'string' && e.title.length > 0
}

export function readRecent(projectSlug: string): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(key(projectSlug))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((e): e is RecentEntry => isEntry(e, projectSlug)).slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function writeRecent(projectSlug: string, list: RecentEntry[]): void {
  try {
    window.localStorage.setItem(key(projectSlug), JSON.stringify(list))
  } catch {
    // Storage unavailable: recents are a convenience only.
  }
}

export { fold } from '@/components/app/ui/search-match'
