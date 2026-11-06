import { describe, expect, it } from 'vitest'
import type { ClassRule } from '@/lib/scheduling/recurrence'
import type { ClassView, EditionView, PlaceOption } from '@/lib/api/course-schedule'
import {
  applyRepeatKey,
  canEndOn,
  canStartOn,
  repeatDraftOf,
  repeatKeyOf,
  repeatKeys,
  ruleOfDraft,
  snapDates,
  classLanguages,
  currentEditionId,
  defaultStartsOn,
  groupByPlace,
  timeOptions,
  timesOrdered,
  todayIn,
  weekdaysWithClasses,
} from '../schedule-model'

const DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const ed = (id: string, startsOn: string, endsOn: string): EditionView => ({
  id,
  label: {},
  startsOn,
  endsOn,
  timeZone: 'Europe/Brussels',
  version: 1,
})
const cls = (id: string, weekday: number, placeToken: string): ClassView => ({
  id,
  courseId: 'c',
  editionId: null,
  weekday,
  weekdays: [weekday],
  repeat: { kind: 'weekly', weekdays: [weekday], interval: 1 },
  rule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${DAY[weekday - 1]}`,
  interval: 1,
  startTime: '18:00',
  endTime: null,
  timeZone: 'Europe/Brussels',
  startsOn: null,
  endsOn: null,
  placeToken,
  attendanceMode: 'inPerson',
  instructors: [],
  languages: [],
  meetingRoomId: null,
  meetingRoomLabel: null,
  version: 1,
})

describe('schedule model', () => {
  it('picks the running term, else the next, else the last', () => {
    const eds = [ed('a', '2026-01-01', '2026-06-30'), ed('b', '2026-09-01', '2026-12-17')]
    expect(currentEditionId(eds, '2026-10-01')).toBe('b')
    expect(currentEditionId(eds, '2026-07-15')).toBe('b')
    expect(currentEditionId(eds, '2027-02-01')).toBe('b')
    expect(currentEditionId([], '2026-10-01')).toBe('')
  })

  it('a new class starts today, or when its term starts', () => {
    expect(defaultStartsOn(undefined, '2026-11-04')).toBe('2026-11-04')
    expect(defaultStartsOn(ed('b', '2027-01-07', '2027-06-30'), '2026-11-04')).toBe('2027-01-07')
    expect(defaultStartsOn(ed('a', '2026-09-01', '2026-12-17'), '2026-11-04')).toBe('2026-11-04')
  })

  it('today is read in the site zone', () => {
    expect(todayIn('Pacific/Auckland', new Date('2026-11-03T23:30:00Z'))).toBe('2026-11-04')
    expect(todayIn('America/Los_Angeles', new Date('2026-11-04T05:00:00Z'))).toBe('2026-11-03')
  })

  it('groups classes by place in the site order, unplaced last, and lists weekdays that have classes', () => {
    const places: PlaceOption[] = [
      { token: 'location:brey', name: 'Brey', kind: 'location' },
      { token: 'location:l51', name: 'L51', kind: 'location' },
    ]
    const rows = groupByPlace([cls('1', 3, 'location:l51'), cls('2', 1, 'location:brey'), cls('3', 3, ''), cls('4', 5, 'location:gone')], places)
    expect(rows.map((r) => [r.token, r.items.map((c) => c.id)])).toEqual([
      ['location:brey', ['2']],
      ['location:l51', ['1']],
      ['', ['3', '4']],
    ])
    expect(weekdaysWithClasses([cls('1', 5, ''), cls('2', 1, ''), cls('3', 5, '')])).toEqual([1, 5])
  })

  it('time options are 15-minute steps; an off-grid time stays; end must follow start', () => {
    expect(timeOptions().length).toBe(96)
    expect(timeOptions('18:10')).toContain('18:10')
    expect(timesOrdered('18:00', '19:00')).toBe(true)
    expect(timesOrdered('18:00', '18:00')).toBe(false)
    expect(timesOrdered('18:00', '')).toBe(true)
    expect(classLanguages(['fr', 'en', 'pt-BR'])).toEqual(['fr', 'en'])
  })
})

describe('the repeat of a class in the sheet', () => {
  it('turns a stored rule into form values and back', () => {
    for (const rule of [
      { kind: 'once' },
      { kind: 'weekly', weekdays: [1, 3], interval: 2 },
      { kind: 'monthlyWeekday', ordinal: -1, weekday: 7 },
      { kind: 'monthlyDay', day: 15 },
    ] as ClassRule[])
      expect(ruleOfDraft(repeatDraftOf(rule, '2026-12-14'))).toEqual(rule)
    // an unknown stored rule shows as weekly on the weekday of the first date (a Monday)
    expect(ruleOfDraft(repeatDraftOf(null, '2026-12-14'))).toEqual({
      kind: 'weekly',
      weekdays: [1],
      interval: 1,
    })
  })
  it('a weekly class with no day is incomplete', () => {
    expect(
      ruleOfDraft({
        ...repeatDraftOf({ kind: 'weekly', weekdays: [1], interval: 1 }, '2026-12-14'),
        weekdays: [],
      })
    ).toBeNull()
  })
  it('the Repeats select', () => {
    const d = repeatDraftOf({ kind: 'weekly', weekdays: [4], interval: 1 }, '2026-12-17')
    expect(repeatKeys(d)).toEqual(['once', 'weekly:1', 'weekly:2', 'weekly:3', 'weekly:4', 'monthlyWeekday', 'monthlyDay'])
    expect(repeatKeys({ ...d, interval: 6 })).toContain('weekly:6')
    expect(repeatKeyOf(applyRepeatKey(d, 'weekly:2'))).toBe('weekly:2')
    expect(applyRepeatKey(d, 'monthlyDay').kind).toBe('monthlyDay')
    expect(applyRepeatKey(applyRepeatKey(d, 'monthlyDay'), 'weekly:1').weekdays).toEqual([4]) // switching back loses nothing
    expect(applyRepeatKey(d, 'nonsense')).toBe(d)
  })
  it('only class days can be picked', () => {
    const thu: ClassRule = { kind: 'weekly', weekdays: [4], interval: 1 }
    expect(canStartOn(thu, '2026-12-17')).toBe(true)
    expect(canStartOn(thu, '2026-12-18')).toBe(false)
    expect(canEndOn(thu, '2026-12-31', '2026-12-17')).toBe(true)
    expect(canEndOn(thu, '2026-12-10', '2026-12-17')).toBe(false) // before the first
    const biweekly: ClassRule = { kind: 'weekly', weekdays: [4], interval: 2 }
    expect(canEndOn(biweekly, '2026-12-24', '2026-12-17')).toBe(false)
    expect(canEndOn(biweekly, '2026-12-31', '2026-12-17')).toBe(true)
  })
  it('moves the dates to the days that fit', () => {
    const mon: ClassRule = { kind: 'weekly', weekdays: [1], interval: 1 }
    // Thursday 17 Dec → the next Monday; last date Thursday 31 Dec → the previous Monday
    expect(snapDates(mon, '2026-12-17', '2026-12-31')).toEqual({
      startsOn: '2026-12-21',
      endsOn: '2026-12-28',
      adjusted: true,
    })
    expect(snapDates(mon, '2026-12-21', '2026-12-28')).toEqual({
      startsOn: '2026-12-21',
      endsOn: '2026-12-28',
      adjusted: false,
    })
    // a last date that no longer fits moves back to the previous class day; before the first date it is cleared
    expect(snapDates(mon, '2026-12-21', '2026-12-23')).toEqual({ startsOn: '2026-12-21', endsOn: '2026-12-21', adjusted: true })
    expect(snapDates(mon, '2026-12-21', '2026-12-14')).toEqual({ startsOn: '2026-12-21', endsOn: '', adjusted: true })
    // a first date the person just picked is trusted
    expect(snapDates(mon, '2026-12-17', '', true).startsOn).toBe('2026-12-17')
    // once has no last date
    expect(snapDates({ kind: 'once' }, '2026-12-17', '2026-12-31')).toEqual({
      startsOn: '2026-12-17',
      endsOn: '',
      adjusted: true,
    })
    // monthly: day 31 skips short months, the first date moves to the next one
    expect(snapDates({ kind: 'monthlyDay', day: 31 }, '2026-02-01', '').startsOn).toBe('2026-03-31')
    expect(snapDates({ kind: 'monthlyWeekday', ordinal: -1, weekday: 7 }, '2026-12-01', '2027-02-28').endsOn).toBe('2027-02-28')
  })
  it('a multi-day class is on every weekday it meets', () => {
    expect(weekdaysWithClasses([{ ...cls('a', 1, ''), weekdays: [1, 3] }, cls('b', 5, '')])).toEqual([1, 3, 5])
  })
})
