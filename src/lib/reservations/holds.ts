// ── Reservations — hold expiry (ADR-044 D5) ──────────────────────────────────
// Bank transfer hold ends at the EARLIEST of: booking + hold days, registration
// close, first session − cutoff. Pure UTC millisecond math (a "day" is 24 h).
import { ReservationError } from './types'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type HoldInput = {
  bookedAt: Date
  holdDays: number
  registrationClosesAt?: Date | null
  firstSessionStartsAt?: Date | null
  cutoffHours: number
}

export function holdExpiresAt(input: HoldInput): Date {
  const { bookedAt, holdDays, registrationClosesAt, firstSessionStartsAt, cutoffHours } = input
  if (Number.isNaN(bookedAt.getTime()) || !(holdDays >= 0) || !(cutoffHours >= 0)) {
    throw new ReservationError('invalid_argument')
  }
  const candidates = [bookedAt.getTime() + holdDays * DAY]
  if (registrationClosesAt && !Number.isNaN(registrationClosesAt.getTime())) candidates.push(registrationClosesAt.getTime())
  if (firstSessionStartsAt && !Number.isNaN(firstSessionStartsAt.getTime())) {
    candidates.push(firstSessionStartsAt.getTime() - cutoffHours * HOUR)
  }
  return new Date(Math.min(...candidates))
}

/** Expiry is logical: a hold counts only while expiresAt is strictly in the future. */
export function isHoldActive(expiresAt: Date | null, now: Date): boolean {
  return expiresAt === null || expiresAt.getTime() > now.getTime()
}
