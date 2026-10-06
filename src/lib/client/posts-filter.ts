/**
 * Posts list filtering for the client dashboard. Pure functions, no React — so
 * the rules are unit-tested (src/lib/client/__tests__/posts-filter.test.ts) and
 * the component only wires them to the URL.
 *
 * Sites have tens of posts, not thousands, so everything runs in the browser
 * on the already-loaded list. If a site ever grows past a few hundred, move
 * search + paging to the server.
 */

import { presetRange, todayISO, type RangePreset } from './date-range'

export type PostStatus = 'published' | 'scheduled' | 'draft' | 'offline'
/**
 * Sort order. `newest` / `oldest` = by publish date, `edited` / `edited_asc` =
 * by last edit, `title` / `title_desc`, `ends` / `ends_desc` (posts without an
 * end date always last).
 */
export type PostSort = 'newest' | 'oldest' | 'edited' | 'edited_asc' | 'title' | 'title_desc' | 'ends' | 'ends_desc'
export type SortColumn = 'title' | 'updated' | 'published' | 'ends'
export type DateField = 'published' | 'updated' | 'ends'
export type TranslationFilter = '' | 'complete' | 'missing'
/** A quick date range ("last 7 days" …), or 'all' for any date. Relative to today. */
export type DateRangeChoice = RangePreset | 'all'

/** The minimum a row needs for filtering. */
export type FilterablePost = {
  _id: string
  status: PostStatus
  /** Pre-built, lower-cased, accent-free text: titles, subtitles and body text, all languages (postSearchText). */
  searchText: string
  categoryKeys: string[]
  /** Site languages this post has a title in. */
  languages: string[]
  /** ISO — go-live date, or last edit for drafts. Drives date filter + sort. */
  primaryDate: string
  updatedAt: string
  /** Display title (title sort). */
  title?: string
  /** Every site language has a title and a body (undefined on single-language sites). */
  translationsComplete?: boolean
  featured?: boolean
  /** Take-offline date (ISO), if set. */
  expiresAt?: string | null
}

export type PostFilters = {
  q: string
  status: PostStatus | 'all'
  categories: string[]
  /** 'all' | 'month' | '3m' | 'year' | a four-digit year */
  when: string
  /** a language code the post must be MISSING, or '' */
  missing: string
  sort: PostSort
  /** '' | 'complete' | 'missing' — every site language has title + body, or not. */
  translations: TranslationFilter
  /** '' | 'yes' — featured posts only. */
  featured: '' | 'yes'
  /** Custom date range (local ISO days, inclusive) on `dateField`. Set = `range` is ignored. */
  from: string
  to: string
  dateField: DateField
  /** Quick range on `dateField` when no custom range is set. URL `range`. */
  range: DateRangeChoice
}

export const DEFAULT_FILTERS: PostFilters = {
  q: '',
  status: 'all',
  categories: [],
  when: 'all',
  missing: '',
  sort: 'newest',
  translations: '',
  featured: '',
  from: '',
  to: '',
  dateField: 'updated',
  range: 'last7',
}

const STATUSES: readonly string[] = ['published', 'scheduled', 'draft', 'offline']
const SORTS: readonly string[] = ['newest', 'oldest', 'edited', 'edited_asc', 'title', 'title_desc', 'ends', 'ends_desc']
const DATE_FIELDS: readonly string[] = ['published', 'updated', 'ends']
const RANGES: readonly string[] = ['last7', 'last30', 'thisYear', 'all']
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** [ascending, descending] sort for each sortable column. */
const COLUMN_SORTS: Record<SortColumn, [PostSort, PostSort]> = {
  title: ['title', 'title_desc'],
  updated: ['edited_asc', 'edited'],
  published: ['oldest', 'newest'],
  ends: ['ends', 'ends_desc'],
}

/** Which column a sort belongs to, and its direction. */
export function sortState(sort: PostSort): { column: SortColumn; dir: 'asc' | 'desc' } {
  for (const [column, [asc, desc]] of Object.entries(COLUMN_SORTS) as [SortColumn, [PostSort, PostSort]][]) {
    if (sort === asc) return { column, dir: 'asc' }
    if (sort === desc) return { column, dir: 'desc' }
  }
  return { column: 'published', dir: 'desc' }
}

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, newest dates first). */
export function nextSort(column: SortColumn, current: PostSort): PostSort {
  const [asc, desc] = COLUMN_SORTS[column]
  const now = sortState(current)
  if (now.column === column) return now.dir === 'asc' ? desc : asc
  return column === 'title' || column === 'ends' ? asc : desc
}

