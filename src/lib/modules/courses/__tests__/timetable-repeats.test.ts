import { describe, expect, it } from 'vitest'
import { buildPrintMonth, patternOccursOn, shapeTimetable, type ShapeInput } from '../timetable'
import { COURSES, COURSE_A, LOCATIONS, PEOPLE, S1, series, occ } from './timetable-fixtures'

const base = (over: Partial<ShapeInput>): ShapeInput => ({
  window: { from: '2026-12-01', to: '2026-12-31' },
  locale: 'en',
  defaultLocale: 'en',
  timeZone: 'Europe/Brussels',
  courses: COURSES,
  occurrences: [],
  series: [],
  closures: [],
  people: PEOPLE,
  siteLocations: LOCATIONS,
  venues: [],
  rooms: [],
  includeOnlineDetails: false,
  ...over,
})

/** The weekday columns that hold at least one class (the sheet always has seven). */
const usedDays = (p: ReturnType<typeof buildPrintMonth>) => [...new Set(p.rows.flatMap((r) => Object.keys(r.cells).map(Number)))].sort((a, b) => a - b)
const monWed = series({ id: S1, ownerPublicId: COURSE_A, startLocal: '2026-12-02T18:00', endLocal: '2026-12-02T19:00', rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE', weekday: 1, weekdays: [1, 3] })
const lastSun = series({ id: S1, ownerPublicId: COURSE_A, startLocal: '2026-11-29T10:00', endLocal: null, rule: 'FREQ=MONTHLY;BYDAY=-1SU', weekday: 7, weekdays: [7] })
const once = series({ id: S1, ownerPublicId: COURSE_A, startLocal: '2026-12-12T10:00', endLocal: null, rule: 'FREQ=DAILY;COUNT=1', weekday: 6, weekdays: [6], startsOn: '2026-12-12', endsOn: '2026-12-12' })
const day15 = series({ id: S1, ownerPublicId: COURSE_A, startLocal: '2026-12-15T10:00', endLocal: null, rule: 'FREQ=MONTHLY;BYMONTHDAY=15', weekday: 2, weekdays: [2] })

describe('patternOccursOn follows the stored repeat', () => {
  it('several weekdays, every 2 weeks', () => {
    const s = { ...monWed, rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', interval: 2, startLocal: '2026-12-02T18:00' }
    expect(patternOccursOn(s, '2026-12-02')).toBe(true)
    expect(patternOccursOn(s, '2026-12-07')).toBe(false) // Monday of the next (off) week
    expect(patternOccursOn(s, '2026-12-14')).toBe(true)
    expect(patternOccursOn(s, '2026-12-16')).toBe(true)
    expect(patternOccursOn(s, '2026-12-03')).toBe(false)
  })
  it('last Sunday of the month', () => {
    expect(patternOccursOn(lastSun, '2026-12-27')).toBe(true)
    expect(patternOccursOn(lastSun, '2026-12-20')).toBe(false)
    expect(patternOccursOn(lastSun, '2027-01-31')).toBe(true)
  })
  it('once, and day of the month', () => {
    expect(patternOccursOn(once, '2026-12-12')).toBe(true)
    expect(patternOccursOn(once, '2026-12-19')).toBe(false)
    expect(patternOccursOn(day15, '2027-01-15')).toBe(true)
    expect(patternOccursOn(day15, '2027-01-16')).toBe(false)
  })
  it('a row without a rule still reads as weekly on its weekday', () => {
    expect(patternOccursOn({ ...monWed, rule: null, weekday: 3, interval: 1 }, '2026-12-09')).toBe(true)
  })
})

describe('shapeTimetable and the print sheet with other repeats', () => {
  it('a multi-day class keeps both weekdays, and sits in both print columns', () => {
    const o = [occ('a', monWed, '2026-12-02'), occ('b', monWed, '2026-12-07'), occ('c', monWed, '2026-12-09')]
    const data = shapeTimetable(base({ series: [monWed], occurrences: o }))
    expect(data.series[0]).toMatchObject({ weekday: 1, weekdays: [1, 3], rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE' })
    const print = buildPrintMonth(data, '2026-12')
    expect(usedDays(print)).toEqual([1, 3]); expect(print.weekdays).toHaveLength(7)
    expect(print.rows[0].cells[1]).toHaveLength(1)
    expect(print.rows[0].cells[3]).toHaveLength(1)
  })
  it('a holiday on a Wednesday of a Monday+Wednesday class is a closed date; first/last class around it use both days', () => {
    const closures = [{ id: 'c', editionId: null, startsOn: '2026-12-09', endsOn: '2026-12-09', label: {} }]
    const data = shapeTimetable(base({ series: [monWed], occurrences: [occ('a', monWed, '2026-12-02'), occ('b', monWed, '2026-12-07')], closures }))
    expect(data.closures[0]).toMatchObject({ lastClass: '2026-12-07', firstClass: '2026-12-14' })
    const print = buildPrintMonth(data, '2026-12')
    expect(print.rows[0].cells[3][0].exceptions).toContainEqual({ kind: 'closed', date: '2026-12-09' })
  })
  it('last Sunday of the month: one print column, closed date found', () => {
    const closures = [{ id: 'c', editionId: null, startsOn: '2026-12-27', endsOn: '2026-12-27', label: {} }]
    const data = shapeTimetable(base({ series: [lastSun], occurrences: [occ('a', lastSun, '2026-11-29')], closures, window: { from: '2026-11-01', to: '2026-12-31' } }))
    expect(data.closures[0]).toMatchObject({ lastClass: '2026-11-29', firstClass: '2027-01-31' })
    const print = buildPrintMonth(shapeTimetable(base({ series: [lastSun], occurrences: [occ('a', lastSun, '2026-12-27')], closures: [] })), '2026-12')
    expect(usedDays(print)).toEqual([7]); expect(print.weekdays).toHaveLength(7)
  })
  it('a once class appears and is dropped by the window when outside it', () => {
    const inside = shapeTimetable(base({ series: [once], occurrences: [occ('a', once, '2026-12-12')] }))
    expect(inside.series).toHaveLength(1)
    expect(usedDays(buildPrintMonth(inside, '2026-12'))).toEqual([6]); expect(buildPrintMonth(inside, '2026-12').weekdays).toHaveLength(7)
    expect(patternOccursOn(once, '2026-12-12')).toBe(true)
  })
})

describe('print sheet placement', () => {
  const closure = (d: string) => ({ id: 'c', editionId: null, startsOn: d, endsOn: d, label: {} })

  it('a monthly-by-date class is in the column of the weekday it falls on THAT month, with its date', () => {
    // day 15: Tuesday in Dec 2026, Thursday in Jul 2026
    const dec = buildPrintMonth(shapeTimetable(base({ series: [day15], occurrences: [occ('a', day15, '2026-12-15')] })), '2026-12')
    expect(usedDays(dec)).toEqual([2]); expect(dec.weekdays).toHaveLength(7)
    expect(dec.rows[0].cells[2][0]).toMatchObject({ dates: ['2026-12-15'], start: '10:00' })
    const jul = buildPrintMonth(shapeTimetable(base({ series: [day15], occurrences: [occ('a', day15, '2026-07-15')], window: { from: '2026-07-01', to: '2026-07-31' } })), '2026-07')
    expect(usedDays(jul)).toEqual([3]); expect(jul.weekdays).toHaveLength(7) // Wednesday 15 July 2026
    expect(jul.rows[0].cells[3][0].dates).toEqual(['2026-07-15'])
    expect(jul.rows[0].cells[2]).toBeUndefined()
  })

  it('last Sunday and once get their dates too; weekly classes have none', () => {
    const l = buildPrintMonth(shapeTimetable(base({ series: [lastSun], occurrences: [occ('a', lastSun, '2026-12-27')] })), '2026-12')
    expect(l.rows[0].cells[7][0].dates).toEqual(['2026-12-27'])
    const o = buildPrintMonth(shapeTimetable(base({ series: [once], occurrences: [occ('a', once, '2026-12-12')] })), '2026-12')
    expect(o.rows[0].cells[6][0].dates).toEqual(['2026-12-12'])
    const w = buildPrintMonth(shapeTimetable(base({ series: [monWed], occurrences: [occ('a', monWed, '2026-12-02')] })), '2026-12')
    expect(w.rows[0].cells[1][0].dates).toBeNull()
  })

  it('multi-day weekly: each column only carries the exceptions and holiday dates of its own weekday', () => {
    const o = [occ('a', monWed, '2026-12-07'), occ('b', monWed, '2026-12-09', { status: 'cancelled' }), occ('c', monWed, '2026-12-14')]
    const data = shapeTimetable(base({ series: [monWed], occurrences: o, closures: [closure('2026-12-16')] }))
    const cells = buildPrintMonth(data, '2026-12').rows[0].cells
    expect(cells[1][0].exceptions).toEqual([])
    expect(cells[3][0].exceptions.map((e) => [e.kind, e.date])).toEqual([['cancelled', '2026-12-09'], ['closed', '2026-12-16']])
  })
})
