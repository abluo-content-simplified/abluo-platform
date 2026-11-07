// Timetable filters (language, teacher, location, class). Pure: they narrow the
// data on screen; the printed month follows them too (and names them).

import { filterByLanguage, type TimetableData } from '@/lib/modules/courses/timetable'
import { placeShort } from './status'

export type Filters = { language: string | null; teacher: string | null; place: string | null; course: string | null }
export const NO_FILTERS: Filters = { language: null, teacher: null, place: null, course: null }

export const activeFilterCount = (f: Filters) => [f.language, f.teacher, f.place, f.course].filter(Boolean).length

export function applyFilters(data: TimetableData, f: Filters): TimetableData {
  const byLanguage = filterByLanguage(data, f.language)
  if (!f.teacher && !f.place && !f.course) return byLanguage
  const placeName = f.place ? data.places[f.place]?.name : null
  return {
    ...byLanguage,
    occurrences: byLanguage.occurrences.filter((o) => (!f.teacher || o.teacherIds.includes(f.teacher)) && (!f.place || o.placeKey === f.place) && (!f.course || o.courseId === f.course)),
    series: byLanguage.series.filter((s) => (!f.teacher || s.teacherIds.includes(f.teacher)) && (!f.place || s.placeKey === f.place) && (!f.course || s.courseId === f.course)),
    // Events carry no teacher or course: they stay for the place filter only when held there, and go with any teacher / class filter.
    events: byLanguage.events.filter((e) => !f.teacher && !f.course && (!f.place || e.placeName === placeName)),
  }
}

export type FilterOption = { value: string; label: string }

/** Options come from the loaded data only; the current choice is always kept so it can be cleared. */
export function filterOptions(data: TimetableData, current: Filters): { teachers: FilterOption[]; places: FilterOption[]; courses: FilterOption[] } {
  const teacherIds = new Set<string>()
  const placeKeys = new Set<string>()
  const courseIds = new Set<string>()
  for (const o of data.occurrences) {
    for (const t of o.teacherIds) teacherIds.add(t)
    if (o.placeKey) placeKeys.add(o.placeKey)
    courseIds.add(o.courseId)
  }
  const sorted = (list: FilterOption[]) => list.sort((a, b) => a.label.localeCompare(b.label))
  const teachers = sorted([...teacherIds].flatMap((id) => (data.teachers[id] ? [{ value: id, label: data.teachers[id].name }] : [])))
  // Places keep the order of Website Settings → Locations.
  const order = (k: string) => (data.placeOrder.includes(k) ? data.placeOrder.indexOf(k) : 1e6)
  const places = [...placeKeys].filter((k) => data.places[k]).sort((a, b) => order(a) - order(b)).map((k) => ({ value: k, label: placeShort(data.places[k]) }))
  const courses = sorted([...courseIds].flatMap((id) => (data.courses[id] ? [{ value: id, label: data.courses[id].title }] : [])))
  const keep = (list: FilterOption[], v: string | null, label: string | undefined) => (v && !list.some((o) => o.value === v) ? [...list, { value: v, label: label ?? v }] : list)
  return {
    teachers: keep(teachers, current.teacher, current.teacher ? data.teachers[current.teacher]?.name : undefined),
    places: keep(places, current.place, current.place ? placeShort(data.places[current.place]) : undefined),
    courses: keep(courses, current.course, current.course ? data.courses[current.course]?.title : undefined),
  }
}
