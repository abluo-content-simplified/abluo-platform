import { describe, expect, it } from 'vitest'
import type { ClassView, EditionView, PlaceOption } from '@/lib/api/course-schedule'
import { classLanguages, currentEditionId, defaultStartsOn, groupByPlace, timeOptions, timesOrdered, todayIn, weekdaysWithClasses } from '../schedule-model'

const ed = (id: string, startsOn: string, endsOn: string): EditionView => ({ id, label: {}, startsOn, endsOn, timeZone: 'Europe/Brussels', version: 1 })
const cls = (id: string, weekday: number, placeToken: string): ClassView => ({
  id, courseId: 'c', editionId: null, weekday, interval: 1, startTime: '18:00', endTime: null, timeZone: 'Europe/Brussels', startsOn: null, endsOn: null,
  placeToken, attendanceMode: 'inPerson', instructors: [], languages: [], meetingRoomId: null, meetingRoomLabel: null, version: 1,
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
