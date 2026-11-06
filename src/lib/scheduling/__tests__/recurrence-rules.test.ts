import { describe, expect, it } from 'vitest'
import { ONCE_RULE, expandRule, expandWeekly, formatClassRule, nextRuleDate, parseClassRule, previousRuleDate, ruleOccursOn, ruleWeekdays, type ClassRule } from '../recurrence'
import { ScheduleError } from '../types'

const tz = 'Europe/Brussels'
const run = (rule: ClassRule, from: string, until: string, anchor = from, extra: Partial<Parameters<typeof expandRule>[0]> = {}) =>
  expandRule({ rule, startTime: '18:00', endTime: '19:30', timeZone: tz, from, until, anchor, ...extra })
const dates = (r: ReturnType<typeof expandRule>) => r.sessions.map((s) => s.originalStartLocal.slice(0, 10))

describe('rule text', () => {
  it('round-trips every preset', () => {
    const rules: ClassRule[] = [
      { kind: 'once' },
      { kind: 'weekly', weekdays: [4], interval: 1 },
      { kind: 'weekly', weekdays: [1, 3], interval: 2 },
      { kind: 'monthlyWeekday', ordinal: 1, weekday: 1 },
      { kind: 'monthlyWeekday', ordinal: -1, weekday: 7 },
      { kind: 'monthlyDay', day: 15 },
    ]
    for (const r of rules) expect(parseClassRule(formatClassRule(r))).toEqual(r)
    expect(formatClassRule({ kind: 'once' })).toBe(ONCE_RULE)
    expect(formatClassRule({ kind: 'weekly', weekdays: [3, 1], interval: 2 })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')
    expect(formatClassRule({ kind: 'monthlyWeekday', ordinal: -1, weekday: 7 })).toBe('FREQ=MONTHLY;BYDAY=-1SU')
    expect(formatClassRule({ kind: 'monthlyDay', day: 31 })).toBe('FREQ=MONTHLY;BYMONTHDAY=31')
  })

  it('stored single-weekday rules keep their exact text and meaning', () => {
    expect(formatClassRule({ kind: 'weekly', weekdays: [1], interval: 1 })).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO')
    expect(parseClassRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH')).toEqual({ kind: 'weekly', weekdays: [4], interval: 2 })
    expect(parseClassRule('BYDAY=SU;FREQ=WEEKLY')).toEqual({ kind: 'weekly', weekdays: [7], interval: 1 })
    expect(parseClassRule('FREQ=WEEKLY;BYDAY=WE,MO;INTERVAL=3')).toEqual({ kind: 'weekly', weekdays: [1, 3], interval: 3 })
  })

  it('rejects anything outside the presets', () => {
    const bad = [
      'FREQ=DAILY', 'FREQ=DAILY;COUNT=2', 'FREQ=DAILY;INTERVAL=2;COUNT=1', 'FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO,MO', 'FREQ=WEEKLY;BYDAY=MO;INTERVAL=0',
      'FREQ=WEEKLY;BYDAY=MO;INTERVAL=53', 'FREQ=WEEKLY;BYDAY=MO;COUNT=3', 'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=MONTHLY', 'FREQ=MONTHLY;BYDAY=5MO',
      'FREQ=MONTHLY;BYDAY=MO', 'FREQ=MONTHLY;BYDAY=-2MO', 'FREQ=MONTHLY;BYMONTHDAY=0', 'FREQ=MONTHLY;BYMONTHDAY=32', 'FREQ=MONTHLY;BYMONTHDAY=-1',
      'FREQ=MONTHLY;BYDAY=1MO;BYMONTHDAY=3', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=3', 'FREQ=YEARLY', 'nope', '', null, undefined,
    ]
    for (const r of bad) expect(parseClassRule(r as string), String(r)).toBeNull()
  })

  it('refuses to format a value outside the presets', () => {
    for (const r of [
      { kind: 'weekly', weekdays: [], interval: 1 },
      { kind: 'weekly', weekdays: [8], interval: 1 },
      { kind: 'weekly', weekdays: [1], interval: 0 },
      { kind: 'monthlyWeekday', ordinal: 5, weekday: 1 },
      { kind: 'monthlyDay', day: 0 },
    ] as unknown as ClassRule[]) expect(() => formatClassRule(r)).toThrow(ScheduleError)
  })

  it('names the weekdays for readers of rule_weekday', () => {
    expect(ruleWeekdays({ kind: 'weekly', weekdays: [1, 3], interval: 1 }, null)).toEqual([1, 3])
    expect(ruleWeekdays({ kind: 'monthlyWeekday', ordinal: 2, weekday: 5 }, null)).toEqual([5])
    expect(ruleWeekdays({ kind: 'once' }, '2026-12-12')).toEqual([6]) // Saturday
    expect(ruleWeekdays({ kind: 'monthlyDay', day: 15 }, '2026-12-15')).toEqual([2])
  })
})

describe('once', () => {
  it('gives its single date, only when the window holds it', () => {
    expect(dates(run({ kind: 'once' }, '2026-12-01', '2027-12-31', '2026-12-12'))).toEqual(['2026-12-12'])
    expect(dates(run({ kind: 'once' }, '2026-12-13', '2027-12-31', '2026-12-12'))).toEqual([])
    expect(dates(run({ kind: 'once' }, '2026-12-01', '2026-12-11', '2026-12-12'))).toEqual([])
  })
  it('can be closed by a holiday', () => {
    const r = run({ kind: 'once' }, '2026-12-01', '2026-12-31', '2026-12-12', { closures: [{ startsOn: '2026-12-10', endsOn: '2026-12-14' }] })
    expect(r.sessions).toEqual([])
    expect(r.closed).toEqual(['2026-12-12T18:00'])
  })
})

describe('weekly with several days', () => {
  it('Monday and Wednesday, every week', () => {
    const r = run({ kind: 'weekly', weekdays: [1, 3], interval: 1 }, '2026-11-02', '2026-11-18')
    expect(dates(r)).toEqual(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18'])
  })
  it('every 2 weeks counts weeks from the anchor week, both days in the same week', () => {
    const r = run({ kind: 'weekly', weekdays: [1, 3], interval: 2 }, '2026-11-02', '2026-12-06')
    expect(dates(r)).toEqual(['2026-11-02', '2026-11-04', '2026-11-16', '2026-11-18', '2026-11-30', '2026-12-02'])
  })
  it('a start in mid-week skips the earlier days of that week but keeps the week count', () => {
    // anchor Wednesday 4 Nov: its week (Mon 2 Nov) is week 0; Monday 2 Nov is before the window
    const r = run({ kind: 'weekly', weekdays: [1, 3], interval: 2 }, '2026-11-04', '2026-11-30', '2026-11-04')
    expect(dates(r)).toEqual(['2026-11-04', '2026-11-16', '2026-11-18', '2026-11-30'])
  })
  it('a window that begins later still follows the anchor', () => {
    const r = run({ kind: 'weekly', weekdays: [1, 3], interval: 2 }, '2026-11-09', '2026-11-22', '2026-11-02')
    expect(dates(r)).toEqual(['2026-11-16', '2026-11-18'])
  })
  it('expandWeekly (single weekday) equals the weekly rule', () => {
    const a = expandWeekly({ weekday: 4, interval: 2, startTime: '18:00', endTime: null, timeZone: tz, from: '2026-11-05', until: '2027-01-31', anchor: '2026-11-05' })
    const b = run({ kind: 'weekly', weekdays: [4], interval: 2 }, '2026-11-05', '2027-01-31', '2026-11-05', { endTime: null })
    expect(a).toEqual(b)
    expect(dates(a)).toEqual(['2026-11-05', '2026-11-19', '2026-12-03', '2026-12-17', '2026-12-31', '2027-01-14', '2027-01-28'])
  })
})

describe('monthly on the nth weekday', () => {
  it('first Monday', () => {
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: 1, weekday: 1 }, '2026-11-01', '2027-02-28'))).toEqual(['2026-11-02', '2026-12-07', '2027-01-04', '2027-02-01'])
  })
  it('fourth Thursday, also in months with five Thursdays', () => {
    // Oct 2026 has five Thursdays (1, 8, 15, 22, 29): the 4th is the 22nd
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: 4, weekday: 4 }, '2026-10-01', '2026-12-31'))).toEqual(['2026-10-22', '2026-11-26', '2026-12-24'])
  })
  it('last Sunday: the 5th Sunday when there is one, else the 4th', () => {
    // Nov 2026: Sundays 1, 8, 15, 22, 29; Dec: 6, 13, 20, 27; Feb 2026 ends on a Saturday: 1, 8, 15, 22
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: -1, weekday: 7 }, '2026-11-01', '2026-12-31'))).toEqual(['2026-11-29', '2026-12-27'])
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: -1, weekday: 7 }, '2026-02-01', '2026-02-28'))).toEqual(['2026-02-22'])
  })
  it('the last weekday of a month that ends on it (Saturday 28 Feb 2026, 31 Jan 2026)', () => {
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: -1, weekday: 6 }, '2026-01-01', '2026-02-28'))).toEqual(['2026-01-31', '2026-02-28'])
  })
  it('leap February', () => {
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: -1, weekday: 2 }, '2028-02-01', '2028-02-29'))).toEqual(['2028-02-29']) // Tuesday
  })
  it('the third and second weekday', () => {
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: 3, weekday: 3 }, '2026-11-01', '2026-12-31'))).toEqual(['2026-11-18', '2026-12-16'])
    expect(dates(run({ kind: 'monthlyWeekday', ordinal: 2, weekday: 5 }, '2026-11-01', '2026-12-31'))).toEqual(['2026-11-13', '2026-12-11'])
  })
})

