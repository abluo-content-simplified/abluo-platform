/**
 * Galleries list filtering for the client dashboard — the same shape as
 * posts-filter.ts. Pure functions, no React, so the rules are unit-tested
 * (src/lib/client/__tests__/galleries-filter.test.ts) and the component only
 * wires them to the URL.
 *
 * Sites have a handful of galleries, so everything runs in the browser on the
 * already-loaded list.
 */

import { normalizeSearch, localDay } from './posts-filter'
import { presetRange, todayISO, type RangePreset } from './date-range'

/**
 * A gallery's state: `live` = published, nothing pending; `changes` =
 * published with unpublished changes; `draft` = never published.
 */
export type GalleryState = 'live' | 'changes' | 'draft'
export type GalleryUsageFilter = 'all' | 'used' | 'unused'
export type GalleryDateField = 'updated' | 'created'
export type GallerySortColumn = 'title' | 'photos' | 'updated' | 'created'
export type GallerySort = { column: GallerySortColumn; dir: 'asc' | 'desc' }

/** The minimum a row needs for filtering. */
export type FilterableGallery = {
  id: string
  /** Display title (already falls back to the internal name / "Untitled"). */
  title: string
  internalName: string
  tags: string[]
  state: GalleryState
  /** Shown on at least one page or post (published or draft). */
  used: boolean
  count: number
  /** ISO */
  updatedAt: string
  /** ISO */
  createdAt: string
}

export type GalleryFilters = {
  q: string
  status: GalleryState | 'all'
  usage: GalleryUsageFilter
  /** '' = every tag */
  tag: string
  dateField: GalleryDateField
  /** Quick range on `dateField` when no custom range is set; 'all' = any date. */
  range: RangePreset | 'all'
  /** Custom range (local ISO days, inclusive). Set = `range` is ignored. */
  from: string
  to: string
  sort: GallerySort
}

/** Page load: every gallery (galleries change rarely — a "last 7 days" default would hide most of them). */
export const DEFAULT_GALLERY_FILTERS: GalleryFilters = {
  q: '',
  status: 'all',
  usage: 'all',
  tag: '',
  dateField: 'updated',
  range: 'all',
  from: '',
  to: '',
  sort: { column: 'updated', dir: 'desc' },
}

export const GALLERY_STATES: readonly GalleryState[] = ['live', 'changes', 'draft']
const USAGES: readonly string[] = ['all', 'used', 'unused']
const DATE_FIELDS: readonly string[] = ['updated', 'created']
const RANGES: readonly string[] = ['last7', 'last30', 'thisYear', 'all']
const COLUMNS: readonly string[] = ['title', 'photos', 'updated', 'created']
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A gallery's state from its draft / published flags. */
export function galleryState(g: { hasDraft: boolean; isPublished: boolean }): GalleryState {
  if (!g.isPublished) return 'draft'
  return g.hasDraft ? 'changes' : 'live'
}

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, most photos / newest first). */
export function nextGallerySort(column: GallerySortColumn, current: GallerySort): GallerySort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'title' ? 'asc' : 'desc' }
}

/** The ISO day window the filters narrow `dateField` to, or null for any date. */
export function galleryDateWindow(f: Pick<GalleryFilters, 'from' | 'to' | 'range'>, now = new Date()): { from: string; to: string } | null {
  if (f.from) return { from: f.from, to: f.to || f.from }
  if (f.range === 'all') return null
  return presetRange(f.range, todayISO(now))
}

function matchesAllButStatus(g: FilterableGallery, f: GalleryFilters, q: string, window: { from: string; to: string } | null): boolean {
  if (q && !normalizeSearch(`${g.title} ${g.internalName} ${g.tags.join(' ')}`).includes(q)) return false
  if (f.usage === 'used' && !g.used) return false
  if (f.usage === 'unused' && g.used) return false
  if (f.tag && !g.tags.includes(f.tag)) return false
  if (window) {
    const day = localDay(f.dateField === 'created' ? g.createdAt : g.updatedAt)
    if (!day || day < window.from || day > window.to) return false
  }
  return true
}

