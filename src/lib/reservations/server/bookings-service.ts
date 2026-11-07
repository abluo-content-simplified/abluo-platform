// ── Reservations — Bookings service (ADR-044 D4, D5, D6, D7, D16.15, D16.18) ──
//
// The one reader/writer behind the Bookings list and detail. Authorisation first
// (module installed for THIS project + permission, ADR-015 steps 4-5), then the
// store. The project id comes from the caller's grant, never from input.
//   list, detail        → reservations.booking.read
//   record a payment    → reservations.payment.update
//   confirm, extend hold, cancel, eligibility → reservations.booking.write
// Every function throws TenantAuthorizationError BEFORE any I/O when refused.
// Results carry machine codes only; the wording is in messages/en.json.
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { recordPayment } from '../service/payments'
import { fromStoreError, makeIntent, recipientsOf, type ServiceDeps, type ServiceStore } from '../service/types'
import { endOfDayUtc, isCalendarDate, PAYMENT_LIMITS, PAYMENT_METHOD_CHOICES, todayIn } from '../bookings-form'
import type { Actor, BookingRow } from './types'
import {
  type BookingDetail, type BookingFilters, type BookingPage, type BookingsReader, type TargetOption, targetRefOf,
} from './bookings-read'
import type { BookingsWriteStore } from './bookings-write'

export const BOOKING_READ_PERMISSION = 'reservations.booking.read'
export const BOOKING_WRITE_PERMISSION = 'reservations.booking.write'
export const PAYMENT_UPDATE_PERMISSION = 'reservations.payment.update'

export type BookingsSiteFacts = { timeZone: string; locales: string[] }

const FALLBACK_ZONE = 'Europe/Rome'
export function bookingsSiteFactsOf(r: { timeZone?: unknown; defaultLocale?: unknown; supportedLocales?: unknown } | null): BookingsSiteFacts {
  let timeZone = FALLBACK_ZONE
  if (typeof r?.timeZone === 'string' && r.timeZone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: r.timeZone })
      timeZone = r.timeZone
    } catch { /* keep the fallback */ }
  }
  const supported = Array.isArray(r?.supportedLocales) ? (r!.supportedLocales as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : []
  const def = typeof r?.defaultLocale === 'string' && r.defaultLocale ? r.defaultLocale : null
  return { timeZone, locales: [...new Set([...(def ? [def] : []), ...supported, 'en'])] }
}

export type BookingsDeps = {
  reader: BookingsReader
  /** The reservations store (writes call the 066 functions). */
  store: ServiceStore
  writer: BookingsWriteStore
  readSite: (projectSlug: string) => Promise<BookingsSiteFacts>
  now: () => Date
  randomBytes: ServiceDeps['randomBytes']
  environment: ServiceDeps['environment']
  testRecipient?: string
}

const serviceDeps = (d: BookingsDeps): ServiceDeps => ({ store: d.store, now: d.now, randomBytes: d.randomBytes, environment: d.environment, testRecipient: d.testRecipient })

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}
function holds(ctx: TenantAuthorizationContext, projectId: string, permission: string): boolean {
  try {
    assertModuleAction(ctx, projectId, permission)
    return true
  } catch {
    return false
  }
}
const actorOf = (ctx: TenantAuthorizationContext): Actor => ({ kind: 'user', id: ctx.userId })

export type Can = { write: boolean; pay: boolean }
const canOf = (ctx: TenantAuthorizationContext, projectId: string): Can => ({
  write: holds(ctx, projectId, BOOKING_WRITE_PERMISSION),
  pay: holds(ctx, projectId, PAYMENT_UPDATE_PERMISSION),
})

// ── Reads ────────────────────────────────────────────────────────────────────
export type ListView = { page: BookingPage; targets: TargetOption[]; timeZone: string; can: Can }
export type ListResult = { ok: true; view: ListView } | { ok: false; error: 'unavailable' }

