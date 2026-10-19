/**
 * FAQ Sets list filtering for the client dashboard (ADR-037 D9) — the same
 * shape as galleries-filter.ts. Pure functions, no React, so the rules are
 * unit-tested (src/lib/client/__tests__/faq-sets-filter.test.ts) and the
 * component only wires them to the URL.
 *
 * Sites have a handful of FAQ sets, so everything runs in the browser on the
 * already-loaded list. Search matches the set's name AND its questions in
 * every language (`searchText`, built by the server).
 *
 * "All" means everything that is not put away: archived sets show only under
 * their own status (ADR-032 slice 6, as Posts).
 */

import { normalizeSearch } from './posts-filter'

export type FaqSetListState = 'draft' | 'published' | 'changes' | 'archived'
export type FaqUsageFilter = 'all' | 'used' | 'unused'
export type FaqSortColumn = 'name' | 'questions' | 'updated'
export type FaqSort = { column: FaqSortColumn; dir: 'asc' | 'desc' }

/** The minimum a row needs for filtering. */
export type FilterableFaqSet = {
  id: string
  /** Display name (already falls back to "Untitled"). */
  name: string
  /** Lower-cased name + every question in every language (server-built). */
  searchText: string
  state: FaqSetListState
  /** Used on at least one page or post. */
  used: boolean
  count: number
  /** ISO */
  updatedAt: string
}

export type FaqSetFilters = {
  q: string
  status: FaqSetListState | 'all'
  usage: FaqUsageFilter
  sort: FaqSort
}

export const DEFAULT_FAQ_FILTERS: FaqSetFilters = {
  q: '',
  status: 'all',
  usage: 'all',
  sort: { column: 'updated', dir: 'desc' },
}

export const FAQ_SET_STATES: readonly FaqSetListState[] = ['published', 'changes', 'draft', 'archived']
const USAGES: readonly string[] = ['all', 'used', 'unused']
const COLUMNS: readonly string[] = ['name', 'questions', 'updated']

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, most questions / newest first). */
export function nextFaqSort(column: FaqSortColumn, current: FaqSort): FaqSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'name' ? 'asc' : 'desc' }
}

/** "All" hides archived sets; any other status shows exactly that status. */
export function matchesFaqStatus(state: FaqSetListState, filter: FaqSetFilters['status']): boolean {
  return filter === 'all' ? state !== 'archived' : state === filter
}

function matchesAllButStatus(s: FilterableFaqSet, f: FaqSetFilters, q: string): boolean {
  if (q && !normalizeSearch(`${s.name} ${s.searchText}`).includes(q)) return false
  if (f.usage === 'used' && !s.used) return false
  if (f.usage === 'unused' && s.used) return false
  return true
}

/** The sets matching `f`, sorted by `f.sort` (ties: name A→Z). */
export function applyFaqFilters<T extends FilterableFaqSet>(rows: T[], f: FaqSetFilters): T[] {
  const q = normalizeSearch(f.q.trim())
  const out = rows.filter((s) => matchesFaqStatus(s.state, f.status) && matchesAllButStatus(s, f, q))
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  const key = (s: T): number => (f.sort.column === 'questions' ? s.count : Date.parse(s.updatedAt) || 0)
  return out.sort((a, b) => {
    if (f.sort.column === 'name') return sign * collator.compare(a.name, b.name)
    const d = key(a) - key(b)
    return d !== 0 ? sign * d : collator.compare(a.name, b.name)
  })
}

/** Counts per status option, respecting every other active filter ("all" = not archived). */
export function faqStateCounts(rows: FilterableFaqSet[], f: FaqSetFilters): Record<FaqSetListState | 'all', number> {
  const q = normalizeSearch(f.q.trim())
  const counts: Record<FaqSetListState | 'all', number> = { all: 0, published: 0, changes: 0, draft: 0, archived: 0 }
  for (const s of rows) {
    if (!matchesAllButStatus(s, f, q)) continue
    if (s.state !== 'archived') counts.all++
    counts[s.state]++
  }
  return counts
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseFaqFilters(params: URLSearchParams): FaqSetFilters {
  const d = DEFAULT_FAQ_FILTERS
  const status = params.get('status') ?? 'all'
  const usage = params.get('usage') ?? 'all'
  const column = params.get('sort') ?? d.sort.column
  const dir = params.get('dir')
  const sortColumn = COLUMNS.includes(column) ? (column as FaqSortColumn) : d.sort.column
  return {
    q: params.get('q') ?? '',
    status: (FAQ_SET_STATES as readonly string[]).includes(status) ? (status as FaqSetListState) : 'all',
    usage: USAGES.includes(usage) ? (usage as FaqUsageFilter) : 'all',
    sort: {
      column: sortColumn,
      dir: dir === 'asc' || dir === 'desc' ? dir : sortColumn === d.sort.column ? d.sort.dir : sortColumn === 'name' ? 'asc' : 'desc',
    },
  }
}

/** Writes only non-default filters, so a clean list has a clean URL. Other params (e.g. `new`) are not filters. */
export function faqFiltersToParams(f: FaqSetFilters): URLSearchParams {
  const d = DEFAULT_FAQ_FILTERS
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.usage !== 'all') p.set('usage', f.usage)
  if (f.sort.column !== d.sort.column || f.sort.dir !== d.sort.dir) {
    p.set('sort', f.sort.column)
    p.set('dir', f.sort.dir)
  }
  return p
}

/** Everything except the sort is as on page load. */
export function isDefaultFaqFilters(f: FaqSetFilters): boolean {
  return faqFiltersToParams({ ...f, sort: DEFAULT_FAQ_FILTERS.sort }).toString() === ''
}

/** Narrowing filters beyond the defaults (search and sort excluded) — the phone sheet's badge. */
export function activeFaqFilterCount(f: FaqSetFilters): number {
  return (f.status !== 'all' ? 1 : 0) + (f.usage !== 'all' ? 1 : 0)
}
