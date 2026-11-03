/**
 * People list filtering for the client dashboard (ADR-043 D8) — the same shape
 * as faq-sets-filter.ts. Pure functions, no React, so the rules are unit-tested
 * (src/lib/client/__tests__/persons-filter.test.ts) and the component only
 * wires them to the URL.
 *
 * A site has tens of people, so everything runs in the browser on the loaded
 * list. Search matches names, job titles (every language) and group keys
 * (`searchText`, built by the server).
 *
 * "All" means everyone who is not put away: archived people show only under
 * their own status (ADR-032, as Posts and FAQ sets). The default sort is the
 * site-wide order (D6) — the order the server delivers; it is also the only
 * sort in which a person can be dragged to a new place.
 */

import { normalizeSearch } from './posts-filter'

export type PersonListState = 'draft' | 'published' | 'changes' | 'archived'
export type PersonVisibilityFilter = 'all' | 'off' | 'listed' | 'page'
export type PersonSortColumn = 'order' | 'name' | 'updated'
export type PersonSort = { column: PersonSortColumn; dir: 'asc' | 'desc' }

/** The minimum a row needs for filtering. */
export type FilterablePerson = {
  id: string
  /** Display name ('' when anonymised). */
  name: string
  /** Lower-cased names, job titles and group keys (server-built). */
  searchText: string
  state: PersonListState
  groups: string[]
  visibility: 'off' | 'listed' | 'page'
  /** ISO */
  updatedAt: string
}

export type PersonFilters = {
  q: string
  status: PersonListState | 'all'
  /** A group key, or 'all'. */
  group: string
  visibility: PersonVisibilityFilter
  sort: PersonSort
}

export const DEFAULT_PERSON_FILTERS: PersonFilters = {
  q: '',
  status: 'all',
  group: 'all',
  visibility: 'all',
  sort: { column: 'order', dir: 'asc' },
}

export const PERSON_STATES: readonly PersonListState[] = ['published', 'changes', 'draft', 'archived']
const VISIBILITIES: readonly string[] = ['all', 'off', 'listed', 'page']
const COLUMNS: readonly string[] = ['order', 'name', 'updated']

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, newest first). */
export function nextPersonSort(column: PersonSortColumn, current: PersonSort): PersonSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'updated' ? 'desc' : 'asc' }
}

/** "All" hides archived people; any other status shows exactly that status. */
export function matchesPersonStatus(state: PersonListState, filter: PersonFilters['status']): boolean {
  return filter === 'all' ? state !== 'archived' : state === filter
}

function matchesAllButStatus(p: FilterablePerson, f: PersonFilters, q: string): boolean {
  if (q && !normalizeSearch(`${p.name} ${p.searchText}`).includes(q)) return false
  if (f.group !== 'all' && !p.groups.includes(f.group)) return false
  if (f.visibility !== 'all' && p.visibility !== f.visibility) return false
  return true
}

/**
 * The people matching `f`, sorted by `f.sort`. "order" keeps the incoming
 * (site-wide) order — descending reverses it.
 */
export function applyPersonFilters<T extends FilterablePerson>(rows: T[], f: PersonFilters): T[] {
  const q = normalizeSearch(f.q.trim())
  const out = rows.filter((p) => matchesPersonStatus(p.state, f.status) && matchesAllButStatus(p, f, q))
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  if (f.sort.column === 'order') return sign === 1 ? out : out.reverse()
  if (f.sort.column === 'name') return out.sort((a, b) => sign * collator.compare(a.name, b.name))
  return out.sort((a, b) => {
    const d = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
    return d !== 0 ? sign * d : collator.compare(a.name, b.name)
  })
}

/** Counts per status option, respecting every other active filter ("all" = not archived). */
export function personStateCounts(rows: FilterablePerson[], f: PersonFilters): Record<PersonListState | 'all', number> {
  const q = normalizeSearch(f.q.trim())
  const counts: Record<PersonListState | 'all', number> = { all: 0, published: 0, changes: 0, draft: 0, archived: 0 }
  for (const p of rows) {
    if (!matchesAllButStatus(p, f, q)) continue
    if (p.state !== 'archived') counts.all++
    counts[p.state]++
  }
  return counts
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parsePersonFilters(params: URLSearchParams): PersonFilters {
  const d = DEFAULT_PERSON_FILTERS
  const status = params.get('status') ?? 'all'
  const visibility = params.get('visibility') ?? 'all'
  const column = params.get('sort') ?? d.sort.column
  const dir = params.get('dir')
  const sortColumn = COLUMNS.includes(column) ? (column as PersonSortColumn) : d.sort.column
  return {
    q: params.get('q') ?? '',
    status: (PERSON_STATES as readonly string[]).includes(status) ? (status as PersonListState) : 'all',
    group: (params.get('group') ?? 'all').slice(0, 80) || 'all',
    visibility: VISIBILITIES.includes(visibility) ? (visibility as PersonVisibilityFilter) : 'all',
    sort: {
      column: sortColumn,
      dir: dir === 'asc' || dir === 'desc' ? dir : sortColumn === 'updated' ? 'desc' : 'asc',
    },
  }
}

/** Writes only non-default filters, so a clean list has a clean URL. Other params (e.g. `new`) are not filters. */
export function personFiltersToParams(f: PersonFilters): URLSearchParams {
  const d = DEFAULT_PERSON_FILTERS
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.group !== 'all') p.set('group', f.group)
  if (f.visibility !== 'all') p.set('visibility', f.visibility)
  if (f.sort.column !== d.sort.column || f.sort.dir !== d.sort.dir) {
    p.set('sort', f.sort.column)
    p.set('dir', f.sort.dir)
  }
  return p
}

/** Everything except the sort is as on page load. */
export function isDefaultPersonFilters(f: PersonFilters): boolean {
  return personFiltersToParams({ ...f, sort: DEFAULT_PERSON_FILTERS.sort }).toString() === ''
}

/** Narrowing filters beyond the defaults (search and sort excluded) — the phone sheet's badge. */
export function activePersonFilterCount(f: PersonFilters): number {
  return (f.status !== 'all' ? 1 : 0) + (f.group !== 'all' ? 1 : 0) + (f.visibility !== 'all' ? 1 : 0)
}

/**
 * Dragging a person to a new place changes the site-wide order, which is only
 * meaningful while the whole list is in view in that order: no search, no
 * filter (archived people are hidden under "All", which is fine — they keep
 * their place), sorted by "order" ascending.
 */
export function canReorderPersons(f: PersonFilters): boolean {
  return f.q.trim() === '' && f.status === 'all' && f.group === 'all' && f.visibility === 'all' && f.sort.column === 'order' && f.sort.dir === 'asc'
}
