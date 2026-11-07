import { describe, expect, it } from 'vitest'
import {
  addMonthsInclusiveEnd, canSignUp, canWithdraw, entriesRemaining, hasEntryLeft, passCovers, passValidity, scopeCovers,
} from '../passes'
import type { PassEntitlement } from '../types'

describe('addMonthsInclusiveEnd', () => {
  it.each([
    ['2026-01-01', 1, '2026-01-31'],
    ['2026-01-15', 1, '2026-02-14'],
    ['2026-03-15', 12, '2027-03-14'],
    ['2026-09-01', 6, '2027-02-28'],
    ['2026-10-31', 4, '2027-02-28'], // clamp: 31 Oct + 4 months -> 28 Feb
    ['2026-12-20', 1, '2027-01-19'],
    ['2026-12-01', 1, '2026-12-31'],
  ])('%s + %i months -> %s', (s, m, e) => expect(addMonthsInclusiveEnd(s, m)).toBe(e))

  it('clamps month-end to the end of a short month (leap and non-leap)', () => {
    expect(addMonthsInclusiveEnd('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsInclusiveEnd('2026-01-30', 1)).toBe('2026-02-28')
    expect(addMonthsInclusiveEnd('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsInclusiveEnd('2028-01-29', 1)).toBe('2028-02-28')
    expect(addMonthsInclusiveEnd('2026-01-29', 1)).toBe('2026-02-28')
  })
  it('leap day start + 12 months clamps to 28 Feb', () => {
    expect(addMonthsInclusiveEnd('2028-02-29', 12)).toBe('2029-02-28')
  })
  it('rejects bad input', () => {
    expect(() => addMonthsInclusiveEnd('2026-02-30', 1)).toThrow()
    expect(() => addMonthsInclusiveEnd('2026-1-1', 1)).toThrow()
    expect(() => addMonthsInclusiveEnd('2026-01-01', 0)).toThrow()
    expect(() => addMonthsInclusiveEnd('2026-01-01', 1.5)).toThrow()
  })
})

describe('passValidity', () => {
  it('fixed end runs from the purchase date', () => {
    expect(passValidity({ validity: { kind: 'fixed_end', endDate: '2026-12-31' } }, '2026-11-07')).toEqual({ validFrom: '2026-11-07', validTo: '2026-12-31' })
  })
  it('a later start date moves the start', () => {
    expect(passValidity({ validity: { kind: 'fixed_end', endDate: '2026-12-31' } }, '2026-11-07', '2026-12-01').validFrom).toBe('2026-12-01')
  })
  it('fixed end before the start is invalid; equal is a one-day pass', () => {
    expect(() => passValidity({ validity: { kind: 'fixed_end', endDate: '2026-11-01' } }, '2026-11-07')).toThrow()
    expect(passValidity({ validity: { kind: 'fixed_end', endDate: '2026-11-07' } }, '2026-11-07').validTo).toBe('2026-11-07')
  })
  it('duration counts from the start date, else the purchase date', () => {
    expect(passValidity({ validity: { kind: 'duration', months: 1 } }, '2026-01-31')).toEqual({ validFrom: '2026-01-31', validTo: '2026-02-28' })
    expect(passValidity({ validity: { kind: 'duration', months: 12 } }, '2026-11-07', '2027-01-01')).toEqual({ validFrom: '2027-01-01', validTo: '2027-12-31' })
  })
})

const pass = (over: Partial<PassEntitlement> = {}): PassEntitlement => ({
  validFrom: '2026-10-01', validTo: '2026-12-31', scope: { kind: 'courses', ownerPublicIds: ['yoga'] }, entriesTotal: null, ...over,
})

describe('scopeCovers', () => {
  it('lists, all courses, and events', () => {
    expect(scopeCovers({ kind: 'courses', ownerPublicIds: ['yoga'] }, 'course', 'yoga')).toBe(true)
    expect(scopeCovers({ kind: 'courses', ownerPublicIds: ['yoga'] }, 'course', 'pilates')).toBe(false)
    expect(scopeCovers({ kind: 'courses', ownerPublicIds: [] }, 'course', 'yoga')).toBe(false)
    expect(scopeCovers({ kind: 'all_courses' }, 'course', 'anything')).toBe(true)
    expect(scopeCovers({ kind: 'all_courses' }, 'event', 'workshop')).toBe(false)
    expect(scopeCovers({ kind: 'courses', ownerPublicIds: ['yoga'] }, 'event', 'yoga')).toBe(false)
  })
})

describe('passCovers (project time zone, inclusive dates)', () => {
  it('first and last day are inclusive', () => {
    expect(passCovers(pass(), 'course', 'yoga', '2026-10-01T16:00:00Z', 'Europe/Brussels')).toBe(true)
    expect(passCovers(pass(), 'course', 'yoga', '2026-12-31T17:00:00Z', 'Europe/Brussels')).toBe(true)
    expect(passCovers(pass(), 'course', 'yoga', '2026-09-30T17:00:00Z', 'Europe/Brussels')).toBe(false)
    expect(passCovers(pass(), 'course', 'yoga', '2027-01-01T17:00:00Z', 'Europe/Brussels')).toBe(false)
  })
  it('judges by LOCAL date: 23:30 Brussels on 31 Dec is covered, 00:30 on 1 Jan is not', () => {
    expect(passCovers(pass(), 'course', 'yoga', '2026-12-31T22:30:00Z', 'Europe/Brussels')).toBe(true)
    expect(passCovers(pass(), 'course', 'yoga', '2026-12-31T23:30:00Z', 'Europe/Brussels')).toBe(false)
    // 00:30 local on the first day is UTC the day before
    expect(passCovers(pass(), 'course', 'yoga', '2026-09-30T22:30:00Z', 'Europe/Brussels')).toBe(true)
  })
  it('works across the DST changes (Rome)', () => {
    // Spring forward 29 Mar 2026: 00:30 local 29 Mar is 23:30Z on the 28th.
    const spring = pass({ validFrom: '2026-03-29', validTo: '2026-03-29' })
    expect(passCovers(spring, 'course', 'yoga', '2026-03-28T23:30:00Z', 'Europe/Rome')).toBe(true)
    expect(passCovers(spring, 'course', 'yoga', '2026-03-29T21:59:00Z', 'Europe/Rome')).toBe(true) // 23:59 CEST
    expect(passCovers(spring, 'course', 'yoga', '2026-03-29T22:00:00Z', 'Europe/Rome')).toBe(false) // 00:00 on the 30th
    // Fall back 25 Oct 2026
    const fall = pass({ validFrom: '2026-10-25', validTo: '2026-10-25' })
    expect(passCovers(fall, 'course', 'yoga', '2026-10-24T22:00:00Z', 'Europe/Rome')).toBe(true) // 00:00 CEST
    expect(passCovers(fall, 'course', 'yoga', '2026-10-25T22:59:00Z', 'Europe/Rome')).toBe(true) // 23:59 CET
    expect(passCovers(fall, 'course', 'yoga', '2026-10-25T23:00:00Z', 'Europe/Rome')).toBe(false)
  })
  it('scope is checked too, and an unknown zone throws', () => {
    expect(passCovers(pass(), 'course', 'pilates', '2026-11-10T17:00:00Z', 'Europe/Rome')).toBe(false)
    expect(() => passCovers(pass(), 'course', 'yoga', '2026-11-10T17:00:00Z', 'Mars/Base')).toThrow()
  })
})

describe('entries', () => {
  it('remaining', () => {
    expect(entriesRemaining(null, 5)).toBeNull()
    expect(entriesRemaining(undefined, 0)).toBeNull()
    expect(entriesRemaining(10, 0)).toBe(10)
    expect(entriesRemaining(10, 4)).toBe(6)
    expect(entriesRemaining(10, 10)).toBe(0)
    expect(entriesRemaining(10, 12)).toBe(0)
  })
  it('hasEntryLeft', () => {
    expect(hasEntryLeft(null, 99)).toBe(true)
    expect(hasEntryLeft(3, 2)).toBe(true)
    expect(hasEntryLeft(3, 3)).toBe(false)
    expect(hasEntryLeft(0, 0)).toBe(false)
  })
  it('validates', () => {
    expect(() => entriesRemaining(10, -1)).toThrow()
    expect(() => entriesRemaining(10, 1.5)).toThrow()
    expect(() => entriesRemaining(-1, 0)).toThrow()
  })
})

describe('canSignUp / canWithdraw', () => {
  const start = new Date('2026-11-16T17:30:00Z')
  const at = (ms: number) => new Date(start.getTime() + ms)
  const H = 3_600_000, D = 24 * H

  it('not open before N days, open from exactly N days', () => {
    const base = { sessionStartsAt: start, opensDaysBefore: 7, changeUntilHoursBefore: 2 }
    expect(canSignUp({ ...base, now: at(-7 * D - 1) })).toBe('not_open_yet')
    expect(canSignUp({ ...base, now: at(-7 * D) })).toBe('open')
    expect(canSignUp({ ...base, now: at(-3 * D) })).toBe('open')
  })
  it('deadline exactly at the boundary is still open; 1 ms later closed', () => {
    const base = { sessionStartsAt: start, opensDaysBefore: 7, changeUntilHoursBefore: 2 }
    expect(canSignUp({ ...base, now: at(-2 * H) })).toBe('open')
    expect(canSignUp({ ...base, now: at(-2 * H + 1) })).toBe('closed')
    expect(canSignUp({ ...base, now: at(1) })).toBe('closed')
  })
  it('null / undefined opening means always open (until the deadline)', () => {
    expect(canSignUp({ now: at(-400 * D), sessionStartsAt: start, opensDaysBefore: null, changeUntilHoursBefore: 0 })).toBe('open')
    expect(canSignUp({ now: at(-400 * D), sessionStartsAt: start, changeUntilHoursBefore: 0 })).toBe('open')
    expect(canSignUp({ now: at(0), sessionStartsAt: start, changeUntilHoursBefore: 0 })).toBe('open')
    expect(canSignUp({ now: at(1), sessionStartsAt: start, changeUntilHoursBefore: 0 })).toBe('closed')
  })
  it('an empty window is closed once past the deadline, never "open" after it', () => {
    expect(canSignUp({ now: at(-1 * H), sessionStartsAt: start, opensDaysBefore: 0, changeUntilHoursBefore: 5 })).toBe('closed')
  })
  it('withdraw returns the entry only before the deadline', () => {
    const base = { sessionStartsAt: start, changeUntilHoursBefore: 12 }
    expect(canWithdraw({ ...base, now: at(-13 * H) })).toEqual({ allowed: true, entryReturned: true })
    expect(canWithdraw({ ...base, now: at(-12 * H) })).toEqual({ allowed: true, entryReturned: true })
    expect(canWithdraw({ ...base, now: at(-12 * H + 1) })).toEqual({ allowed: false, entryReturned: false })
  })
})
