/**
 * Courses list filtering for the client dashboard (ADR-045) — same shape as
 * persons-filter.ts. Pure functions, no React, so the rules are unit-tested
 * (src/lib/client/__tests__/courses-filter.test.ts) and the component only
 * wires them to the URL.
 *
 * A site has tens of courses, so everything runs in the browser on the loaded
 * list. "All" means everything that is not put away: archived courses show only
 * under their own status (ADR-032, as Posts and People).
 *
 * Filters (Tom, 2026-11-08): status, teacher, place, language, weekday, term,
 * "Changed this week" and "No image or description" (the Needs-attention
 * strip's link); the search also matches teachers and place names.
 */

import { normalizeSearch } from './posts-filter'

export type CourseListState = 'draft' | 'scheduled' | 'published' | 'changes' | 'unpublished' | 'archived'
export type CourseSortColumn = 'title' | 'updated'
export type CourseSort = { column: CourseSortColumn; dir: 'asc' | 'desc' }

/** "Any" for the select filters. */
export const ANY_COURSE = 'all'

/** The minimum a row needs for filtering. */
export type FilterableCourse = {
  id: string
  title: string
  /** Lower-cased titles, descriptions, teachers and place names. */
  searchText: string
  state: CourseListState
  /** ISO */
  updatedAt: string
  /** Regular teachers' People publicIds. */
  teacherIds?: readonly string[]
  /** Place tokens of the classes. */
  placeTokens?: readonly string[]
  languages?: readonly string[]
  /** 1 = Monday … 7 = Sunday. */
  weekdays?: readonly number[]
  termIds?: readonly string[]
  /** A date of the course differs from its class this week. */
  changedThisWeek?: boolean
  /** No image or no short description. */
  incomplete?: boolean
}

export type CourseFilters = {
  q: string
  status: CourseListState | 'all'
  /** ANY_COURSE or a People publicId. */
  teacher: string
  /** ANY_COURSE or a place token. */
  place: string
  /** ANY_COURSE or a language code. */
  language: string
  /** ANY_COURSE or '1'..'7'. */
  day: string
  /** ANY_COURSE or a term id. */
  term: string
  changed: boolean
  incomplete: boolean
  sort: CourseSort
}

export const DEFAULT_COURSE_FILTERS: CourseFilters = {
  q: '',
  status: 'all',
  teacher: ANY_COURSE,
  place: ANY_COURSE,
  language: ANY_COURSE,
  day: ANY_COURSE,
  term: ANY_COURSE,
  changed: false,
  incomplete: false,
  sort: { column: 'updated', dir: 'desc' },
}

export const COURSE_STATES: readonly CourseListState[] = ['published', 'changes', 'scheduled', 'unpublished', 'draft', 'archived']
const COLUMNS: readonly string[] = ['title', 'updated']
const SELECTS = ['teacher', 'place', 'language', 'day', 'term'] as const
type SelectKey = (typeof SELECTS)[number]
const SAFE = /^[A-Za-z0-9:_-]{1,80}$/

/** Clicking a column header: flip when already sorted by it, else its natural order (A→Z, newest first). */
export function nextCourseSort(column: CourseSortColumn, current: CourseSort): CourseSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'updated' ? 'desc' : 'asc' }
}

/** "All" hides archived courses; any other status shows exactly that status. */
export function matchesCourseStatus(state: CourseListState, filter: CourseFilters['status']): boolean {
  return filter === 'all' ? state !== 'archived' : state === filter
}

const has = <T,>(list: readonly T[] | undefined, v: T) => (list ?? []).includes(v)

/** Every filter except status and the sort (status has its own counts). */
function matchesRest(c: FilterableCourse, f: CourseFilters, q: string): boolean {
  if (q && !normalizeSearch(`${c.title} ${c.searchText}`).includes(q)) return false
  if (f.teacher !== ANY_COURSE && !has(c.teacherIds, f.teacher)) return false
  if (f.place !== ANY_COURSE && !has(c.placeTokens, f.place)) return false
  if (f.language !== ANY_COURSE && !has(c.languages, f.language)) return false
  if (f.day !== ANY_COURSE && !has(c.weekdays, Number(f.day))) return false
  if (f.term !== ANY_COURSE && !has(c.termIds, f.term)) return false
  if (f.changed && !c.changedThisWeek) return false
  if (f.incomplete && !c.incomplete) return false
  return true
}

