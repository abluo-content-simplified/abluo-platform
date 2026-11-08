import { describe, expect, it } from 'vitest'
import type { ClassView, PlaceOption } from '@/lib/api/course-schedule'
import { ANY, DEFAULT_TIMETABLE_FILTERS, activeTimetableFilterCount, filterClasses, filterOptions, isDefaultTimetableFilters, parseTimetableFilters, sanitizeFilters, timetableFiltersToParams } from '../timetable-filter'

const cls = (id: string, courseId: string, weekdays: number[], placeToken: string, teachers: [string, string][], languages: string[]): ClassView =>
  ({ id, courseId, weekday: weekdays[0], weekdays, placeToken, instructors: teachers.map(([publicId, name]) => ({ publicId, name })), languages }) as unknown as ClassView

const courses = { yoga: 'Yoga Flow', pil: 'Pilates', cafe: 'Café français' }
const places: PlaceOption[] = [
  { token: 'location:a', name: 'Studio A', kind: 'location' },
  { token: 'venue:b', name: 'Hall B', kind: 'venue' },
]
const all = [
  cls('1', 'yoga', [1], 'location:a', [['p1', 'José Müller']], ['en']),
  cls('2', 'pil', [3, 5], 'venue:b', [['p2', 'Anna Rossi']], ['it', 'en']),
  cls('3', 'cafe', [3], '', [], ['fr']),
]
const f = (p: Partial<typeof DEFAULT_TIMETABLE_FILTERS>) => ({ ...DEFAULT_TIMETABLE_FILTERS, ...p })
const ids = (l: ClassView[]) => l.map((c) => c.id)

describe('filterClasses', () => {
  it('returns everything by default', () => expect(ids(filterClasses(all, courses, f({})))).toEqual(['1', '2', '3']))
  it('searches course names, ignoring case and accents', () => {
    expect(ids(filterClasses(all, courses, f({ q: 'CAFE' })))).toEqual(['3'])
    expect(ids(filterClasses(all, courses, f({ q: 'yoga' })))).toEqual(['1'])
  })
  it('searches teacher names, ignoring accents', () => expect(ids(filterClasses(all, courses, f({ q: 'jose muller' })))).toEqual(['1']))
  it('filters by place, including no place', () => {
    expect(ids(filterClasses(all, courses, f({ place: 'venue:b' })))).toEqual(['2'])
    expect(ids(filterClasses(all, courses, f({ place: 'none' })))).toEqual(['3'])
  })
  it('filters by teacher, day and language', () => {
    expect(ids(filterClasses(all, courses, f({ teacher: 'p2' })))).toEqual(['2'])
    expect(ids(filterClasses(all, courses, f({ day: '3' })))).toEqual(['2', '3'])
    expect(ids(filterClasses(all, courses, f({ language: 'en' })))).toEqual(['1', '2'])
  })
  it('combines filters', () => expect(ids(filterClasses(all, courses, f({ day: '3', language: 'en', q: 'pil' })))).toEqual(['2']))
  it('can come out empty', () => expect(filterClasses(all, courses, f({ q: 'zumba' }))).toEqual([]))
})

describe('options, state and URL', () => {
  it('builds options from the classes present', () => {
    const o = filterOptions([all[0], all[1]], places)
    expect(o.places.map((p) => p.token)).toEqual(['location:a', 'venue:b'])
    expect(o.teachers.map((t) => t.name)).toEqual(['Anna Rossi', 'José Müller'])
    expect(o.days).toEqual([1, 3, 5])
    expect(o.languages).toEqual(['en', 'it'])
    expect(filterOptions([all[0]], places).places).toHaveLength(1)
  })
  it('drops saved filters that no longer exist', () => {
    const o = filterOptions([all[0]], places)
    const s = sanitizeFilters(f({ place: 'venue:b', teacher: 'p2', day: '5', language: 'fr', q: 'x' }), o, false)
    expect(s).toEqual(f({ q: 'x' }))
  })
  it('counts and detects defaults', () => {
    expect(isDefaultTimetableFilters(f({ q: '  ' }))).toBe(true)
    expect(activeTimetableFilterCount(f({ q: 'a', day: '1' }))).toBe(2)
  })
  it('round-trips through the URL', () => {
    const x = f({ q: 'yoga', place: 'none', day: '2' })
    expect(parseTimetableFilters(timetableFiltersToParams(x))).toEqual(x)
    expect(timetableFiltersToParams(f({})).toString()).toBe('')
    expect(ANY).toBe('all')
  })
})
