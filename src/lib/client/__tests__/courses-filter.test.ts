import { describe, expect, it } from 'vitest'
import { applyCourseFilters, courseStateCounts, DEFAULT_COURSE_FILTERS, parseCourseFilters, type FilterableCourse } from '../courses-filter'

const row = (id: string, state: FilterableCourse['state']): FilterableCourse => ({ id, title: id, searchText: '', state, updatedAt: '2026-11-01T00:00:00Z' })
const rows = [row('a', 'published'), row('b', 'scheduled'), row('c', 'draft'), row('d', 'archived'), row('e', 'changes')]

describe('courses filter — Scheduled status', () => {
  it('"All" includes scheduled courses; the Scheduled filter shows exactly them', () => {
    expect(applyCourseFilters(rows, DEFAULT_COURSE_FILTERS).map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'e'])
    expect(applyCourseFilters(rows, { ...DEFAULT_COURSE_FILTERS, status: 'scheduled' }).map((r) => r.id)).toEqual(['b'])
  })
  it('counts them and reads ?status=scheduled', () => {
    expect(courseStateCounts(rows, DEFAULT_COURSE_FILTERS)).toEqual({ all: 4, published: 1, changes: 1, scheduled: 1, unpublished: 0, draft: 1, archived: 1 })
    expect(parseCourseFilters(new URLSearchParams('status=scheduled')).status).toBe('scheduled')
  })
})

import { ANY_COURSE, applyCourseFilters as apply2, courseFiltersToParams as toParams2, parseCourseFilters as parse2, activeCourseFilterCount as active2, isDefaultCourseFilters as isDefault2, DEFAULT_COURSE_FILTERS as D2, courseStateCounts as counts2, type FilterableCourse as FC } from '../courses-filter'

describe('courses filter — teacher, place, language, day, term, changed this week, no image/description (2026-11-08)', () => {
  const rows: FC[] = [
    { id: 'hatha', title: 'Hatha', searchText: 'hatha julie mero', state: 'published', updatedAt: '2026-11-01T00:00:00Z', teacherIds: ['t-julie'], placeTokens: ['location:mero'], languages: ['en', 'fr'], weekdays: [1, 3], termIds: ['autumn'], changedThisWeek: true, incomplete: false },
    { id: 'iyengar', title: 'Iyengar', searchText: 'iyengar larissa l51', state: 'unpublished', updatedAt: '2026-11-02T00:00:00Z', teacherIds: ['t-larissa'], placeTokens: ['location:l51'], languages: ['fr'], weekdays: [2], termIds: ['autumn'], changedThisWeek: false, incomplete: true },
    { id: 'yin', title: 'Yin', searchText: 'yin', state: 'draft', updatedAt: '2026-11-03T00:00:00Z' },
  ]
  const ids = (f: Partial<typeof D2>) => apply2(rows, { ...D2, ...f }).map((r) => r.id).sort()

  it('each filter narrows; a row without schedule data matches only "any"', () => {
    expect(ids({ teacher: 't-julie' })).toEqual(['hatha'])
    expect(ids({ place: 'location:l51' })).toEqual(['iyengar'])
    expect(ids({ language: 'en' })).toEqual(['hatha'])
    expect(ids({ day: '2' })).toEqual(['iyengar'])
    expect(ids({ term: 'autumn' })).toEqual(['hatha', 'iyengar'])
    expect(ids({ changed: true })).toEqual(['hatha'])
    expect(ids({ incomplete: true })).toEqual(['iyengar'])
    expect(ids({})).toEqual(['hatha', 'iyengar', 'yin'])
  })

  it('search matches place names (in searchText)', () => {
    expect(ids({ q: 'MERO' })).toEqual(['hatha'])
  })

  it('status counts respect the other filters; Unpublished is its own status', () => {
    expect(counts2(rows, { ...D2, term: 'autumn' })).toMatchObject({ all: 2, published: 1, unpublished: 1, draft: 0 })
    expect(ids({ status: 'unpublished' })).toEqual(['iyengar'])
  })

  it('round-trips through the URL; unknown values fall back to "any"', () => {
    const f = { ...D2, teacher: 't-julie', place: 'location:mero', language: 'fr', day: '3', term: 'autumn', changed: true, incomplete: true }
    expect(parse2(toParams2(f))).toEqual(f)
    expect(toParams2(D2).toString()).toBe('')
    const bad = parse2(new URLSearchParams('day=9&teacher=<x>&changed=yes'))
    expect([bad.day, bad.teacher, bad.changed]).toEqual([ANY_COURSE, ANY_COURSE, false])
    expect(active2(f)).toBe(7)
    expect(isDefault2(D2)).toBe(true)
    expect(isDefault2({ ...D2, changed: true })).toBe(false)
  })
})