/** The galleries matching `f`, sorted by `f.sort` (ties: title A→Z). */
export function applyGalleryFilters<T extends FilterableGallery>(rows: T[], f: GalleryFilters, now = new Date()): T[] {
  const q = normalizeSearch(f.q)
  const window = galleryDateWindow(f, now)
  const out = rows.filter((g) => (f.status === 'all' || g.state === f.status) && matchesAllButStatus(g, f, q, window))
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  const date = (iso: string) => Date.parse(iso) || 0
  const key = (g: T): number => {
    switch (f.sort.column) {
      case 'photos':
        return g.count
      case 'created':
        return date(g.createdAt)
      default:
        return date(g.updatedAt)
    }
  }
  return out.sort((a, b) => {
    if (f.sort.column === 'title') return sign * collator.compare(a.title, b.title)
    const d = key(a) - key(b)
    return d !== 0 ? sign * d : collator.compare(a.title, b.title)
  })
}

/** Counts per status option, respecting every other active filter. */
export function galleryStateCounts(rows: FilterableGallery[], f: GalleryFilters, now = new Date()): Record<GalleryState | 'all', number> {
  const q = normalizeSearch(f.q)
  const window = galleryDateWindow(f, now)
  const counts: Record<GalleryState | 'all', number> = { all: 0, live: 0, changes: 0, draft: 0 }
  for (const g of rows) {
    if (!matchesAllButStatus(g, f, q, window)) continue
    counts.all++
    counts[g.state]++
  }
  return counts
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseGalleryFilters(params: URLSearchParams): GalleryFilters {
  const d = DEFAULT_GALLERY_FILTERS
  const status = params.get('status') ?? 'all'
  const usage = params.get('usage') ?? 'all'
  const field = params.get('field') ?? d.dateField
  const range = params.get('range') ?? d.range
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const column = params.get('sort') ?? d.sort.column
  const dir = params.get('dir')
  const custom = ISO_DAY.test(from)
  const sortColumn = COLUMNS.includes(column) ? (column as GallerySortColumn) : d.sort.column
  return {
    q: params.get('q') ?? '',
    status: (GALLERY_STATES as readonly string[]).includes(status) ? (status as GalleryState) : 'all',
    usage: USAGES.includes(usage) ? (usage as GalleryUsageFilter) : 'all',
    tag: params.get('tag') ?? '',
    dateField: DATE_FIELDS.includes(field) ? (field as GalleryDateField) : d.dateField,
    range: custom ? 'all' : RANGES.includes(range) ? (range as GalleryFilters['range']) : d.range,
    from: custom ? from : '',
    to: custom && ISO_DAY.test(to) ? to : '',
    sort: {
      column: sortColumn,
      dir: dir === 'asc' || dir === 'desc' ? dir : sortColumn === d.sort.column ? d.sort.dir : sortColumn === 'title' ? 'asc' : 'desc',
    },
  }
}

/** Writes only non-default filters, so a clean list has a clean URL. */
export function galleryFiltersToParams(f: GalleryFilters): URLSearchParams {
  const d = DEFAULT_GALLERY_FILTERS
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.usage !== 'all') p.set('usage', f.usage)
  if (f.tag) p.set('tag', f.tag)
  if (f.dateField !== d.dateField) p.set('field', f.dateField)
  if (f.from) {
    p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  } else if (f.range !== d.range) p.set('range', f.range)
  if (f.sort.column !== d.sort.column || f.sort.dir !== d.sort.dir) {
    p.set('sort', f.sort.column)
    p.set('dir', f.sort.dir)
  }
  return p
}

/** Everything except the sort is as on page load. */
export function isDefaultGalleryFilters(f: GalleryFilters): boolean {
  return galleryFiltersToParams({ ...f, sort: DEFAULT_GALLERY_FILTERS.sort }).toString() === ''
}

/** Narrowing filters beyond the defaults (search and sort excluded) — the phone sheet's badge. */
export function activeGalleryFilterCount(f: GalleryFilters): number {
  return (f.status !== 'all' ? 1 : 0) + (f.usage !== 'all' ? 1 : 0) + (f.tag ? 1 : 0) + (f.from || f.range !== 'all' ? 1 : 0)
}
