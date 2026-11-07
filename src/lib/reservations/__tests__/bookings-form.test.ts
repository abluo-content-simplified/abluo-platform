import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACTION_ERROR_CODES, ACTIVITY_ACTIONS, activityKeyOf, bookingsHref, bookingsQueryOf, centsToInput, endOfDayUtc, errorKeyOf,
  isCalendarDate, parseAmountToCents, todayIn,
} from '../bookings-form'

const en = JSON.parse(readFileSync(path.join(process.cwd(), 'messages/en.json'), 'utf8')).clientDashboard.bookings

describe('parseAmountToCents', () => {
  it.each([
    ['25', 2500], ['25,00', 2500], ['25.5', 2550], ['12,50', 1250], ['€ 12', 1200], ['1.250,00', 125000], ['1,250.00', 125000],
    ['1.250', 125000], ['0,99', 99], ['0.05', 5],
  ])('%s → %i', (input, cents) => expect(parseAmountToCents(input)).toBe(cents))
  it.each(['', 'abc', '0', '0,00', '-5', '12,5,5', '1e3', '9999999999'])('%s → null', (input) => expect(parseAmountToCents(input)).toBeNull())
  it('round-trips with centsToInput', () => {
    expect(centsToInput(1250)).toBe('12,50')
    expect(centsToInput(5)).toBe('0,05')
    expect(parseAmountToCents(centsToInput(98765))).toBe(98765)
  })
})

describe('dates', () => {
  it('knows real calendar days', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2026-2-3')).toBe(false)
  })
  it('end of day in the site zone, winter and summer', () => {
    expect(endOfDayUtc('2026-11-20', 'Europe/Rome')).toBe('2026-11-20T22:59:00.000Z')
    expect(endOfDayUtc('2026-07-20', 'Europe/Rome')).toBe('2026-07-20T21:59:00.000Z')
    expect(endOfDayUtc('nope', 'Europe/Rome')).toBeNull()
  })
  it('today in a zone is that zone\'s day', () => {
    const t = new Date('2026-11-08T23:30:00Z')
    expect(todayIn('Europe/Rome', t)).toBe('2026-11-09')
    expect(todayIn('America/New_York', t)).toBe('2026-11-08')
  })
})

describe('the list address', () => {
  it('round-trips filters and page, dropping unknown values', () => {
    const { query, page } = bookingsQueryOf({ status: 'held', payment: 'nonsense', what: ['t1', 't2'], q: ' anna ', page: '3' })
    expect(query).toEqual({ status: 'held', paymentStatus: null, targetId: 't1', q: ' anna ' })
    expect(page).toBe(3)
    expect(bookingsHref('cyce', query, 3)).toBe('/cyce/bookings?status=held&what=t1&q=anna&page=3')
    expect(bookingsHref('cyce', { status: null, paymentStatus: null, targetId: null, q: '' })).toBe('/cyce/bookings')
  })
  it('a silly page number is page 1', () => {
    for (const p of ['0', '-4', 'x', '99999999']) expect(bookingsQueryOf({ page: p }).page).toBe(1)
  })
})

describe('words for the codes (messages/en.json)', () => {
  it('every action error code has a text', () => {
    for (const code of ACTION_ERROR_CODES) expect(typeof en.errors[code], code).toBe('string')
  })
  it('every activity code has a text, and a fallback exists', () => {
    for (const a of ACTIVITY_ACTIONS) expect(typeof en.activity[a], a).toBe('string')
    expect(typeof en.activity.other).toBe('string')
  })
  it('unknown codes get the calm fallback', () => {
    expect(errorKeyOf('pass_not_active')).toBe('failed')
    expect(errorKeyOf('full')).toBe('full')
    expect(activityKeyOf('something.new')).toBe('other')
  })
  it('the full-sessions text names the sessions', () => {
    expect(en.errors.full).toContain('{sessions}')
    expect(en.errors.full.startsWith('No places left on')).toBe(true)
  })
})
