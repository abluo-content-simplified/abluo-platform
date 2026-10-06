import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  isInRange,
  monthGrid,
  orderRange,
  parseISO,
  pickDay,
  presetRange,
  toISO,
  weekStartForLocale,
  weekdayOf,
} from '../date-range'

describe('date-range', () => {
  it('parses and rejects ISO days', () => {
    expect(parseISO('2026-10-03')).toEqual({ y: 2026, m: 9, d: 3 })
    expect(parseISO('2026-02-30')).toBeNull()
    expect(parseISO('nope')).toBeNull()
    expect(parseISO(null)).toBeNull()
  })

  it('adds days and months across boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addMonths({ y: 2026, m: 11 }, 1)).toEqual({ y: 2027, m: 0 })
    expect(addMonths({ y: 2026, m: 0 }, -1)).toEqual({ y: 2025, m: 11 })
    expect(toISO(2026, 0, 0)).toBe('2025-12-31')
  })

  it('builds a 6x7 month grid, Monday and Sunday first', () => {
    // October 2026 starts on a Thursday.
    expect(weekdayOf('2026-10-01')).toBe(4)
    const mon = monthGrid(2026, 9, 1)
    expect(mon).toHaveLength(6)
    expect(mon.every((w) => w.length === 7)).toBe(true)
    expect(mon[0][0].iso).toBe('2026-09-28')
    expect(mon[0][3]).toEqual({ iso: '2026-10-01', day: 1, inMonth: true })
    expect(mon[0][0].inMonth).toBe(false)
    const sun = monthGrid(2026, 9, 0)
    expect(sun[0][0].iso).toBe('2026-09-27')
    expect(sun[0][4].iso).toBe('2026-10-01')
    expect(mon.flat().filter((c) => c.inMonth)).toHaveLength(31)
  })

  it('orders a range and checks it inclusively', () => {
    expect(orderRange('2026-10-12', '2026-10-03')).toEqual({ from: '2026-10-03', to: '2026-10-12' })
    expect(isInRange('2026-10-03', '2026-10-03', '2026-10-12')).toBe(true)
    expect(isInRange('2026-10-12', '2026-10-03', '2026-10-12')).toBe(true)
    expect(isInRange('2026-10-13', '2026-10-03', '2026-10-12')).toBe(false)
    expect(isInRange('2026-10-05', '2026-10-12', '2026-10-03')).toBe(true)
    expect(isInRange('2026-10-05', '2026-10-03', null)).toBe(false)
  })

  it('picks days: start, end, swap, restart', () => {
    let d = pickDay({ from: null, to: null }, '2026-10-12')
    expect(d).toEqual({ from: '2026-10-12', to: null })
    d = pickDay(d, '2026-10-03')
    expect(d).toEqual({ from: '2026-10-03', to: '2026-10-12' })
    d = pickDay(d, '2026-11-01')
    expect(d).toEqual({ from: '2026-11-01', to: null })
    expect(pickDay({ from: '2026-10-03', to: null }, '2026-10-03')).toEqual({ from: '2026-10-03', to: '2026-10-03' })
  })

  it('computes presets', () => {
    expect(presetRange('last7', '2026-10-06')).toEqual({ from: '2026-09-30', to: '2026-10-06' })
    expect(presetRange('last30', '2026-10-06')).toEqual({ from: '2026-09-07', to: '2026-10-06' })
    expect(presetRange('thisYear', '2026-10-06')).toEqual({ from: '2026-01-01', to: '2026-10-06' })
  })

  it('knows the week start per locale', () => {
    expect(weekStartForLocale('en')).toBe(0)
    expect(weekStartForLocale('it')).toBe(1)
    expect(weekStartForLocale('de')).toBe(1)
  })
})
