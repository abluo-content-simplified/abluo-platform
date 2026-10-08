/**
 * Media library filters and sort (client-side, on the loaded library) — the
 * same shape as posts-filter.ts / people-filter.ts. Pure, so it is unit-tested.
 *
 * Search: every word must appear in the name, file name, description (alt),
 * title, caption (any language) or tags — accents and case ignored.
 * Filters: one tag · used / not used · description missing (in the site's
 * default language, the same rule as the grid's "No description") · the
 * uploaded date (quick range or custom days).
 * Sort: name, uploaded, size.
 */
import { presetRange, todayISO, type RangePreset } from './date-range'
import { localDay, normalizeSearch } from './posts-filter'

/** The facts of a photo the filters read (a subset of MediaLibraryItem). */
export type FilterableMedia = {
  assetId: string
  name: string
  filename?: string
  alt: Record<string, string>
  title?: Record<string, string>
  caption?: Record<string, string>
  tags: string[]
  createdAt?: string
  bytes?: number
  usedIn: readonly unknown[]
}

export type MediaUsageFilter = 'all' | 'used' | 'unused'
export type MediaDescriptionFilter = 'all' | 'missing'
export type MediaSortColumn = 'name' | 'uploaded' | 'size'
export type MediaDateRange = RangePreset | 'all'

export type MediaFilters = {
  q: string
  /** One tag (lower-case), or '' for any. */
  tag: string
  usage: MediaUsageFilter
  description: MediaDescriptionFilter
  /** Quick range on the uploaded date, when no custom range is set. */
  range: MediaDateRange
  /** Custom range (local ISO days, inclusive). Set = `range` is ignored. */
  from: string | null
  to: string | null
  sort: { column: MediaSortColumn; dir: 'asc' | 'desc' }
}

export const DEFAULT_MEDIA_FILTERS: MediaFilters = {
  q: '',
  tag: '',
  usage: 'all',
  description: 'all',
  range: 'all',
  from: null,
  to: null,
  sort: { column: 'uploaded', dir: 'desc' },
}

/**
 * The default language of the photos: one site's (a string), or per photo
 * when a list spans several sites (the admin's "All projects").
 */
export type LocaleOf<T> = string | ((m: T) => string)

/** The default language for one photo. */
export function localeFor<T>(locale: LocaleOf<T>, m: T): string {
  return typeof locale === 'function' ? locale(m) : locale
}

/** The display name of a photo: its name, else the file name, else its description in `locale`. */
export function mediaName(m: Pick<FilterableMedia, 'name' | 'filename' | 'alt'>, locale: string): string {
  return m.name?.trim() || m.filename?.trim() || m.alt[locale]?.trim() || ''
}

/** True when the photo has no description in the site's default language. */
export function needsDescription(m: Pick<FilterableMedia, 'alt'>, defaultLocale: string): boolean {
  return !(m.alt[defaultLocale] ?? '').trim()
}

export function mediaSearchText(m: FilterableMedia): string {
  const values = (r?: Record<string, string>) => (r ? Object.values(r) : [])
  return normalizeSearch([m.name, m.filename ?? '', ...values(m.alt), ...values(m.title), ...values(m.caption), ...m.tags].join(' '))
}

/** The ISO day window of the date filter, or null for any date. */
export function mediaDateWindow(f: Pick<MediaFilters, 'range' | 'from' | 'to'>, now = new Date()): { from: string; to: string } | null {
  if (f.from) return { from: f.from, to: f.to || f.from }
  if (f.range === 'all') return null
  return presetRange(f.range, todayISO(now))
}

export function applyMediaFilters<T extends FilterableMedia>(items: T[], f: MediaFilters, defaultLocale: LocaleOf<T>, now = new Date()): T[] {
  const words = normalizeSearch(f.q).split(/\s+/).filter(Boolean)
  const tag = f.tag.trim().toLowerCase()
  const window = mediaDateWindow(f, now)
  const out = items.filter((m) => {
    if (tag && !m.tags.some((t) => t.toLowerCase() === tag)) return false
    if (f.usage === 'used' && m.usedIn.length === 0) return false
    if (f.usage === 'unused' && m.usedIn.length > 0) return false
    if (f.description === 'missing' && !needsDescription(m, localeFor(defaultLocale, m))) return false
    if (window) {
      const day = localDay(m.createdAt)
      if (!day || day < window.from || day > window.to) return false
    }
    if (words.length) {
      const text = mediaSearchText(m)
      if (!words.every((w) => text.includes(w))) return false
    }
    return true
  })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  // Stable tie-break: the library order (newest first) as loaded.
  const index = new Map(items.map((m, i) => [m.assetId, i]))
  const tie = (a: T, b: T) => (index.get(a.assetId) ?? 0) - (index.get(b.assetId) ?? 0)
  if (f.sort.column === 'name') {
    // Unnamed photos always come last.
    out.sort((a, b) => {
      const x = mediaName(a, localeFor(defaultLocale, a))
      const y = mediaName(b, localeFor(defaultLocale, b))
      if (!x || !y) return x === y ? tie(a, b) : x ? -1 : 1
      return sign * collator.compare(x, y) || tie(a, b)
    })
  } else if (f.sort.column === 'size') {
    // Unknown sizes always come last.
    out.sort((a, b) => {
      const x = a.bytes ?? null
      const y = b.bytes ?? null
      if (x === null || y === null) return x === y ? tie(a, b) : x === null ? 1 : -1
      return sign * (x - y) || tie(a, b)
    })
  } else {
    const at = (m: T) => (m.createdAt ? Date.parse(m.createdAt) || 0 : 0)
    out.sort((a, b) => sign * (at(a) - at(b)) || tie(a, b))
  }
  return out
}

/** Every tag in the loaded library, most used first, then A–Z. */
export function mediaTags(items: Pick<FilterableMedia, 'tags'>[]): string[] {
  const counts = new Map<string, number>()
  for (const m of items) for (const t of m.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
}

export function isDefaultMediaFilters(f: MediaFilters): boolean {
  return !f.q.trim() && !f.tag && f.usage === 'all' && f.description === 'all' && f.range === 'all' && !f.from
}

/** Active filters, for the phone "Filters · N" button (search not counted). */
export function activeMediaFilterCount(f: MediaFilters): number {
  return (f.tag ? 1 : 0) + (f.usage !== 'all' ? 1 : 0) + (f.description !== 'all' ? 1 : 0) + (f.range !== 'all' || f.from ? 1 : 0)
}

/** Clicking a column header: a new column starts A–Z for name, newest / largest first otherwise; the same column flips. */
export function nextMediaSort(column: MediaSortColumn, current: MediaFilters['sort']): MediaFilters['sort'] {
  if (current.column !== column) return { column, dir: column === 'name' ? 'asc' : 'desc' }
  return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}
