import { describe, expect, it } from 'vitest'
import { MAX_EXPANDED_SESSIONS, addDays, expandWeekly, formatWeeklyRule, parseWeeklyRule, weekdayOf } from '../recurrence'
import { ScheduleError } from '../types'

const base = { weekday: 1, interval: 1, startTime: '18:00', endTime: '19:30', timeZone: 'Europe/Brussels', from: '2026-03-16', until: '2026-04-06', anchor: '2026-03-16' }

describe('weekly rule text', () => {
  it('formats and parses round-trip', () => {
    expect(formatWeeklyRule({ weekday: 3, interval: 2 })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE')
    for (let weekday = 1; weekday <= 7; weekday++) expect(parseWeeklyRule(formatWeeklyRule({ weekday, interval: 5 }))).toEqual({ weekday, interval: 5 })
  })
  it('parses parts in any order and defaults INTERVAL to 1', () => {
    expect(parseWeeklyRule('BYDAY=SU;FREQ=WEEKLY')).toEqual({ weekday: 7, interval: 1 })
  })
  it('rejects anything else', () => {
    for (const r of ['FREQ=DAILY', 'FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,TU', 'FREQ=WEEKLY;BYDAY=MO;INTERVAL=0', 'FREQ=WEEKLY;BYDAY=MO;INTERVAL=99', 'FREQ=WEEKLY;BYDAY=MO;COUNT=3', 'nope', '', null, undefined]) {
      expect(parseWeeklyRule(r as string)).toBeNull()
    }
  })
  it('refuses to format a bad weekday or interval', () => {
    expect(() => formatWeeklyRule({ weekday: 0, interval: 1 })).toThrow(ScheduleError)
    expect(() => formatWeeklyRule({ weekday: 8, interval: 1 })).toThrow(ScheduleError)
    expect(() => formatWeeklyRule({ weekday: 1, interval: 0 })).toThrow(ScheduleError)
    expect(() => formatWeeklyRule({ weekday: 1, interval: 1.5 })).toThrow(ScheduleError)
  })
})

describe('date helpers', () => {
  it('weekdayOf / addDays', () => {
    expect(weekdayOf('2026-03-16')).toBe(1) // Monday
    expect(weekdayOf('2026-03-29')).toBe(7)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(() => addDays('2026-02-30', 1)).toThrow(ScheduleError)
  })
})

describe('expandWeekly', () => {
  it('lists the weekly dates of the window with local and UTC times', () => {
    const r = expandWeekly(base)
    expect(r.sessions.map((s) => s.originalStartLocal)).toEqual(['2026-03-16T18:00', '2026-03-23T18:00', '2026-03-30T18:00', '2026-04-06T18:00'])
    expect(r.closed).toEqual([])
    expect(r.sessions[0]).toMatchObject({ startLocal: '2026-03-16T18:00', endLocal: '2026-03-16T19:30', startsAt: '2026-03-16T17:00:00.000Z', endsAt: '2026-03-16T18:30:00.000Z' })
  })

  it('keeps 18:00 across the spring DST change (last Sunday of March 2026 = 29th)', () => {
    const r = expandWeekly({ ...base, weekday: 7, startTime: '10:00', endTime: '11:00', from: '2026-03-22', until: '2026-04-05', anchor: '2026-03-22' })
    expect(r.sessions.map((s) => s.startsAt)).toEqual(['2026-03-22T09:00:00.000Z', '2026-03-29T08:00:00.000Z', '2026-04-05T08:00:00.000Z'])
    expect(r.sessions.map((s) => s.startLocal)).toEqual(['2026-03-22T10:00', '2026-03-29T10:00', '2026-04-05T10:00'])
  })

  it('keeps the wall-clock time across the autumn DST change (last Sunday of October 2026 = 25th)', () => {
    const r = expandWeekly({ ...base, weekday: 7, startTime: '10:00', endTime: '11:00', from: '2026-10-18', until: '2026-11-01', anchor: '2026-10-18' })
    expect(r.sessions.map((s) => s.startsAt)).toEqual(['2026-10-18T08:00:00.000Z', '2026-10-25T09:00:00.000Z', '2026-11-01T09:00:00.000Z'])
  })

  it('a session in the spring gap moves to the first valid minute but keeps its rule key', () => {
    const r = expandWeekly({ ...base, weekday: 7, startTime: '02:30', endTime: '03:30', from: '2026-03-29', until: '2026-03-29', anchor: '2026-03-29' })
    expect(r.sessions).toHaveLength(1)
    expect(r.sessions[0].originalStartLocal).toBe('2026-03-29T02:30')
    expect(r.sessions[0].startLocal).toBe('2026-03-29T03:00')
    expect(r.sessions[0].startsAt).toBe('2026-03-29T01:00:00.000Z')
  })

  it('an autumn-overlap time takes the first instant', () => {
    const r = expandWeekly({ ...base, weekday: 7, startTime: '02:30', endTime: null, from: '2026-10-25', until: '2026-10-25', anchor: '2026-10-25' })
    expect(r.sessions[0].startsAt).toBe('2026-10-25T00:30:00.000Z') // CEST (first) 02:30
    expect(r.sessions[0].endLocal).toBeNull()
    expect(r.sessions[0].endsAt).toBeNull()
  })

  it('drops closure dates and reports them in `closed`', () => {
    const r = expandWeekly({ ...base, closures: [{ startsOn: '2026-03-20', endsOn: '2026-03-31' }] })
    expect(r.sessions.map((s) => s.originalStartLocal)).toEqual(['2026-03-16T18:00', '2026-04-06T18:00'])
    expect(r.closed).toEqual(['2026-03-23T18:00', '2026-03-30T18:00'])
  })

  it('closure ranges are inclusive on both ends', () => {
    const r = expandWeekly({ ...base, closures: [{ startsOn: '2026-03-23', endsOn: '2026-03-23' }] })
    expect(r.closed).toEqual(['2026-03-23T18:00'])
  })

  it('interval 2 keeps every second week counted from the anchor week', () => {
    const r = expandWeekly({ ...base, interval: 2, until: '2026-05-01' })
    expect(r.sessions.map((s) => s.originalStartLocal.slice(0, 10))).toEqual(['2026-03-16', '2026-03-30', '2026-04-13', '2026-04-27'])
  })

  it('interval > 1 aligns to the anchor even when the window starts mid-cycle or before the anchor', () => {
    const later = expandWeekly({ ...base, interval: 2, from: '2026-03-23', until: '2026-05-01' })
    expect(later.sessions.map((s) => s.originalStartLocal.slice(0, 10))).toEqual(['2026-03-30', '2026-04-13', '2026-04-27'])
    const before = expandWeekly({ ...base, interval: 2, from: '2026-03-02', until: '2026-03-31' })
    expect(before.sessions.map((s) => s.originalStartLocal.slice(0, 10))).toEqual(['2026-03-02', '2026-03-16', '2026-03-30'])
    // The anchor can be any day of its week: Thursday 19th is in the week of Monday 16th.
    const thu = expandWeekly({ ...base, interval: 2, anchor: '2026-03-19', until: '2026-04-14' })
    expect(thu.sessions.map((s) => s.originalStartLocal.slice(0, 10))).toEqual(['2026-03-16', '2026-03-30', '2026-04-13'])
  })

  it('weekday before the window start in the first week is skipped', () => {
    const r = expandWeekly({ ...base, weekday: 1, from: '2026-03-17', until: '2026-03-31' })
    expect(r.sessions.map((s) => s.originalStartLocal.slice(0, 10))).toEqual(['2026-03-23', '2026-03-30'])
  })

  it('until before from gives nothing', () => {
    expect(expandWeekly({ ...base, from: '2026-04-06', until: '2026-03-16' })).toEqual({ sessions: [], closed: [], truncated: false })
  })

  it('caps at 400 dates and says so', () => {
    const r = expandWeekly({ ...base, from: '2026-01-05', until: '2050-12-31', anchor: '2026-01-05' })
    expect(r.sessions).toHaveLength(MAX_EXPANDED_SESSIONS)
    expect(r.truncated).toBe(true)
    // Closed dates count toward the cap too, so an all-closed window cannot run away.
    const closed = expandWeekly({ ...base, from: '2026-01-05', until: '2050-12-31', anchor: '2026-01-05', closures: [{ startsOn: '2026-01-01', endsOn: '2050-12-31' }] })
    expect(closed.sessions).toHaveLength(0)
    expect(closed.closed).toHaveLength(MAX_EXPANDED_SESSIONS)
  })

  it('rejects invalid input', () => {
    const bad: Array<Partial<typeof base>> = [{ weekday: 0 }, { interval: 0 }, { startTime: '25:00' }, { endTime: '9:00' }, { from: '2026-02-30' }, { until: 'x' }, { anchor: '' }, { timeZone: 'Mars/Base' }]
    for (const b of bad) expect(() => expandWeekly({ ...base, ...b }), JSON.stringify(b)).toThrow(ScheduleError)
    expect(() => expandWeekly({ ...base, endTime: '17:00' })).toThrow(ScheduleError) // ends before it starts
    expect(() => expandWeekly({ ...base, closures: [{ startsOn: '2026-03-10', endsOn: '2026-03-01' }] })).toThrow(ScheduleError)
  })
})
