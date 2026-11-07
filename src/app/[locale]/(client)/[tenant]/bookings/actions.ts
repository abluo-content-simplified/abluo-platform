'use server'

/**
 * Bookings — server actions (ADR-044 D5, D6, D16.15, D16.18).
 *
 *   recordPaymentAction   { projectSlug, bookingId, method, amountCents, paidOn, reference?, note? }  reservations.payment.update
 *   confirmBookingAction  { projectSlug, bookingId }                                                  reservations.booking.write
 *   extendHoldAction      { projectSlug, bookingId, until }   until = 'YYYY-MM-DD' in the site's time  reservations.booking.write
 *   cancelBookingAction   { projectSlug, bookingId }                                                  reservations.booking.write
 *   verifyEligibilityAction { projectSlug, bookingId }                                                reservations.booking.write
 *
 * Failure: { ok: false, error: <code>, occurrenceIds? } where the code is one of
 * ACTION_ERROR_CODES (bookings-form.ts); the screen turns it into words.
 * The project comes from the caller's grant (resolveProjectAction), never from input.
 */
import { runBookingAction } from './run-action'
import {
  cancelBooking, confirmBooking, extendBookingHold, markEligibilityVerified, recordBookingPayment,
} from '@/lib/reservations/server/bookings-service'

type Base = { projectSlug: string; bookingId: string }

export async function recordPaymentAction(input: Base & { method: string; amountCents: number; paidOn: string; reference?: string; note?: string }) {
  return runBookingAction(input?.projectSlug, ({ ctx, projectId }, deps) => recordBookingPayment(ctx, projectId, input, deps))
}

export async function confirmBookingAction(input: Base) {
  return runBookingAction(input?.projectSlug, ({ ctx, projectId }, deps) => confirmBooking(ctx, projectId, input.bookingId, deps))
}

export async function extendHoldAction(input: Base & { until: string }) {
  return runBookingAction(input?.projectSlug, ({ ctx, projectId }, deps) => extendBookingHold(ctx, projectId, input, deps))
}

export async function cancelBookingAction(input: Base) {
  return runBookingAction(input?.projectSlug, ({ ctx, projectId }, deps) => cancelBooking(ctx, projectId, input.bookingId, deps))
}

export async function verifyEligibilityAction(input: Base) {
  return runBookingAction(input?.projectSlug, ({ ctx, projectId }, deps) => markEligibilityVerified(ctx, projectId, input.bookingId, deps))
}
