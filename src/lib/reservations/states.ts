// ── Reservations — state machines as data (ADR-044 D4) ───────────────────────
import type { BookingStatus, PaymentStatus, RefundStatus, StateMachineName } from './types'

export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  pending: ['held', 'confirmed', 'cancelled'],
  held: ['awaiting_payment', 'confirmed', 'cancelled', 'expired'],
  awaiting_payment: ['confirmed', 'cancelled', 'expired'],
  confirmed: ['cancelled'],
  cancelled: [],
  expired: [],
}

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  unpaid: ['partially_paid', 'paid'],
  partially_paid: ['paid', 'partially_refunded', 'refunded'],
  paid: ['partially_refunded', 'refunded'],
  partially_refunded: ['refunded'],
  refunded: [],
}

// `failed` can be retried (failed → approved); `done` and `rejected` are final.
export const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  requested: ['approved', 'rejected'],
  approved: ['done', 'failed'],
  failed: ['approved'],
  done: [],
  rejected: [],
}

const MACHINES: Record<StateMachineName, Readonly<Record<string, readonly string[]>>> = {
  booking: BOOKING_TRANSITIONS,
  payment: PAYMENT_TRANSITIONS,
  refund: REFUND_TRANSITIONS,
}

export function allowedTransitions(machine: StateMachineName, from: string): readonly string[] {
  return isKnownState(machine, from) ? MACHINES[machine][from] : []
}

export function canTransition(machine: StateMachineName, from: string, to: string): boolean {
  return allowedTransitions(machine, from).includes(to)
}

export function isTerminal(machine: StateMachineName, state: string): boolean {
  return isKnownState(machine, state) && MACHINES[machine][state].length === 0
}

export function isKnownState(machine: StateMachineName, state: string): boolean {
  return Object.prototype.hasOwnProperty.call(MACHINES[machine], state)
}
