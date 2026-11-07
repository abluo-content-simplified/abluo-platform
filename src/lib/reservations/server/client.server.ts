import 'server-only'
// ── Reservations — the production store (service role) ───────────────────────
// The only file of this folder that touches the service-role client. Each call
// opens the audited trusted-operation wrapper; the store itself is db-agnostic.
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { createSupabaseReservationStore, type ReservationDb, type ReservationStore } from './store'

const REASON = 'ADR-044 reservations: server-only booking_* / reservable_* tables and reservations_* functions (migration 066)'

/** A store whose every call runs inside runAsTrustedSystemOperation. */
export function getReservationStore(): ReservationStore {
  const proxy = <K extends keyof ReservationStore>(name: K) =>
    ((...args: unknown[]) =>
      runAsTrustedSystemOperation(REASON, (sb) =>
        (createSupabaseReservationStore(sb as unknown as ReservationDb)[name] as (...a: unknown[]) => Promise<unknown>)(...args),
      )) as ReservationStore[K]
  const names: Array<keyof ReservationStore> = [
    'book', 'passAttend', 'passWithdraw', 'release', 'confirm', 'extendHold', 'recordPayment', 'setPlaces', 'expireHolds',
    'anonymiseBooking', 'reserveLinkAttempt', 'finishLinkAttempt', 'getSettings', 'getTarget', 'listOptions',
    'getBookingByReference', 'getBookingByTokenHash', 'getPassByTokenHash', 'sessionAvailability',
  ]
  return Object.fromEntries(names.map((n) => [n, proxy(n)])) as ReservationStore
}
