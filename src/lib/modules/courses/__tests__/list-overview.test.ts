/**
 * What the Courses list says about each course (Tom, 2026-11-08): the class
 * lines, the nearest change, "runs until", the one status pill and the
 * "Needs attention" strip. Pure helpers; dates are site-local 'YYYY-MM-DD'.
 */
import { describe, expect, it } from 'vitest'
import type { CourseException, CourseScheduleSummary } from '@/lib/api/course-drafts'
import {
  courseAttention,
  courseStatusItems,
  isIncompleteCourse,
  nextException,
  runsUntil,
  seriesLastDate,
  siteToday,
  toggleExpanded,
  visibleWhen,
  weekChanges,
  weekOf,
  whenLines,
  type CourseStatusInput,
} from '../list-overview'

const TODAY = '2026-11-12' // a Thursday
const summary = (o: Partial<CourseScheduleSummary> = {}): CourseScheduleSummary => ({ classes: 1, teachers: [], nextClassAt: null, slots: [], exceptions: [], lastDate: null, openEnded: false, ...o })
const ex = (date: string, kind: CourseException['kind'], placeToken = '', startTime = '12:30'): CourseException => ({ date, kind, placeToken, startTime })

describe('dates', () => {
  it('today in the site zone, and its Monday–Sunday week', () => {
    expect(siteToday(new Date('2026-11-12T23:30:00Z'), 'Europe/Brussels')).toBe('2026-11-13')
    expect(siteToday(new Date('2026-11-12T23:30:00Z'), 'America/New_York')).toBe('2026-11-12')
    expect(siteToday(new Date('2026-11-12T10:00:00Z'), 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(weekOf(TODAY)).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(weekOf('2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(weekOf('2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
  })
})

describe('the last class date', () => {
  const weekly = { rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TH', startsOn: '2026-09-03', startLocal: '2026-09-03T12:30' }
  it('the rule’s last date on or before the class end or the term end (earlier wins)', () => {
    expect(seriesLastDate({ ...weekly, endsOn: null }, '2026-11-30')).toEqual({ date: '2026-11-26', open: false })
    expect(seriesLastDate({ ...weekly, endsOn: '2026-11-20' }, '2026-11-30')).toEqual({ date: '2026-11-19', open: false })
  })
  it('no end at all → keeps going; a once class → its date; an end before the first date → none', () => {
    expect(seriesLastDate({ ...weekly, endsOn: null }, null)).toEqual({ date: null, open: true })
    expect(seriesLastDate({ rule: 'FREQ=DAILY;COUNT=1', startsOn: '2026-12-01', startLocal: '2026-12-01T10:00', endsOn: '2026-12-01' }, null)).toEqual({ date: '2026-12-01', open: false })
    expect(seriesLastDate({ ...weekly, endsOn: '2026-09-01' }, null)).toEqual({ date: null, open: false })
  })
})

describe('When lines', () => {
  const slots = [
    { seriesId: 'b', weekday: 4, startTime: '18:00', placeToken: 'location:l51', mode: 'inPerson' as const },
    { seriesId: 'a', weekday: 1, startTime: '12:30', placeToken: 'location:mero', mode: 'inPerson' as const },
    { seriesId: 'c', weekday: 1, startTime: '08:00', placeToken: '', mode: 'online' as const },
    { seriesId: 'd', weekday: 3, startTime: '19:00', placeToken: '', mode: 'mixed' as const },
    { seriesId: 'e', weekday: 6, startTime: '10:00', placeToken: 'venue:x', mode: 'inPerson' as const },
  ]
  const place = (t: string) => ({ 'location:mero': 'MERO', 'location:l51': 'L51' })[t] ?? ''
  it('Monday first, then by time; short place name; online says Online', () => {
    const lines = whenLines(slots, place, 'Online')
    expect(lines.map((l) => [l.weekday, l.time, l.place])).toEqual([
      [1, '08:00', 'Online'],
      [1, '12:30', 'MERO'],
      [3, '19:00', 'Online'],
      [4, '18:00', 'L51'],
      [6, '10:00', ''],
    ])
    expect(new Set(lines.map((l) => l.key)).size).toBe(5)
  })
  it('the first two, "+N" for the rest; all when expanded', () => {
    const lines = whenLines(slots, place, 'Online')
    expect(visibleWhen(lines, false)).toMatchObject({ more: 3 })
    expect(visibleWhen(lines, false).shown).toHaveLength(2)
    expect(visibleWhen(lines, true)).toMatchObject({ more: 0 })
    expect(visibleWhen(lines, true).shown).toHaveLength(5)
    expect(visibleWhen(lines.slice(0, 2), false).more).toBe(0)
  })
  it('only one row expanded at a time; the same row again closes it', () => {
    expect(toggleExpanded(null, 'hatha')).toBe('hatha')
    expect(toggleExpanded('hatha', 'iyengar')).toBe('iyengar')
    expect(toggleExpanded('iyengar', 'iyengar')).toBeNull()
  })
})

describe('next class: the nearest change in the next 14 days', () => {
  it('today included, the earliest wins, past and later ones are ignored', () => {
    const list = [ex('2026-11-10', 'cancelled'), ex('2026-11-26', 'cancelled'), ex('2026-11-17', 'substitute'), ex('2026-11-16', 'moved', 'location:l51'), ex('2026-11-12', 'timeChanged', '', '18:00')]
    expect(nextException(list, TODAY)).toEqual(ex('2026-11-12', 'timeChanged', '', '18:00'))
    expect(nextException(list.slice(0, 4), TODAY)).toEqual(ex('2026-11-16', 'moved', 'location:l51'))
    expect(nextException([ex('2026-11-27', 'cancelled')], TODAY)).toBeNull()
    expect(nextException([ex('2026-11-26', 'cancelled')], TODAY)).toEqual(ex('2026-11-26', 'cancelled'))
    expect(nextException(undefined, TODAY)).toBeNull()
  })
})

describe('this week', () => {
  it('counts Monday to Sunday only, cancelled ones too', () => {
    const week = weekOf(TODAY)
    expect(weekChanges([ex('2026-11-08', 'cancelled'), ex('2026-11-09', 'cancelled'), ex('2026-11-15', 'substitute'), ex('2026-11-16', 'moved')], week)).toEqual({ changes: 2, cancelled: 1 })
  })
})

describe('runs until', () => {
  it('the last date; ends soon within 14 days, today included', () => {
    expect(runsUntil(summary({ lastDate: '2026-11-26' }), TODAY)).toEqual({ date: '2026-11-26', endsSoon: true, daysLeft: 14 })
    expect(runsUntil(summary({ lastDate: '2026-11-27' }), TODAY)).toMatchObject({ endsSoon: false, daysLeft: 15 })
    expect(runsUntil(summary({ lastDate: TODAY }), TODAY)).toMatchObject({ endsSoon: true, daysLeft: 0 })
    expect(runsUntil(summary({ lastDate: '2026-11-01' }), TODAY)).toMatchObject({ endsSoon: false })
  })
  it('keeps going or unknown → no date', () => {
    expect(runsUntil(summary({ lastDate: '2026-11-20', openEnded: true }), TODAY)).toEqual({ date: null, endsSoon: false, daysLeft: null })
    expect(runsUntil(null, TODAY)).toEqual({ date: null, endsSoon: false, daysLeft: null })
  })
})

describe('status: one pill, most important first', () => {
  const base: CourseStatusInput = { state: 'published', isPublished: true, publishedAt: null, unpublishOn: null, schedule: summary({ classes: 3, lastDate: '2027-01-30' }), hasPageAddress: true, missingLanguages: [] }
  const kinds = (o: Partial<CourseStatusInput>, coursePages = true) => courseStatusItems({ ...base, ...o }, { today: TODAY, coursePages }).map((i) => i.kind)
  it('published and healthy → Live only', () => {
    expect(kinds({})).toEqual(['live'])
  })
  it('warnings take precedence over Live, in this order', () => {
    expect(kinds({ schedule: summary({ classes: 0 }) })).toEqual(['noClasses', 'live'])
    expect(kinds({ hasPageAddress: false })).toEqual(['noAddress', 'live'])
    expect(kinds({ hasPageAddress: false }, false)).toEqual(['live'])
    expect(kinds({ schedule: summary({ classes: 2, lastDate: '2026-11-20' }) })).toEqual(['endsSoon', 'live'])
    expect(kinds({ schedule: summary({ classes: 0 }), hasPageAddress: false, missingLanguages: ['de'], unpublishOn: '2026-12-01T10:00:00Z', state: 'changes' })).toEqual(['noClasses', 'noAddress', 'missing', 'unpublishOn', 'changes', 'live'])
  })
  it('the lifecycle comes first: Draft / Scheduled for … / Unpublished / Archived (alone)', () => {
    expect(kinds({ state: 'draft', isPublished: false, hasPageAddress: false })).toEqual(['draft'])
    expect(courseStatusItems({ ...base, state: 'scheduled', publishedAt: '2026-12-01T08:00:00Z' }, { today: TODAY, coursePages: true })[0]).toEqual({ kind: 'scheduled', at: '2026-12-01T08:00:00Z' })
    expect(kinds({ state: 'unpublished', schedule: summary({ classes: 2, lastDate: '2026-11-20' }) })).toEqual(['unpublished'])
    expect(kinds({ state: 'archived', schedule: summary({ classes: 0 }), hasPageAddress: false })).toEqual(['archived'])
  })
  it('ends in N days carries the days', () => {
    expect(courseStatusItems({ ...base, schedule: summary({ classes: 1, lastDate: '2026-11-17' }) }, { today: TODAY, coursePages: true })[0]).toEqual({ kind: 'endsSoon', days: 5 })
  })
})

describe('Needs attention', () => {
  const course = (o: Partial<{ state: CourseStatusInput['state']; shortDescription: string; hasImage: boolean; schedule: CourseScheduleSummary | null }> = {}) => ({ state: 'published' as const, shortDescription: 'Yoga for all', hasImage: true, schedule: summary({ classes: 2, lastDate: '2026-11-30' }), ...o })

  it('the schedule ends within 21 days and nothing is after it', () => {
    expect(courseAttention([course(), course({ schedule: summary({ classes: 1, lastDate: '2026-11-26' }) })], [], TODAY)).toEqual([{ kind: 'termEnding', date: '2026-11-30' }])
  })
  it('… not when a later term exists, a class keeps going, it is further away or already over', () => {
    expect(courseAttention([course()], [{ startsOn: '2027-01-11', endsOn: '2027-06-30' }], TODAY)).toEqual([])
    expect(courseAttention([course(), course({ schedule: summary({ classes: 1, openEnded: true }) })], [], TODAY)).toEqual([])
    expect(courseAttention([course({ schedule: summary({ classes: 1, lastDate: '2026-12-04' }) })], [], TODAY)).toEqual([])
    expect(courseAttention([course({ schedule: summary({ classes: 1, lastDate: '2026-11-11' }) })], [], TODAY)).toEqual([])
    // Archived courses and courses without classes don't decide it.
    expect(courseAttention([course({ schedule: summary({ classes: 1, lastDate: '2027-02-01' }) }), course({ state: 'archived', schedule: summary({ classes: 1, lastDate: '2026-11-20' }) })], [], TODAY)).toEqual([])
  })
  it('this week: N changes, M cancelled', () => {
    const s = summary({ classes: 1, openEnded: true, exceptions: [ex('2026-11-13', 'cancelled'), ex('2026-11-10', 'substitute'), ex('2026-11-20', 'cancelled')] })
    expect(courseAttention([course({ schedule: s })], [], TODAY)).toEqual([{ kind: 'weekChanges', changes: 2, cancelled: 1 }])
  })
  it('courses without an image or a description (archived ones left out)', () => {
    const open = summary({ classes: 1, openEnded: true })
    const list = [course({ schedule: open, hasImage: false }), course({ schedule: open, shortDescription: '  ' }), course({ schedule: open }), course({ state: 'archived', hasImage: false })]
    expect(courseAttention(list, [], TODAY)).toEqual([{ kind: 'incomplete', count: 2 }])
    expect(isIncompleteCourse({ state: 'draft', shortDescription: '', hasImage: true })).toBe(true)
    expect(isIncompleteCourse({ state: 'archived', shortDescription: '', hasImage: false })).toBe(false)
  })
  it('only what is true, in a fixed order', () => {
    const s = summary({ classes: 1, lastDate: '2026-11-30', exceptions: [ex('2026-11-13', 'cancelled')] })
    expect(courseAttention([course({ schedule: s, hasImage: false })], [], TODAY).map((i) => i.kind)).toEqual(['termEnding', 'weekChanges', 'incomplete'])
    expect(courseAttention([], [], TODAY)).toEqual([])
  })
})
