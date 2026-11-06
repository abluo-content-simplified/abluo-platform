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
    expect(courseStateCounts(rows, DEFAULT_COURSE_FILTERS)).toEqual({ all: 4, published: 1, changes: 1, scheduled: 1, draft: 1, archived: 1 })
    expect(parseCourseFilters(new URLSearchParams('status=scheduled')).status).toBe('scheduled')
  })
})
