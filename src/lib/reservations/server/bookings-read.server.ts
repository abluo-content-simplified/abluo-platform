import 'server-only'
// ── Reservations — the production Bookings reader (service role) ──────────────
// Each call opens the audited trusted-operation wrapper (like settings-store.server.ts).
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { createBookingsReader, type BookingsDb, type BookingsReader } from './bookings-read'

const REASON = 'ADR-044 reservations: booking_* tables are server-only, read for the tenant Bookings list and detail (migration 066)'

export function getBookingsReader(): BookingsReader {
  const proxy = <K extends keyof BookingsReader>(name: K) =>
    ((...args: unknown[]) =>
      runAsTrustedSystemOperation(REASON, (sb) =>
        (createBookingsReader(sb as unknown as BookingsDb)[name] as (...a: unknown[]) => Promise<unknown>)(...args),
      )) as BookingsReader[K]
  return { listBookings: proxy('listBookings'), listTargetOptions: proxy('listTargetOptions'), getBookingDetail: proxy('getBookingDetail') }
}