/** Throws TenantAuthorizationError when the caller may not read bookings of this project. */
export async function loadBookingList(ctx: TenantAuthorizationContext, projectId: string, filters: BookingFilters, deps: BookingsDeps): Promise<ListResult> {
  const grant = grantFor(ctx, projectId, BOOKING_READ_PERMISSION)
  const site = await deps.readSite(grant.projectSlug)
  const [page, targets] = await Promise.all([deps.reader.listBookings(projectId, filters, site.locales), deps.reader.listTargetOptions(projectId, site.locales)])
  if (!page.ok || !targets.ok) return { ok: false, error: 'unavailable' }
  return { ok: true, view: { page: page.value, targets: targets.value, timeZone: site.timeZone, can: canOf(ctx, projectId) } }
}

export type DetailView = { detail: BookingDetail; timeZone: string; can: Can }
export type DetailResult = { ok: true; view: DetailView } | { ok: false; error: 'unavailable' | 'not_found' }

export async function loadBookingDetail(ctx: TenantAuthorizationContext, projectId: string, bookingId: string, deps: BookingsDeps): Promise<DetailResult> {
  const grant = grantFor(ctx, projectId, BOOKING_READ_PERMISSION)
  const site = await deps.readSite(grant.projectSlug)
  const r = await deps.reader.getBookingDetail(projectId, bookingId, site.locales)
  if (!r.ok) return { ok: false, error: 'unavailable' }
  if (!r.value) return { ok: false, error: 'not_found' }
  return { ok: true, view: { detail: r.value, timeZone: site.timeZone, can: canOf(ctx, projectId) } }
}

// ── Writes ───────────────────────────────────────────────────────────────────
export type Failure = { ok: false; code: string; occurrenceIds?: string[] }
const refuse = (code: string): Failure => ({ ok: false, code })

export type PaymentInput = { bookingId: string; method: unknown; amountCents: unknown; paidOn: unknown; reference?: unknown; note?: unknown }
export type PaymentDone = { ok: true; paymentStatus: string; confirmed: boolean; paymentReview: boolean; fullOccurrenceIds: string[] }

/** Throws TenantAuthorizationError without `reservations.payment.update`. */
export async function recordBookingPayment(ctx: TenantAuthorizationContext, projectId: string, input: PaymentInput, deps: BookingsDeps): Promise<PaymentDone | Failure> {
  const grant = grantFor(ctx, projectId, PAYMENT_UPDATE_PERMISSION)
  const amount = input.amountCents
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return refuse('invalid_amount')
  if (typeof input.method !== 'string' || !(PAYMENT_METHOD_CHOICES as readonly string[]).includes(input.method)) return refuse('invalid_method')
  if (typeof input.paidOn !== 'string' || !isCalendarDate(input.paidOn)) return refuse('invalid_date')
  const reference = typeof input.reference === 'string' ? input.reference.trim() : ''
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (reference.length > PAYMENT_LIMITS.reference) return refuse('invalid_reference')
  if (note.length > PAYMENT_LIMITS.note) return refuse('invalid_note')

  const site = await deps.readSite(grant.projectSlug)
  // A payment dated tomorrow or later is a typo (today may already be tomorrow elsewhere: one day of slack).
  if (input.paidOn > todayIn(site.timeZone, new Date(deps.now().getTime() + 24 * 3_600_000))) return refuse('invalid_date')

  const detail = await deps.reader.getBookingDetail(projectId, String(input.bookingId))
  if (!detail.ok) return refuse('unavailable')
  if (!detail.value) return refuse('booking_not_found')
  const target = targetRefOf(detail.value.target)
  if (!target) return refuse('target_not_found')
  if (detail.value.booking.status === 'cancelled' || detail.value.booking.status === 'expired') return refuse('already_closed')

  const r = await recordPayment({
    projectId, bookingId: detail.value.booking.id, target,
    method: input.method as (typeof PAYMENT_METHOD_CHOICES)[number], amountCents: amount, paidOn: input.paidOn,
    reference: reference || null, note: note || null, actor: actorOf(ctx),
  }, serviceDeps(deps))
  if (!r.ok) return { ok: false, code: r.code, ...(r.occurrenceIds ? { occurrenceIds: r.occurrenceIds } : {}) }
  return { ok: true, paymentStatus: r.value.paymentStatus, confirmed: r.value.confirmed, paymentReview: r.value.paymentReview, fullOccurrenceIds: r.value.fullOccurrenceIds }
}

