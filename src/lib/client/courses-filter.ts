/**
 * Courses list filtering for the client dashboard (ADR-045) — same shape as
 * persons-filter.ts. Pure functions, no React, so the rules are unit-tested
 * (src/lib/client/__tests__/courses-filter.test.ts) and the component only
 * wires them to the URL.
 *
 * A site has tens of courses, so everything runs in the browser on the loaded
 * list. "All" means everything that is not put away: archived courses show only
 * under their own status (ADR-032, as Posts and People).
 */

import { normalizeSearch } from './posts-filter'

export type CourseListState = 'draft' | 'scheduled' | 'published' | 'changes' | 'archived'
export type CourseSortColumn = 'title' | 'updated'
export type CourseSort = { column: CourseSortColumn; dir: 'asc' | 'desc' }

/** The minimum a row needs for filtering. */
export type FilterableCourse = {
  id: string
  title: string
  /** Lower-cased titles, descriptions and teachers (server-built). */
  searchText: string
  state: CourseListState
  /** ISO */
  updatedAt: string
}

export type CourseFilters = {
  q: string
  status: CourseListState | 'all'
  sort: CourseSort
}

export const DEFAULT_COURSE_FILTERS: CourseFilters = { q: '', status: 'all', sort: { column: 'updated', dir: 'desc' } }

export const COURSE_STATES: readonly CourseListState[] = ['published', 'changes', 'scheduled', 'draft', 'archived']
const COLUMNS: readonly string[] = ['title', 'updated']

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, newest first). */
export function nextCourseSort(column: CourseSortColumn, current: CourseSort): CourseSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'updated' ? 'desc' : 'asc' }
}

/** "All" hides archived courses; any other status shows exactly that status. */
export function matchesCourseStatus(state: CourseListState, filter: CourseFilters['status']): boolean {
  return filter === 'all' ? state !== 'archived' : state === filter
}

export function applyCourseFilters<T extends FilterableCourse>(rows: T[], f: CourseFilters): T[] {
  const q = normalizeSearch(f.q.trim())
  const out = rows.filter((c) => matchesCourseStatus(c.state, f.status) && (!q || normalizeSearch(`${c.title} ${c.searchText}`).includes(q)))
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  if (f.sort.column === 'title') return out.sort((a, b) => sign * collator.compare(a.title, b.title))
  return out.sort((a, b) => {
    const d = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
    return d !== 0 ? sign * d : collator.compare(a.title, b.title)
  })
}

/** Counts per status option, respecting the search ("all" = not archived). */
export function courseStateCounts(rows: FilterableCourse[], f: CourseFilters): Record<CourseListState | 'all', number> {
  const q = normalizeSearch(f.q.trim())
  const counts: Record<CourseListState | 'all', number> = { all: 0, published: 0, changes: 0, scheduled: 0, draft: 0, archived: 0 }
  for (const c of rows) {
    if (q && !normalizeSearch(`${c.title} ${c.searchText}`).includes(q)) continue
    if (c.state !== 'archived') counts.all++
    counts[c.state]++
  }
  return counts
}

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseCourseFilters(params: URLSearchParams): CourseFilters {
  const d = DEFAULT_COURSE_FILTERS
  const status = params.get('status') ?? 'all'
  const column = params.get('sort') ?? d.sort.column
  const dir = params.get('dir')
  const sortColumn = COLUMNS.includes(column) ? (column as CourseSortColumn) : d.sort.column
  return {
    q: params.get('q') ?? '',
    status: (COURSE_STATES as readonly string[]).includes(status) ? (status as CourseListState) : 'all',
    sort: { column: sortColumn, dir: dir === 'asc' || dir === 'desc' ? dir : sortColumn === 'updated' ? 'desc' : 'asc' },
  }
}

/** Filters → URL params (defaults are left out). */
export function courseFiltersToParams(f: CourseFilters): URLSearchParams {
  const p = new URLSearchParams()
  const d = DEFAULT_COURSE_FILTERS
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.status !== 'all') p.set('status', f.status)
  if (f.sort.column !== d.sort.column || f.sort.dir !== d.sort.dir) {
    p.set('sort', f.sort.column)
    p.set('dir', f.sort.dir)
  }
  return p
}

export function activeCourseFilterCount(f: CourseFilters): number {
  return f.status !== 'all' ? 1 : 0
}

export function isDefaultCourseFilters(f: CourseFilters): boolean {
  return !f.q.trim() && f.status === 'all'
}
