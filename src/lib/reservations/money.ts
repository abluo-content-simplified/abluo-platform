// ── Reservations — money helpers (ADR-044 D2, D16.10) ────────────────────────
// Integer cents only. Formatting is UI's job.
import { ReservationError, type Cents } from './types'

export function assertCents(value: unknown): asserts value is Cents {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new ReservationError('invalid_cents')
}

export function sumCents(lines: readonly Cents[]): Cents {
  let total = 0
  for (const line of lines) {
    assertCents(line)
    total += line
  }
  assertCents(total)
  return total
}

/**
 * Proportional refund when the organiser cancels K of N sessions:
 * floor(total × K / N). Rounding DOWN means the refund never exceeds what was
 * paid for those sessions; the leftover (< 1 cent per cancellation) stays on
 * the booking. Cancelling all N sessions refunds exactly `total`. Negative
 * totals are rejected (adjustments are separate lines).
 */
export function proportionalRefund(totalCents: Cents, totalSessions: number, cancelledSessions: number): Cents {
  assertCents(totalCents)
  if (totalCents < 0) throw new ReservationError('invalid_cents')
  if (!Number.isInteger(totalSessions) || totalSessions < 1) throw new ReservationError('invalid_argument', 'sessions')
  if (!Number.isInteger(cancelledSessions) || cancelledSessions < 0 || cancelledSessions > totalSessions) {
    throw new ReservationError('invalid_argument', 'cancelled')
  }
  if (cancelledSessions === totalSessions) return totalCents
  // Split to stay inside safe integers for large totals.
  const whole = Math.floor(totalCents / totalSessions)
  const rest = totalCents % totalSessions
  return whole * cancelledSessions + Math.floor((rest * cancelledSessions) / totalSessions)
}

/**
 * Splits a total into `parts` integer shares that add up exactly; the
 * remainder cents go one each to the EARLIEST parts. Use it for a per-session
 * value so refunds of single sessions sum to the total.
 */
export function splitCents(totalCents: Cents, parts: number): Cents[] {
  assertCents(totalCents)
  if (totalCents < 0) throw new ReservationError('invalid_cents')
  if (!Number.isInteger(parts) || parts < 1) throw new ReservationError('invalid_argument', 'parts')
  const base = Math.floor(totalCents / parts)
  const rest = totalCents - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0))
}