/** The local calendar day (YYYY-MM-DD) of an ISO moment, or null. */
export function localDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateFor(p: FilterablePost, field: DateField): string | null {
  if (field === 'updated') return p.updatedAt
  if (field === 'ends') return p.expiresAt ?? null
  return p.status === 'draft' ? null : p.primaryDate
}

/** Lower-case and strip accents so "perche" finds "perché". */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/** Body text kept per post for search, all languages together (keeps the page payload small). */
export const BODY_SEARCH_CAP = 20_000

type TextByLanguage = Record<string, unknown> | string | null | undefined

function texts(value: TextByLanguage): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (!value || typeof value !== 'object') return []
  return Object.entries(value)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())
    .map(([, v]) => v as string)
}

/**
 * The search blob for one post: every language's title and subtitle, plus the
 * body's plain text in every language, capped at `cap` characters in total
 * (shared evenly between the languages, so each one stays searchable).
 * Lower-cased, accent-free, whitespace collapsed.
 */
export function postSearchText(
  input: { titles?: TextByLanguage; subtitles?: TextByLanguage; bodies?: TextByLanguage },
  cap = BODY_SEARCH_CAP
): string {
  const bodies = texts(input.bodies).map((b) => b.replace(/\s+/g, ' ').trim())
  const share = bodies.length ? Math.floor(cap / bodies.length) : 0
  const parts = [...texts(input.titles), ...texts(input.subtitles), ...bodies.map((b) => b.slice(0, share))]
  return normalizeSearch(parts.join(' \n '))
}

/** The ISO day window a filter set narrows `dateField` to, or null for any date. */
export function dateWindow(f: Pick<PostFilters, 'from' | 'to' | 'range'>, now = new Date()): { from: string; to: string } | null {
  if (f.from) return { from: f.from, to: f.to || f.from }
  if (f.range === 'all') return null
  return presetRange(f.range, todayISO(now))
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseFilters(params: URLSearchParams): PostFilters {
  const status = params.get('status') ?? 'all'
  const sort = params.get('sort') ?? 'newest'
  const when = params.get('when') ?? 'all'
  const tr = params.get('tr') ?? ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const field = params.get('field') ?? DEFAULT_FILTERS.dateField
  const range = params.get('range') ?? DEFAULT_FILTERS.range
  const custom = ISO_DAY.test(from)
  return {
    q: params.get('q') ?? '',
    status: STATUSES.includes(status) ? (status as PostStatus) : 'all',
    categories: (params.get('cat') ?? '').split(',').filter(Boolean),
    when: ['all', 'month', '3m', 'year'].includes(when) || /^\d{4}$/.test(when) ? when : 'all',
    missing: params.get('missing') ?? '',
    sort: SORTS.includes(sort) ? (sort as PostSort) : 'newest',
    translations: tr === 'complete' || tr === 'missing' ? tr : '',
    featured: params.get('feat') === 'yes' ? 'yes' : '',
    from: custom ? from : '',
    to: custom && ISO_DAY.test(to) ? to : '',
    dateField: DATE_FIELDS.includes(field) ? (field as DateField) : DEFAULT_FILTERS.dateField,
    // A custom range replaces the quick range.
    range: custom ? 'all' : RANGES.includes(range) ? (range as DateRangeChoice) : DEFAULT_FILTERS.range,
  }
}

/** Writes only non-default filters, so a clean list has a clean URL. */
export function filtersToParams(f: PostFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.categories.length) p.set('cat', f.categories.join(','))
  if (f.when !== 'all') p.set('when', f.when)
  if (f.missing) p.set('missing', f.missing)
  if (f.sort !== 'newest') p.set('sort', f.sort)
  if (f.translations) p.set('tr', f.translations)
  if (f.featured) p.set('feat', f.featured)
  if (f.from) p.set('from', f.from)
  if (f.from && f.to) p.set('to', f.to)
  if (f.dateField !== DEFAULT_FILTERS.dateField) p.set('field', f.dateField)
  if (!f.from && f.range !== DEFAULT_FILTERS.range) p.set('range', f.range)
  return p
}

