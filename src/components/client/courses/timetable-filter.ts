// Pure search + filters for the Timetable page. No React, no I/O.
import type { ClassView, PlaceOption } from '@/lib/api/course-schedule'
import { normalizeSearch } from '@/lib/client/posts-filter'

export const ANY = 'all'
/** The place value for classes without a place. */
export const NO_PLACE = 'none'

export type TimetableFilters = {
  q: string
  /** ANY, NO_PLACE or a place token. */
  place: string
  /** ANY or a person's publicId. */
  teacher: string
  /** ANY or '1'..'7' (Monday = 1). */
  day: string
  /** ANY or a language code. */
  language: string
}

export const DEFAULT_TIMETABLE_FILTERS: TimetableFilters = { q: '', place: ANY, teacher: ANY, day: ANY, language: ANY }

export const isDefaultTimetableFilters = (f: TimetableFilters): boolean =>
  !f.q.trim() && f.place === ANY && f.teacher === ANY && f.day === ANY && f.language === ANY

/** How many filters (search included) are set. */
export const activeTimetableFilterCount = (f: TimetableFilters): number =>
  (f.q.trim() ? 1 : 0) + [f.place, f.teacher, f.day, f.language].filter((v) => v !== ANY).length

/** Classes matching every set filter. `courses` is publicId → title. */
export function filterClasses(classes: readonly ClassView[], courses: Record<string, string>, f: TimetableFilters): ClassView[] {
  const q = normalizeSearch(f.q.trim())
  return classes.filter((c) => {
    if (q && !normalizeSearch(`${courses[c.courseId] ?? ''} ${c.instructors.map((p) => p.name).join(' ')}`).includes(q)) return false
    if (f.place !== ANY && (c.placeToken || NO_PLACE) !== f.place) return false
    if (f.teacher !== ANY && !c.instructors.some((p) => p.publicId === f.teacher)) return false
    if (f.day !== ANY && !c.weekdays.includes(Number(f.day))) return false
    if (f.language !== ANY && !c.languages.includes(f.language)) return false
    return true
  })
}

export type TimetableFilterOptions = {
  places: { token: string; name: string }[]
  teachers: { id: string; name: string }[]
  days: number[]
  languages: string[]
}

/** The choices that exist among these classes (place names from `places`, in their order). */
export function filterOptions(classes: readonly ClassView[], places: readonly PlaceOption[]): TimetableFilterOptions {
  const used = new Set(classes.map((c) => c.placeToken))
  const teachers = new Map<string, string>()
  for (const c of classes) for (const p of c.instructors) if (!teachers.has(p.publicId)) teachers.set(p.publicId, p.name)
  return {
    places: places.filter((p) => used.has(p.token)).map((p) => ({ token: p.token, name: p.name })),
    teachers: [...teachers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    days: [...new Set(classes.flatMap((c) => c.weekdays))].sort((a, b) => a - b),
    languages: [...new Set(classes.flatMap((c) => c.languages))].sort(),
  }
}

/** A saved filter that no longer exists among the options falls back to "all". */
export function sanitizeFilters(f: TimetableFilters, o: TimetableFilterOptions, hasUnplaced: boolean): TimetableFilters {
  return {
    ...f,
    place: f.place === ANY || o.places.some((p) => p.token === f.place) || (f.place === NO_PLACE && hasUnplaced) ? f.place : ANY,
    teacher: f.teacher === ANY || o.teachers.some((p) => p.id === f.teacher) ? f.teacher : ANY,
    day: f.day === ANY || o.days.includes(Number(f.day)) ? f.day : ANY,
    language: f.language === ANY || o.languages.includes(f.language) ? f.language : ANY,
  }
}

const KEYS = ['q', 'place', 'teacher', 'day', 'language'] as const

export function timetableFiltersToParams(f: TimetableFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q)
  for (const k of KEYS.slice(1)) if (f[k] !== ANY) p.set(k, f[k])
  return p
}

export function parseTimetableFilters(p: URLSearchParams): TimetableFilters {
  const d = DEFAULT_TIMETABLE_FILTERS
  return { q: p.get('q') ?? d.q, place: p.get('place') ?? d.place, teacher: p.get('teacher') ?? d.teacher, day: p.get('day') ?? d.day, language: p.get('language') ?? d.language }
}
