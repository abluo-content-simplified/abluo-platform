import 'server-only'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { createBookingsWriteStore, type BookingsWriteDb, type BookingsWriteStore } from './bookings-write'

const REASON = 'ADR-044 reservations: booking_attendees / bookings are server-only; eligibility check from the tenant Bookings detail (migration 066)'

export function getBookingsWriteStore(): BookingsWriteStore {
  return {
    verifyEligibility: (...args) =>
      runAsTrustedSystemOperation(REASON, (sb) => createBookingsWriteStore(sb as unknown as BookingsWriteDb).verifyEligibility(...args)),
  }
}
