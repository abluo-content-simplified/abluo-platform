import 'server-only'
// The production wiring of the Bookings service (service-role stores, real clock, real randomness).
import { randomBytes } from 'crypto'
import { getAppEnvironment } from '@/lib/notifications/environment'
import { getBookingsReader } from './bookings-read.server'
import { readBookingsSiteFacts } from './bookings-site.server'
import { getBookingsWriteStore } from './bookings-write.server'
import { getReservationStore } from './client.server'
import type { BookingsDeps } from './bookings-service'

export function getBookingsDeps(): BookingsDeps {
  return {
    reader: getBookingsReader(),
    store: getReservationStore(),
    writer: getBookingsWriteStore(),
    readSite: readBookingsSiteFacts,
    now: () => new Date(),
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    environment: getAppEnvironment(),
    testRecipient: process.env.RESERVATIONS_TEST_RECIPIENT?.trim() || undefined,
  }
}