describe('monthly on day N', () => {
  it('day 15 every month', () => {
    expect(dates(run({ kind: 'monthlyDay', day: 15 }, '2026-11-01', '2027-02-28'))).toEqual(['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15'])
  })
  it('months without the day are skipped (31, 30, 29 in February)', () => {
    expect(dates(run({ kind: 'monthlyDay', day: 31 }, '2026-01-01', '2026-06-30'))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
    expect(dates(run({ kind: 'monthlyDay', day: 30 }, '2026-01-01', '2026-03-31'))).toEqual(['2026-01-30', '2026-03-30'])
    expect(dates(run({ kind: 'monthlyDay', day: 29 }, '2027-01-01', '2027-03-31'))).toEqual(['2027-01-29', '2027-03-29'])
    expect(dates(run({ kind: 'monthlyDay', day: 29 }, '2028-01-01', '2028-03-31'))).toEqual(['2028-01-29', '2028-02-29', '2028-03-29'])
  })
  it('respects the window ends (inclusive) and holidays', () => {
    const r = run({ kind: 'monthlyDay', day: 15 }, '2026-11-15', '2027-01-15', '2026-11-15', { closures: [{ startsOn: '2026-12-15', endsOn: '2026-12-15' }] })
    expect(dates(r)).toEqual(['2026-11-15', '2027-01-15'])
    expect(r.closed).toEqual(['2026-12-15T18:00'])
  })
})

describe('daylight saving time (Europe/Brussels)', () => {
  it('keeps 18:00 local across the spring change (29 Mar 2026) and the autumn change (25 Oct 2026)', () => {
    const r = run({ kind: 'weekly', weekdays: [5, 7], interval: 1 }, '2026-03-27', '2026-03-30', '2026-03-27', { endTime: null })
    expect(r.sessions.map((s) => [s.originalStartLocal, s.startsAt])).toEqual([
      ['2026-03-27T18:00', '2026-03-27T17:00:00.000Z'], // CET
      ['2026-03-29T18:00', '2026-03-29T16:00:00.000Z'], // CEST
    ])
    const a = run({ kind: 'weekly', weekdays: [5, 7], interval: 1 }, '2026-10-23', '2026-10-26', '2026-10-23', { endTime: null })
    expect(a.sessions.map((s) => s.startsAt)).toEqual(['2026-10-23T16:00:00.000Z', '2026-10-25T17:00:00.000Z'])
  })
  it('a time in the spring gap moves forward but keeps its key; a repeated autumn time takes the first instant', () => {
    const gap = run({ kind: 'monthlyWeekday', ordinal: -1, weekday: 7 }, '2026-03-01', '2026-03-31', '2026-03-01', { startTime: '02:30', endTime: null })
    expect(gap.sessions[0].originalStartLocal).toBe('2026-03-29T02:30')
    expect(gap.sessions[0].startLocal).toBe('2026-03-29T03:00')
    const overlap = run({ kind: 'monthlyWeekday', ordinal: -1, weekday: 7 }, '2026-10-01', '2026-10-31', '2026-10-01', { startTime: '02:30', endTime: null })
    expect(overlap.sessions[0].originalStartLocal).toBe('2026-10-25T02:30')
    expect(overlap.sessions[0].startsAt).toBe('2026-10-25T00:30:00.000Z') // first (CEST) 02:30
  })
})

describe('bounds and safety', () => {
  it('until before from gives nothing; bad input throws', () => {
    expect(run({ kind: 'monthlyDay', day: 1 }, '2026-12-01', '2026-11-01').sessions).toEqual([])
    expect(() => run({ kind: 'monthlyDay', day: 1 }, '2026-02-30', '2026-11-01')).toThrow(ScheduleError)
    expect(() => run({ kind: 'monthlyDay', day: 40 }, '2026-01-01', '2026-11-01')).toThrow(ScheduleError)
    expect(() => run({ kind: 'weekly', weekdays: [1], interval: 1 }, '2026-01-01', '2026-11-01', '2026-01-01', { startTime: '25:00' })).toThrow(ScheduleError)
  })
  it('caps a very long expansion', () => {
    const r = run({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7], interval: 1 }, '2026-01-01', '2099-12-31')
    expect(r.sessions).toHaveLength(400)
    expect(r.truncated).toBe(true)
    const m = run({ kind: 'monthlyDay', day: 1 }, '2026-01-01', '2099-12-31')
    expect(m.sessions).toHaveLength(400)
    expect(m.truncated).toBe(true)
  })
})

