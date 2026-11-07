// ── Reservations — pass rules (ADR-044 D9) ───────────────────────────────────
//
// The pass is the right to attend, never a place. Dates are 'YYYY-MM-DD' strings
// in the PROJECT time zone, inclusive at both ends. A session is judged by the
// local date it starts on in that zone (localOf from the scheduling layer).
import { localOf } from '@/lib/scheduling/time'
import {
  ReservationError,
  type OwnerType,
  type PassEntitlement,
  type PassOption,
  type PassScope,
  type PassWindow,
} from './types'

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDate(value: string): { y: number; m: number; d: number } {
  const match = DATE.exec(value)
  if (!match) throw new ReservationError('invalid_argument', 'date')
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3])
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ReservationError('invalid_argument', 'date')
  }
  return { y, m, d }
}

function fmt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function daysInMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate() // m1 is 1-based: day 0 of next month
}

/**
 * Last valid day of a pass of `months` months starting on `start`.
 * Normally the day before the same date N months later (1 Jan + 1 month → 31 Jan;
 * 15 Mar + 12 months → 14 Mar next year). When the start day does not exist in
 * the target month (31 Jan + 1 month) the month is clamped and the pass runs to
 * the END of that month (28 / 29 Feb), not one day short.
 */
export function addMonthsInclusiveEnd(start: string, months: number): string {
  if (!Number.isInteger(months) || months < 1) throw new ReservationError('invalid_argument', 'months')
  const { y, m, d } = parseDate(start)
  const total = y * 12 + (m - 1) + months
  const ty = Math.floor(total / 12)
  const tm = (total % 12) + 1
  const dim = daysInMonth(ty, tm)
  if (d > dim) return fmt(Date.UTC(ty, tm - 1, dim))
  return fmt(Date.UTC(ty, tm - 1, d) - 86_400_000)
}

/**
 * The validity window of a pass option. `fixed_end` runs from the start date
 * (or the purchase date) to the fixed end; `duration` runs `months` from the
 * start date (or the purchase date). Dates are project-local 'YYYY-MM-DD'.
 */
export function passValidity(option: Pick<PassOption, 'validity'>, purchaseDate: string, startDate?: string | null): PassWindow {
  parseDate(purchaseDate)
  const validFrom = startDate ?? purchaseDate
  parseDate(validFrom)
  const v = option.validity
  if (v.kind === 'fixed_end') {
    parseDate(v.endDate)
    if (v.endDate < validFrom) throw new ReservationError('invalid_argument', 'ends_before_start')
    return { validFrom, validTo: v.endDate }
  }
  return { validFrom, validTo: addMonthsInclusiveEnd(validFrom, v.months) }
}

export function scopeCovers(scope: PassScope, ownerType: OwnerType, ownerPublicId: string): boolean {
  if (ownerType !== 'course') return false
  if (scope.kind === 'all_courses') return true
  return scope.ownerPublicIds.includes(ownerPublicId)
}

/** Does the pass give the right to attend this session (scope + validity)? */
export function passCovers(
  pass: Pick<PassEntitlement, 'validFrom' | 'validTo' | 'scope'>,
  ownerType: OwnerType,
  ownerPublicId: string,
  sessionStartsAt: string,
  timeZone: string,
): boolean {
  if (!scopeCovers(pass.scope, ownerType, ownerPublicId)) return false
  const localDate = localOf(sessionStartsAt, timeZone).slice(0, 10)
  return localDate >= pass.validFrom && localDate <= pass.validTo
}

/** null total = unlimited → null remaining. Never negative. */
export function entriesRemaining(entriesTotal: number | null | undefined, usedCount: number): number | null {
  if (!Number.isInteger(usedCount) || usedCount < 0) throw new ReservationError('invalid_argument', 'used')
  if (entriesTotal === null || entriesTotal === undefined) return null
  if (!Number.isInteger(entriesTotal) || entriesTotal < 0) throw new ReservationError('invalid_argument', 'entries')
  return Math.max(0, entriesTotal - usedCount)
}

export function hasEntryLeft(entriesTotal: number | null | undefined, usedCount: number): boolean {
  const left = entriesRemaining(entriesTotal, usedCount)
  return left === null || left > 0
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

export type SignUpWindowInput = {
  now: Date
  sessionStartsAt: Date
  /** null / undefined = open from the moment the session exists. */
  opensDaysBefore?: number | null
  /** Answers can change until this many hours before the start (0 = until the start). */
  changeUntilHoursBefore: number
}

export type SignUpState = 'not_open_yet' | 'open' | 'closed'

/**
 * "I'm coming" window: opens at start − N days, closes at start − M hours.
 * Both boundaries are inclusive (exactly at the opening instant = open;
 * exactly at the deadline = still open; one millisecond later = closed).
 * If the window is empty (opens after it closes) the deadline wins.
 */
export function canSignUp(input: SignUpWindowInput): SignUpState {
  const start = input.sessionStartsAt.getTime()
  const now = input.now.getTime()
  const closes = start - input.changeUntilHoursBefore * HOUR
  if (now > closes) return 'closed'
  if (input.opensDaysBefore !== null && input.opensDaysBefore !== undefined) {
    if (now < start - input.opensDaysBefore * DAY) return 'not_open_yet'
  }
  return 'open'
}

/**
 * "I'm not coming": allowed until the same change deadline. The entry is given
 * back only when the withdrawal happens in time (D9).
 */
export function canWithdraw(input: Pick<SignUpWindowInput, 'now' | 'sessionStartsAt' | 'changeUntilHoursBefore'>): {
  allowed: boolean
  entryReturned: boolean
} {
  const allowed = input.now.getTime() <= input.sessionStartsAt.getTime() - input.changeUntilHoursBefore * HOUR
  return { allowed, entryReturned: allowed }
}
