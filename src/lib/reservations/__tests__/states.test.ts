import { describe, expect, it } from 'vitest'
import { BOOKING_STATUSES, PAYMENT_STATUSES, REFUND_STATUSES } from '../types'
import { allowedTransitions, canTransition, isKnownState, isTerminal } from '../states'

describe('booking machine', () => {
  it.each([
    ['pending', 'held'], ['pending', 'confirmed'], ['held', 'awaiting_payment'], ['held', 'confirmed'],
    ['awaiting_payment', 'confirmed'], ['awaiting_payment', 'expired'],
  ])('allows %s -> %s', (a, b) => expect(canTransition('booking', a, b)).toBe(true))

  it('any non-terminal state can be cancelled', () => {
    for (const s of BOOKING_STATUSES) {
      if (isTerminal('booking', s)) expect(canTransition('booking', s, 'cancelled')).toBe(false)
      else expect(canTransition('booking', s, 'cancelled')).toBe(true)
    }
  })
  it('cancelled and expired are terminal', () => {
    expect(isTerminal('booking', 'cancelled')).toBe(true)
    expect(isTerminal('booking', 'expired')).toBe(true)
    expect(isTerminal('booking', 'confirmed')).toBe(false)
    expect(allowedTransitions('booking', 'cancelled')).toEqual([])
  })
  it('forbids going backwards and self transitions', () => {
    expect(canTransition('booking', 'confirmed', 'held')).toBe(false)
    expect(canTransition('booking', 'expired', 'confirmed')).toBe(false)
    expect(canTransition('booking', 'pending', 'pending')).toBe(false)
    expect(canTransition('booking', 'confirmed', 'expired')).toBe(false)
  })
})

describe('payment machine', () => {
  it('follows the spec', () => {
    expect(canTransition('payment', 'unpaid', 'partially_paid')).toBe(true)
    expect(canTransition('payment', 'partially_paid', 'paid')).toBe(true)
    expect(canTransition('payment', 'paid', 'partially_refunded')).toBe(true)
    expect(canTransition('payment', 'paid', 'refunded')).toBe(true)
    expect(canTransition('payment', 'partially_refunded', 'refunded')).toBe(true)
    expect(canTransition('payment', 'unpaid', 'refunded')).toBe(false)
    expect(canTransition('payment', 'paid', 'unpaid')).toBe(false)
  })
  it('refunded is the only terminal state', () => {
    expect(PAYMENT_STATUSES.filter((s) => isTerminal('payment', s))).toEqual(['refunded'])
  })
})

describe('refund machine', () => {
  it('follows the spec', () => {
    expect(canTransition('refund', 'requested', 'approved')).toBe(true)
    expect(canTransition('refund', 'requested', 'rejected')).toBe(true)
    expect(canTransition('refund', 'approved', 'done')).toBe(true)
    expect(canTransition('refund', 'approved', 'failed')).toBe(true)
    expect(canTransition('refund', 'requested', 'done')).toBe(false)
    expect(canTransition('refund', 'rejected', 'approved')).toBe(false)
    expect(canTransition('refund', 'done', 'failed')).toBe(false)
  })
  it('failed can be retried; done and rejected are final', () => {
    expect(canTransition('refund', 'failed', 'approved')).toBe(true)
    expect(REFUND_STATUSES.filter((s) => isTerminal('refund', s)).sort()).toEqual(['done', 'rejected'])
  })
})

describe('unknown states', () => {
  it('are not terminal, have no transitions', () => {
    expect(isKnownState('booking', 'nope')).toBe(false)
    expect(isKnownState('booking', 'held')).toBe(true)
    expect(isTerminal('booking', 'nope')).toBe(false)
    expect(canTransition('booking', 'nope', 'held')).toBe(false)
    expect(canTransition('booking', 'toString', 'held')).toBe(false)
  })
})
