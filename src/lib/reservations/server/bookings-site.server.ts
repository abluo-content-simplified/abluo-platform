import 'server-only'
// Reads, from Sanity, the two site facts the Bookings screens show: the time zone
// (all times are the site's local time, 24-hour) and the languages (which
// snapshot title to prefer). Read-only.
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { bookingsSiteFactsOf, type BookingsSiteFacts } from './bookings-service'

const QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ timeZone, defaultLocale, supportedLocales }`

export async function readBookingsSiteFacts(projectSlug: string): Promise<BookingsSiteFacts> {
  try {
    return bookingsSiteFactsOf(await sanityWriteClient.fetch(QUERY, { projectSlug }, { perspective: 'raw' }))
  } catch {
    return bookingsSiteFactsOf(null)
  }
}
