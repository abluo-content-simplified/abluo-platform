/**
 * Testimonials list filtering for the client dashboard (ADR-048 D9) — the same
 * shape as faq-sets-filter.ts. Pure functions, no React, so the rules are
 * unit-tested (src/lib/client/__tests__/testimonials-filter.test.ts) and the
 * component only wires them to the URL.
 *
 * A site has a handful (a few dozen) of testimonials, so everything runs in the
 * browser on the already-loaded list. Search matches the name AND the texts in
 * every language (`searchText`, built by the server).
 *
 * "All" means everything that is not put away: archived testimonials show only
 * under their own status (ADR-032, as Posts and FAQ sets).
 */

import { normalizeSearch } from './posts-filter'

export type TestimonialListState = 'draft' | 'scheduled' | 'published' | 'changes' | 'unpublished' | 'archived'
export type TestimonialSortColumn = 'name' | 'rating' | 'updated'
export type TestimonialSort = { column: TestimonialSortColumn; dir: 'asc' | 'desc' }

/** The minimum a row needs for filtering. */
export type FilterableTestimonial = {
  id: string
  /** Display name (already falls back to "Anonymous" / "Untitled"). */
  name: string
  /** Lower-cased name + every text in every language (server-built). */
  searchText: string
  state: TestimonialListState
  rating: number | null
  /** ISO */
  updatedAt: string
}

export type TestimonialFilters = {
  q: string
  status: TestimonialListState | 'all'
  sort: TestimonialSort
}

export const DEFAULT_TESTIMONIAL_FILTERS: TestimonialFilters = {
  q: '',
  status: 'all',
  sort: { column: 'updated', dir: 'desc' },
}

export const TESTIMONIAL_STATES: readonly TestimonialListState[] = ['published', 'changes', 'draft', 'scheduled', 'unpublished', 'archived']
const COLUMNS: readonly string[] = ['name', 'rating', 'updated']

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, best rated / newest first). */
export function nextTestimonialSort(column: TestimonialSortColumn, current: TestimonialSort): TestimonialSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'name' ? 'asc' : 'desc' }
}

/** "All" hides archived testimonials; any other status shows exactly that status. */
export function matchesTestimonialStatus(state: TestimonialListState, filter: TestimonialFilters['status']): boolean {
  return filter === 'all' ? state !== 'archived' : state === filter
}

/** The testimonials matching `f`, sorted by `f.sort` (ties: name A→Z; no rating sorts last). */
export function applyTestimonialFilters<T extends FilterableTestimonial>(rows: T[], f: TestimonialFilters): T[] {
  const q = normalizeSearch(f.q.trim())
  const out = rows.filter((s) => matchesTestimonialStatus(s.state, f.status) && (!q || normalizeSearch(`${s.name} ${s.searchText}`).includes(q)))
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  return out.sort((a, b) => {
    if (f.sort.column === 'name') return sign * collator.compare(a.name, b.name)
    if (f.sort.column === 'rating') {
      if (a.rating === null && b.rating !== null) return 1
      if (b.rating === null && a.rating !== null) return -1
      const d = (a.rating ?? 0) - (b.rating ?? 0)
      return d !== 0 ? sign * d : collator.compare(a.name, b.name)
    }
    const d = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
    return d !== 0 ? sign * d : collator.compare(a.name, b.name)
  })
}

/** Counts per status option, respecting the search ("all" = not archived). */
export function testimonialStateCounts(rows: FilterableTestimonial[], f: TestimonialFilters): Record<TestimonialListState | 'all', number> {
  const q = normalizeSearch(f.q.trim())
  const counts: Record<TestimonialListState | 'all', number> = { all: 0, published: 0, changes: 0, draft: 0, scheduled: 0, unpublished: 0, archived: 0 }
  for (const s of rows) {
    if (q && !normalizeSearch(`${s.name} ${s.searchText}`).includes(q)) continue
    if (s.state !== 'archived') counts.all++
    counts[s.state]++
  }
  return counts
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseTestimonialFilters(params: URLSearchParams): TestimonialFilters {
  const d = DEFAULT_TESTIMONIAL_FILTERS
  const status = params.get('status') ?? 'all'
  const column = params.get('sort') ?? d.sort.column
  const dir = params.get('dir')
  const sortColumn = COLUMNS.includes(column) ? (column as TestimonialSortColumn) : d.sort.column
  return {
    q: params.get('q') ?? '',
    status: (TESTIMONIAL_STATES as readonly string[]).includes(status) ? (status as TestimonialListState) : 'all',
    sort: {
      column: sortColumn,
      dir: dir === 'asc' || dir === 'desc' ? dir : sortColumn === d.sort.column ? d.sort.dir : sortColumn === 'name' ? 'asc' : 'desc',
    },
  }
}

/** Writes only non-default filters, so a clean list has a clean URL. Other params (e.g. `new`, `tab`) are not filters. */
export function testimonialFiltersToParams(f: TestimonialFilters): URLSearchParams {
  const d = DEFAULT_TESTIMONIAL_FILTERS
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.sort.column !== d.sort.column || f.sort.dir !== d.sort.dir) {
    p.set('sort', f.sort.column)
    p.set('dir', f.sort.dir)
  }
  return p
}

/** Everything except the sort is as on page load. */
export function isDefaultTestimonialFilters(f: TestimonialFilters): boolean {
  return testimonialFiltersToParams({ ...f, sort: DEFAULT_TESTIMONIAL_FILTERS.sort }).toString() === ''
}

/** Narrowing filters beyond the defaults (search and sort excluded) — the phone sheet's badge. */
export function activeTestimonialFilterCount(f: TestimonialFilters): number {
  return f.status !== 'all' ? 1 : 0
}
