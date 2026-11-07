import { describe, expect, it } from 'vitest'
import { actionStates, sessionNames, sessionRows } from '../bookings-view'
import type { BookingDetail } from '../server/bookings-read'
import { bookingRow } from '../service/__tests__/fake-store'

const d = (status: string, over: Partial<BookingDetail> = {}, review = false): Pick<BookingDetail, 'booking' | 'attendees' | 'allocations' | 'sessions'> => ({
  booking: bookingRow({ status: status as never, eligibilityReview: review }),
  attendees: [], allocations: [], sessions: [], ...over,
})
const ALL = { write: true, pay: true }

describe('actionStates', () => {
  it('a booking waiting for payment: pay, confirm, extend and cancel', () => {
    const s = actionStates(d('awaiting_payment'), ALL)
    expect([s.recordPayment, s.confirm, s.extendHold, s.cancel].every((x) => x.enabled)).toBe(true)
    expect(s.verifyEligibility).toEqual({ enabled: false, why: 'noEligibility' })
  })
  it('a confirmed booking: pay and cancel only', () => {
    const s = actionStates(d('confirmed'), ALL)
    expect(s.confirm).toEqual({ enabled: false, why: 'notConfirmable' })
    expect(s.extendHold).toEqual({ enabled: false, why: 'notExtendable' })
    expect(s.cancel.enabled && s.recordPayment.enabled).toBe(true)
  })
  it('a closed booking offers nothing, and says so', () => {
    for (const st of ['cancelled', 'expired']) {
      const s = actionStates(d(st), ALL)
      expect(s.recordPayment).toEqual({ enabled: false, why: 'closed' })
      expect(s.cancel).toEqual({ enabled: false, why: 'closed' })
    }
  })
  it('permissions: payments need payment.update, the rest booking.write', () => {
    const s = actionStates(d('awaiting_payment'), { write: true, pay: false })
    expect(s.recordPayment).toEqual({ enabled: false, why: 'needPay' })
    expect(s.confirm.enabled).toBe(true)
    const r = actionStates(d('awaiting_payment'), { write: false, pay: true })
    expect(r.recordPayment.enabled).toBe(true)
    expect(r.confirm).toEqual({ enabled: false, why: 'needWrite' })
    expect(r.cancel).toEqual({ enabled: false, why: 'needWrite' })
  })
  it('eligibility: offered while a check is pending or the booking is flagged', () => {
    const pending = { attendees: [{ id: 'a', eligibilityResult: 'pending' }] as never }
    expect(actionStates(d('confirmed', pending), ALL).verifyEligibility.enabled).toBe(true)
    expect(actionStates(d('confirmed', {}, true), ALL).verifyEligibility.enabled).toBe(true)
  })
})

describe('sessionRows', () => {
  const alloc = (occ: string, over = {}) => ({ id: occ + Math.random(), attendeeId: 'a1', occurrenceId: occ, kind: 'confirmed' as const, expiresAt: null, releasedAt: null, releaseReason: null, ...over })
  it('joins allocations with the snapshot, in time order, with released sessions marked', () => {
    const rows = sessionRows({
      allocations: [alloc('o2'), alloc('o1', { releasedAt: '2026-11-01T00:00:00Z', releaseReason: 'absence' }), alloc('o2', { attendeeId: 'a2' })],
      sessions: [
        { occurrenceId: 'o2', startsAt: '2026-11-12T18:00:00Z', title: 'Tuesday' },
        { occurrenceId: 'o1', startsAt: '2026-11-05T18:00:00Z', title: 'Last week' },
      ],
    })
    expect(rows.map((r) => [r.title, r.people])).toEqual([['Last week', 0], ['Tuesday', 2]])
    expect(rows[0].state).toEqual({ released: 'absence' })
    expect(rows[1].state).toEqual({ kind: 'confirmed' })
  })
  it('works with no snapshot at all', () => {
    const rows = sessionRows({ allocations: [alloc('o1')], sessions: [] })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBeNull()
  })
})

describe('sessionNames', () => {
  const sessions = [{ occurrenceId: 'o1', startsAt: '2026-11-12T18:00:00Z', title: 'Tuesday' }]
  it('names the full sessions when it can', () => {
    expect(sessionNames({ sessions }, ['o1'], (iso) => `at ${iso.slice(0, 10)}`)).toBe('Tuesday, at 2026-11-12')
    expect(sessionNames({ sessions }, ['zz'], () => '')).toBeNull()
    expect(sessionNames({ sessions }, undefined, () => '')).toBeNull()
  })
})
