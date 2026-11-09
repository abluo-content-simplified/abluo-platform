// ── Reservations — Bookings screens: pure helpers (ADR-044 D5, D6) ────────────
//
// No database, no React. Parsing what a person types (an amount, a date),
// the machine codes the actions answer with, and the activity codes the detail
// shows. The wording of all of them lives in messages/en.json
// (clientDashboard.bookings.errors / .activity).
import { localToUtc } from '@/lib/lifecycle/time'
import { BOOKING_STATUSES, PAYMENT_STATUSES, type BookingStatus, type PaymentStatus } from './types'

/** "12,50", "12.50", "€ 12", "1.250,00" → cents; null when it is not an amount above zero. */
export function parseAmountToCents(input: string): number | null {
  const s = input.replace(/[€\s\u00a0]/g, '')
  if (!s || /[^0-9.,]/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const sep = Math.max(lastComma, lastDot)
  let whole = s
  let frac = ''
  if (sep >= 0) {
    const tail = s.slice(sep + 1)
    const both = lastComma >= 0 && lastDot >= 0
    const count = s.split(s[sep]).length - 1
    // One separator kind, three digits after it ("1.250", "1,250"), or repeated ("1.250.000") = thousands.
    const thousands = !both && (count > 1 || tail.length === 3)
    if (thousands && s.split(s[sep]).slice(1).some((g) => g.length !== 3)) return null
    if (!thousands) {
      whole = s.slice(0, sep)
      frac = tail
    }
  }
  whole = whole.replace(/[.,]/g, '')
  if (frac.length > 2 || !/^\d*$/.test(frac) || !/^\d+$/.test(whole || '0')) return null
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null
}

/** Cents → "12,50" style input text for the field (no currency sign). */
export function centsToInput(cents: number): string {
  const euros = Math.floor(Math.abs(cents) / 100)
  const rest = String(Math.abs(cents) % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${euros},${rest}`
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export function isCalendarDate(value: string): boolean {
  const m = DATE.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Today as 'YYYY-MM-DD' in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return p
}

/** The end of the day 'YYYY-MM-DD' (23:59) in `timeZone`, as a UTC ISO instant; null for a bad date. */
export function endOfDayUtc(date: string, timeZone: string): string | null {
  if (!isCalendarDate(date)) return null
  try {
    return localToUtc(`${date}T23:59`, timeZone).utc
  } catch {
    return null
  }
}

// ── Codes ────────────────────────────────────────────────────────────────────
/** Every code an action can answer with (the wording is in clientDashboard.bookings.errors). */
export const ACTION_ERROR_CODES = [
  'unauthenticated', 'forbidden', 'unavailable', 'failed',
  'full', 'not_found', 'booking_not_found', 'cannot_confirm', 'cannot_extend', 'changed',
  'invalid_amount', 'invalid_method', 'invalid_date', 'invalid_reference', 'invalid_note', 'invalid', 'invalid_booking',
  'payment_method_not_available', 'settings_missing', 'target_not_found', 'already_closed',
] as const
export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number]

/** A code the screen has words for; anything else is the calm "didn't work". */
export function errorKeyOf(code: string): ActionErrorCode {
  return (ACTION_ERROR_CODES as readonly string[]).includes(code) ? (code as ActionErrorCode) : 'failed'
}

/** Activity codes written by 066 and by the dashboard (the wording is in clientDashboard.bookings.activity). */
export const ACTIVITY_ACTIONS = [
  'booking.created', 'booking.confirmed', 'booking.confirm_refused_full', 'booking.hold_extended', 'booking.released',
  'booking.cancelled', 'booking.expired', 'booking.anonymised', 'booking.eligibility_verified',
  'payment.recorded', 'pass.attending', 'pass.withdrawn',
] as const
/** The message key of an activity action: dots become underscores (a dot in a message key reads as nesting). */
export function activityKeyOf(action: string): string {
  return (ACTIVITY_ACTIONS as readonly string[]).includes(action) ? action.replace(/\./g, '_') : 'other'
}

export const PAYMENT_METHOD_CHOICES = ['bank_transfer', 'cash', 'other'] as const
export const PAYMENT_LIMITS = { reference: 200, note: 2000 } as const

// ── The list's address ───────────────────────────────────────────────────────
export type BookingsQuery = { status: BookingStatus | null; paymentStatus: PaymentStatus | null; targetId: string | null; q: string }

/** The query string of a list address ("?status=confirmed&page=2"), without empty parts. */
export function bookingsHref(projectSlug: string, query: BookingsQuery, page = 1): string {
  const p = new URLSearchParams()
  if (query.status) p.set('status', query.status)
  if (query.paymentStatus) p.set('payment', query.paymentStatus)
  if (query.targetId) p.set('what', query.targetId)
  if (query.q.trim()) p.set('q', query.q.trim())
  if (page > 1) p.set('page', String(page))
  const s = p.toString()
  return `/${projectSlug}/bookings${s ? `?${s}` : ''}`
}

type Search = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '')

/** The list's filters and page from the address's query string, with anything unknown dropped. */
export function bookingsQueryOf(sp: Search): { query: BookingsQuery; page: number } {
  const status = one(sp.status)
  const payment = one(sp.payment)
  const page = Number.parseInt(one(sp.page), 10)
  return {
    query: {
      status: (BOOKING_STATUSES as readonly string[]).includes(status) ? (status as BookingStatus) : null,
      paymentStatus: (PAYMENT_STATUSES as readonly string[]).includes(payment) ? (payment as PaymentStatus) : null,
      targetId: one(sp.what) || null,
      q: one(sp.q).slice(0, 80),
    },
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  }
}