describe('date helpers for the pickers', () => {
  const thu: ClassRule = { kind: 'weekly', weekdays: [4], interval: 1 }
  it('ruleOccursOn', () => {
    expect(ruleOccursOn(thu, '2026-11-05', '2026-11-05')).toBe(true)
    expect(ruleOccursOn(thu, '2026-11-06', '2026-11-05')).toBe(false)
    expect(ruleOccursOn({ kind: 'weekly', weekdays: [1], interval: 2 }, '2026-11-16', '2026-11-02')).toBe(true)
    expect(ruleOccursOn({ kind: 'weekly', weekdays: [1], interval: 2 }, '2026-11-09', '2026-11-02')).toBe(false)
    expect(ruleOccursOn({ kind: 'once' }, '2026-11-09', '2026-11-09')).toBe(true)
    expect(ruleOccursOn(thu, 'bad', '2026-11-05')).toBe(false)
  })
  it('next / previous date', () => {
    expect(nextRuleDate(thu, '2026-11-06', '2026-11-06')).toBe('2026-11-12')
    expect(nextRuleDate(thu, '2026-11-05', '2026-11-05')).toBe('2026-11-05')
    expect(previousRuleDate(thu, '2026-11-11', '2026-11-05')).toBe('2026-11-05')
    expect(nextRuleDate({ kind: 'monthlyDay', day: 31 }, '2026-02-01', '2026-02-01')).toBe('2026-03-31')
    expect(nextRuleDate({ kind: 'once' }, '2026-02-01', '2026-02-01')).toBe('2026-02-01')
    expect(nextRuleDate({ kind: 'once' }, '2026-02-02', '2026-02-01')).toBeNull()
  })
})

describe('untrusted input', () => {
  it('coerceClassRule cleans a valid rule and never throws on junk', async () => {
    const { coerceClassRule, nextStartDate } = await import('../recurrence')
    expect(coerceClassRule({ kind: 'weekly', weekdays: [3, 1, 3], interval: 2 })).toEqual({ kind: 'weekly', weekdays: [1, 3], interval: 2 })
    for (const junk of [null, undefined, 3, 'x', {}, { kind: 'weekly' }, { kind: 'weekly', weekdays: 'MO', interval: 1 }, { kind: 'monthlyDay', day: '3' }, { kind: 'monthlyWeekday', ordinal: 9, weekday: 1 }]) {
      expect(coerceClassRule(junk), JSON.stringify(junk)).toBeNull()
    }
    expect(nextStartDate({ kind: 'monthlyDay', day: 31 }, '2026-02-01')).toBe('2026-03-31')
  })
})
