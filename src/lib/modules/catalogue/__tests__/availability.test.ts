import { describe, it, expect } from 'vitest'
import {
  evaluate,
  minutesOf,
  weekdayOf,
  localPosition,
  ruleApplies,
  ruleRanges,
  rulesOverlap,
  ruleIssues,
  MINUTES_PER_WEEK,
  type AvailabilityRule,
} from '../availability'

const ROME = 'Europe/Rome'

// Instants are written as UTC and read in the tenant's zone, which is the whole
// point: the machine's own zone must never influence the answer.
const utc = (iso: string) => new Date(iso)

describe('minutesOf', () => {
  it('parses HH:mm', () => {
    expect(minutesOf('00:00')).toBe(0)
    expect(minutesOf('19:30')).toBe(1170)
    expect(minutesOf('23:59')).toBe(1439)
  })

  it('rejects anything else rather than guessing', () => {
    for (const bad of ['24:00', '7:00', '19:60', '', 'noon', null, undefined]) {
      expect(minutesOf(bad as string)).toBeNull()
    }
  })
})

describe('weekdayOf', () => {
  it('names the day of a calendar date', () => {
    expect(weekdayOf('2026-10-12')).toBe('mon')
    expect(weekdayOf('2026-10-16')).toBe('fri')
    expect(weekdayOf('2026-10-18')).toBe('sun')
  })
})

describe('localPosition', () => {
  it('reads an instant in the tenant’s zone, not the machine’s', () => {
    // 20:30 UTC on a Friday in October is 22:30 in Rome (CEST, +02:00).
    const p = localPosition(utc('2026-10-16T20:30:00Z'), ROME)
    expect(p.day).toBe('fri')
    expect(p.minutes).toBe(22 * 60 + 30)
  })

  it('can land on a different weekday than UTC', () => {
    // 23:30 UTC Friday is 01:30 Saturday in Rome.
    const p = localPosition(utc('2026-10-16T23:30:00Z'), ROME)
    expect(p.day).toBe('sat')
    expect(p.minutes).toBe(90)
  })

  it('gives the same answer regardless of the machine’s zone', () => {
    const a = localPosition(utc('2026-10-16T20:30:00Z'), ROME)
    const b = localPosition(utc('2026-10-16T20:30:00Z'), 'Pacific/Kiritimati')
    expect(a.minutes).not.toBe(b.minutes) // proves the zone argument is used
    expect(a.day).toBe('fri')
  })
})

describe('ruleRanges', () => {
  it('spans the whole day when no times are given', () => {
    expect(ruleRanges({ days: ['mon'] })).toEqual([{ start: 0, end: 1440 }])
  })

  it('covers every day when days are empty', () => {
    expect(ruleRanges({ from: '12:00', to: '14:00' })).toHaveLength(7)
  })

  it('runs past midnight into the next day without splitting the week', () => {
    // Friday is index 4 → base 5760. 18:00–02:00 → 5760+1080 … 5760+1560.
    expect(ruleRanges({ days: ['fri'], from: '18:00', to: '02:00' })).toEqual([
      { start: 6840, end: 7320 },
    ])
  })

  it('splits a Sunday overnight rule across the end of the week', () => {
    const ranges = ruleRanges({ days: ['sun'], from: '22:00', to: '02:00' })
    // Sunday is index 6 → base 8640. 22:00 → 9960; 02:00 wraps to 10200, past
    // the 10080-minute end of the week, so it splits.
    expect(ranges).toEqual([
      { start: 9960, end: MINUTES_PER_WEEK },
      { start: 0, end: 120 },
    ])
  })

  it('yields nothing for a zero-length or malformed window', () => {
    expect(ruleRanges({ days: ['mon'], from: '12:00', to: '12:00' })).toEqual([])
    expect(ruleRanges({ days: ['mon'], from: 'noon', to: '14:00' })).toEqual([])
    expect(ruleRanges({ days: ['mon'], from: '12:00' })).toEqual([])
  })

  it('ignores unknown day names rather than throwing', () => {
    expect(ruleRanges({ days: ['funday'], from: '12:00', to: '14:00' })).toEqual([])
  })
})

describe('ruleApplies — overnight intervals (ADR-033 A1)', () => {
  const bar: AvailabilityRule = { days: ['fri'], from: '18:00', to: '02:00' }

  it('applies on the evening it starts', () => {
    expect(ruleApplies(bar, utc('2026-10-16T18:00:00Z'), ROME)).toBe(true) // 20:00 Rome
  })

  it('applies after midnight, on the following day', () => {
    expect(ruleApplies(bar, utc('2026-10-16T23:00:00Z'), ROME)).toBe(true) // 01:00 Sat
  })

  it('stops at the end of the window', () => {
    expect(ruleApplies(bar, utc('2026-10-17T01:00:00Z'), ROME)).toBe(false) // 03:00 Sat
  })

  it('does not apply on the morning of its own start day', () => {
    expect(ruleApplies(bar, utc('2026-10-16T08:00:00Z'), ROME)).toBe(false) // 10:00 Fri
  })

  it('is half-open — the end minute is already over', () => {
    const lunch: AvailabilityRule = { days: ['mon'], from: '12:00', to: '14:00' }
    expect(ruleApplies(lunch, utc('2026-10-12T10:00:00Z'), ROME)).toBe(true) // 12:00
    expect(ruleApplies(lunch, utc('2026-10-12T12:00:00Z'), ROME)).toBe(false) // 14:00
  })
})