/** Throws TenantAuthorizationError without `reservations.booking.write`. */
export async function confirmBooking(ctx: TenantAuthorizationContext, projectId: string, bookingId: string, deps: BookingsDeps): Promise<{ ok: true } | Failure> {
  grantFor(ctx, projectId, BOOKING_WRITE_PERMISSION)
  const r = await deps.store.confirm(projectId, String(bookingId), actorOf(ctx))
  if (!r.ok) return failOf(r.error)
  if (!r.value.confirmed) return r.value.full.length ? { ok: false, code: 'full', occurrenceIds: r.value.full } : refuse('cannot_confirm')
  if (!r.value.replayed) {
    const b = await deps.store.getBookingById(projectId, String(bookingId))
    if (b.ok && b.value?.purchaserEmail) await queueConfirmed(b.value, deps)
  }
  return { ok: true }
}

async function queueConfirmed(b: BookingRow, deps: BookingsDeps) {
  await deps.store.enqueueOutbox(b.projectId, [{
    bookingId: b.id,
    intent: makeIntent(deps, {
      intent: 'booking.confirmed', dedupeKey: `booking.confirmed:${b.id}:manual`,
      recipients: recipientsOf({ email: b.purchaserEmail, name: b.purchaserName }), locale: b.locale,
      payload: { reference: b.reference, totalCents: b.totalCents },
    }),
  }])
}

/** `until` is a calendar day in the site's time zone; the hold lasts to the end of it. */
export async function extendBookingHold(ctx: TenantAuthorizationContext, projectId: string, input: { bookingId: string; until: unknown }, deps: BookingsDeps): Promise<{ ok: true; until: string } | Failure> {
  const grant = grantFor(ctx, projectId, BOOKING_WRITE_PERMISSION)
  if (typeof input.until !== 'string' || !isCalendarDate(input.until)) return refuse('invalid_date')
  const site = await deps.readSite(grant.projectSlug)
  const instant = endOfDayUtc(input.until, site.timeZone)
  if (!instant) return refuse('invalid_date')
  const t = deps.now().getTime()
  // Later than now, and not more than a year ahead.
  if (new Date(instant).getTime() <= t || new Date(instant).getTime() > t + 366 * 24 * 3_600_000) return refuse('invalid_date')
  const r = await deps.store.extendHold(projectId, String(input.bookingId), instant, actorOf(ctx))
  if (!r.ok) return failOf(r.error)
  return { ok: true, until: instant }
}

export async function cancelBooking(ctx: TenantAuthorizationContext, projectId: string, bookingId: string, deps: BookingsDeps): Promise<{ ok: true; released: number } | Failure> {
  grantFor(ctx, projectId, BOOKING_WRITE_PERMISSION)
  const r = await deps.store.release(projectId, String(bookingId), 'cancelled', { cancelBooking: true, actor: actorOf(ctx) })
  if (!r.ok) return failOf(r.error)
  return { ok: true, released: r.value.released }
}

export async function markEligibilityVerified(ctx: TenantAuthorizationContext, projectId: string, bookingId: string, deps: BookingsDeps): Promise<{ ok: true; verified: number } | Failure> {
  grantFor(ctx, projectId, BOOKING_WRITE_PERMISSION)
  const r = await deps.writer.verifyEligibility(projectId, String(bookingId), actorOf(ctx))
  if (!r.ok) return failOf(r.error)
  return { ok: true, verified: r.value.verified }
}

function failOf(e: Parameters<typeof fromStoreError>[0]): Failure {
  const f = fromStoreError(e)
  return { ok: false, code: f.ok ? 'failed' : f.code, ...(!f.ok && f.occurrenceIds ? { occurrenceIds: f.occurrenceIds } : {}) }
}