/** Everything (except the sort) is as on page load: "updated, last 7 days", nothing else. */
export function isDefaultFilters(f: PostFilters): boolean {
  const p = filtersToParams({ ...f, sort: DEFAULT_FILTERS.sort })
  return p.toString() === ''
}

/**
 * Number of narrowing filters beyond the page-load default (search and sort
 * excluded): the default "updated, last 7 days" does not count, any other
 * date restriction counts once.
 */
export function activeFilterCount(f: PostFilters): number {
  return (
    (f.status !== 'all' ? 1 : 0) +
    f.categories.length +
    (f.when !== 'all' ? 1 : 0) +
    (f.missing ? 1 : 0) +
    (f.translations ? 1 : 0) +
    (f.featured ? 1 : 0) +
    (f.from || (f.range !== 'all' && (f.range !== DEFAULT_FILTERS.range || f.dateField !== DEFAULT_FILTERS.dateField)) ? 1 : 0)
  )
}

function matchesWhen(iso: string, when: string, now: Date): boolean {
  if (when === 'all') return true
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  if (/^\d{4}$/.test(when)) return d.getFullYear() === Number(when)
  if (when === 'year') return d.getFullYear() === now.getFullYear()
  if (when === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (when === '3m') {
    const from = new Date(now)
    from.setMonth(from.getMonth() - 3)
    return d >= from && d <= now
  }
  return true
}

/** Everything except the status filter — used for the status tab counts. */
function matchesAllButStatus<T extends FilterablePost>(p: T, f: PostFilters, q: string, now: Date, window: { from: string; to: string } | null) {
  if (q && !p.searchText.includes(q)) return false
  if (f.categories.length && !f.categories.some((c) => p.categoryKeys.includes(c))) return false
  if (!matchesWhen(p.primaryDate, f.when, now)) return false
  if (f.missing && p.languages.includes(f.missing)) return false
  if (f.translations === 'complete' && p.translationsComplete === false) return false
  if (f.translations === 'missing' && p.translationsComplete !== false) return false
  if (f.featured === 'yes' && !p.featured) return false
  if (window) {
    const day = localDay(dateFor(p, f.dateField))
    if (!day || day < window.from || day > window.to) return false
  }
  return true
}

export function applyFilters<T extends FilterablePost>(posts: T[], f: PostFilters, now = new Date()): T[] {
  const q = normalizeSearch(f.q)
  const window = dateWindow(f, now)
  const out = posts.filter(
    (p) => (f.status === 'all' || p.status === f.status) && matchesAllButStatus(p, f, q, now, window)
  )
  const { column, dir } = sortState(f.sort)
  const sign = dir === 'asc' ? 1 : -1
  if (column === 'title') {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
    out.sort((a, b) => sign * collator.compare(a.title ?? '', b.title ?? ''))
  } else if (column === 'ends') {
    // Posts without an end date always come last.
    const end = (p: T) => (p.expiresAt ? Date.parse(p.expiresAt) || null : null)
    out.sort((a, b) => {
      const x = end(a)
      const y = end(b)
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
      return sign * (x - y)
    })
  } else {
    const key = (p: T) => Date.parse(column === 'updated' ? p.updatedAt : p.primaryDate) || 0
    out.sort((a, b) => sign * (key(a) - key(b)))
  }
  return out
}

/** Counts per status tab, respecting every other active filter. */
export function statusCounts<T extends FilterablePost>(posts: T[], f: PostFilters, now = new Date()) {
  const q = normalizeSearch(f.q)
  const window = dateWindow(f, now)
  const counts: Record<PostStatus | 'all', number> = { all: 0, published: 0, scheduled: 0, draft: 0, offline: 0 }
  for (const p of posts) {
    if (!matchesAllButStatus(p, f, q, now, window)) continue
    counts.all++
    counts[p.status]++
  }
  return counts
}

/** Years that actually have posts, newest first. */
export function postYears(posts: FilterablePost[]): string[] {
  const years = new Set<string>()
  for (const p of posts) {
    const d = new Date(p.primaryDate)
    if (!Number.isNaN(d.getTime())) years.add(String(d.getFullYear()))
  }
  return [...years].sort().reverse()
}