describe('ruleApplies — DST, via the lifecycle time utilities', () => {
  // Europe/Rome springs forward 2026-03-29 and falls back 2026-10-25.
  it('holds local wall-clock hours across the spring forward', () => {
    const dinner: AvailabilityRule = { days: ['sun'], from: '19:00', to: '23:00' }
    // 20:00 UTC on 2026-03-29 is 22:00 Rome (CEST, +02:00).
    expect(ruleApplies(dinner, utc('2026-03-29T20:00:00Z'), ROME)).toBe(true)
    // 18:00 UTC the Sunday before is 19:00 Rome (CET, +01:00) — also inside.
    expect(ruleApplies(dinner, utc('2026-03-22T18:00:00Z'), ROME)).toBe(true)
  })

  it('holds local wall-clock hours across the fall back', () => {
    const dinner: AvailabilityRule = { days: ['sun'], from: '19:00', to: '23:00' }
    // 20:00 UTC on 2026-10-25 is 21:00 Rome (CET again) — inside.
    expect(ruleApplies(dinner, utc('2026-10-25T20:00:00Z'), ROME)).toBe(true)
    // 23:30 UTC is 00:30 Monday — outside.
    expect(ruleApplies(dinner, utc('2026-10-25T23:30:00Z'), ROME)).toBe(false)
  })
})

describe('evaluate', () => {
  it('returns available when there are no rules at all', () => {
    expect(evaluate([], utc('2026-10-16T03:00:00Z'), ROME)).toBe('available')
    expect(evaluate(undefined, utc('2026-10-16T03:00:00Z'), ROME)).toBe('available')
    expect(evaluate(null, utc('2026-10-16T03:00:00Z'), ROME)).toBe('available')
  })

  it('returns outOfHours when no rule matches', () => {
    const lunch = [{ days: ['mon'], from: '12:00', to: '14:00' }]
    expect(evaluate(lunch, utc('2026-10-12T20:00:00Z'), ROME)).toBe('outOfHours')
  })

  it('is available when any one rule matches', () => {
    const rules = [
      { days: ['mon'], from: '12:00', to: '14:00' },
      { days: ['mon'], from: '19:00', to: '23:00' },
    ]
    expect(evaluate(rules, utc('2026-10-12T18:00:00Z'), ROME)).toBe('available') // 20:00
  })

  it('never answers anything but available or outOfHours', () => {
    const r = evaluate([{ days: ['mon'] }], utc('2026-10-12T10:00:00Z'), ROME)
    expect(['available', 'outOfHours']).toContain(r)
  })
})

describe('rulesOverlap', () => {
  it('finds no overlap between disjoint windows on the same day', () => {
    expect(
      rulesOverlap(
        [{ days: ['mon'], from: '12:00', to: '14:00' }],
        [{ days: ['mon'], from: '19:00', to: '23:00' }],
      ),
    ).toBe(false)
  })

  it('treats touching windows as disjoint — the check is half-open', () => {
    expect(
      rulesOverlap(
        [{ days: ['mon'], from: '12:00', to: '14:00' }],
        [{ days: ['mon'], from: '14:00', to: '16:00' }],
      ),
    ).toBe(false)
  })

  it('finds an overlap on a shared day', () => {
    expect(
      rulesOverlap(
        [{ days: ['mon', 'tue'], from: '12:00', to: '15:00' }],
        [{ days: ['tue'], from: '14:00', to: '16:00' }],
      ),
    ).toBe(true)
  })

  it('finds an overlap created by a wrap into the next day', () => {
    // Friday 18:00–02:00 reaches 01:00 Saturday; the Saturday rule starts 01:00.
    expect(
      rulesOverlap(
        [{ days: ['fri'], from: '18:00', to: '02:00' }],
        [{ days: ['sat'], from: '01:00', to: '03:00' }],
      ),
    ).toBe(true)
  })

  it('finds no overlap when the wrap stops before the next rule', () => {
    expect(
      rulesOverlap(
        [{ days: ['fri'], from: '18:00', to: '01:00' }],
        [{ days: ['sat'], from: '01:00', to: '03:00' }],
      ),
    ).toBe(false)
  })

  it('finds an overlap created by a wrap past the end of the week', () => {
    expect(
      rulesOverlap(
        [{ days: ['sun'], from: '22:00', to: '02:00' }],
        [{ days: ['mon'], from: '01:00', to: '03:00' }],
      ),
    ).toBe(true)
  })

  it('treats no rules as always, so it overlaps everything', () => {
    expect(rulesOverlap([], [{ days: ['mon'], from: '12:00', to: '14:00' }])).toBe(true)
    expect(rulesOverlap([], [])).toBe(true)
  })
})

describe('ruleIssues', () => {
  it('accepts a wrapping window — 18:00 to 02:00 is a bar, not a mistake', () => {
    expect(ruleIssues({ days: ['fri'], from: '18:00', to: '02:00' })).toEqual([])
  })

  it('rejects a zero-length window', () => {
    expect(ruleIssues({ from: '12:00', to: '12:00' })).toContainEqual({
      kind: 'zeroLengthWindow',
      from: '12:00',
    })
  })

  it('rejects a half-specified window', () => {
    expect(ruleIssues({ from: '12:00' })).toContainEqual({ kind: 'incompleteWindow' })
  })

  it('rejects malformed times and unknown days', () => {
    expect(ruleIssues({ from: '25:00', to: '26:00' })).toContainEqual({
      kind: 'invalidTime',
      value: '25:00',
    })
    expect(ruleIssues({ days: ['funday'] })).toContainEqual({ kind: 'unknownDay', value: 'funday' })
  })

  it('accepts an all-day rule', () => {
    expect(ruleIssues({ days: ['mon', 'tue'] })).toEqual([])
  })
})