export function applyCourseFilters<T extends FilterableCourse>(rows: T[], f: CourseFilters): T[] {
  const q = normalizeSearch(f.q.trim())
  const out = rows.filter((c) => matchesCourseStatus(c.state, f.status) && matchesRest(c, f, q))
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const sign = f.sort.dir === 'asc' ? 1 : -1
  if (f.sort.column === 'title') return out.sort((a, b) => sign * collator.compare(a.title, b.title))
  return out.sort((a, b) => {
    const d = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)
    return d !== 0 ? sign * d : collator.compare(a.title, b.title)
  })
}

/** Counts per status option, respecting the search and the other filters ("all" = not archived). */
export function courseStateCounts(rows: FilterableCourse[], f: CourseFilters): Record<CourseListState | 'all', number> {
  const q = normalizeSearch(f.q.trim())
  const counts: Record<CourseListState | 'all', number> = { all: 0, published: 0, changes: 0, scheduled: 0, unpublished: 0, draft: 0, archived: 0 }
  for (const c of rows) {
    if (!matchesRest(c, f, q)) continue
    if (c.state !== 'archived') counts.all++
    counts[c.state]++
  }
  return counts
}

const flag = (v: string | null) => v === '1'

/** Reads filters from URL search params; anything unknown falls back to the default. */
export function parseCourseFilters(params: URLSearchParams): CourseFilters {
  const d = DEFAULT_COURSE_FILTERS
  const status = params.get('status') ?? 'all'
  const column = params.get('sort') ?? d.sort.column
  const dir = params.get('dir')
  const sortColumn = COLUMNS.includes(column) ? (column as CourseSortColumn) : d.sort.column
  const select = (key: SelectKey) => {
    const v = params.get(key)
    if (!v || !SAFE.test(v)) return ANY_COURSE
    if (key === 'day' && !/^[1-7]$/.test(v)) return ANY_COURSE
    return v
  }
  return {
    q: params.get('q') ?? '',
    status: (COURSE_STATES as readonly string[]).includes(status) ? (status as CourseListState) : 'all',
    teacher: select('teacher'),
    place: select('place'),
    language: select('language'),
    day: select('day'),
    term: select('term'),
    changed: flag(params.get('changed')),
    incomplete: flag(params.get('incomplete')),
    sort: { column: sortColumn, dir: dir === 'asc' || dir === 'desc' ? dir : sortColumn === 'updated' ? 'desc' : 'asc' },
  }
}

/** Filters → URL params (defaults are left out). */
export function courseFiltersToParams(f: CourseFilters): URLSearchParams {
  const p = new URLSearchParams()
  const d = DEFAULT_COURSE_FILTERS
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.status !== 'all') p.set('status', f.status)
  for (const key of SELECTS) if (f[key] !== ANY_COURSE) p.set(key, f[key])
  if (f.changed) p.set('changed', '1')
  if (f.incomplete) p.set('incomplete', '1')
  if (f.sort.column !== d.sort.column || f.sort.dir !== d.sort.dir) {
    p.set('sort', f.sort.column)
    p.set('dir', f.sort.dir)
  }
  return p
}

/** How many filters are set (search and sort not counted). */
export function activeCourseFilterCount(f: CourseFilters): number {
  return (f.status !== 'all' ? 1 : 0) + SELECTS.filter((k) => f[k] !== ANY_COURSE).length + (f.changed ? 1 : 0) + (f.incomplete ? 1 : 0)
}

export function isDefaultCourseFilters(f: CourseFilters): boolean {
  return !f.q.trim() && activeCourseFilterCount(f) === 0
}
