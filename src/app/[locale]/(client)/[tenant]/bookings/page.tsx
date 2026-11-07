import { notFound, redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { BookingsBrowser } from '@/components/client/reservations/BookingsBrowser'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { bookingsQueryOf } from '@/lib/reservations/bookings-form'
import { BOOKINGS_PAGE_SIZE, type BookingPage } from '@/lib/reservations/server/bookings-read'
import { getBookingsDeps } from '@/lib/reservations/server/bookings-deps.server'
import { BOOKING_READ_PERMISSION, loadBookingList } from '@/lib/reservations/server/bookings-service'

/**
 * Client dashboard — Bookings (ADR-044 D4, D16.15): the list of the project's
 * bookings; Booking rules is the other tab. Needs the Reservations module on the
 * project and `reservations.booking.read` (anything else is a 404, like every
 * other module page). Filters and the page number live in the address. Before
 * migration 066 is applied the page says so calmly instead of failing.
 *
 * TODO(D16.7): the print-friendly session roster, /{project}/bookings/roster/[occurrenceId],
 * needs the session list (titles, times) from the schedule; not built yet.
 */
export const dynamic = 'force-dynamic'

type Search = Record<string, string | string[] | undefined>

export default async function BookingsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<Search> }) {
  const { tenant: projectSlug } = await params
  const { query, page } = bookingsQueryOf(await searchParams)
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/bookings`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes('reservations') || !grant.permissions.includes(BOOKING_READ_PERMISSION)) notFound()

  let result
  try {
    result = await loadBookingList(ctx, grant.projectId, { ...query, page }, getBookingsDeps())
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  const empty: BookingPage = { rows: [], total: 0, page: 1, pageSize: BOOKINGS_PAGE_SIZE }
  return (
    <PageShell>
      {result.ok ? (
        <BookingsBrowser projectSlug={projectSlug} page={result.view.page} targets={result.view.targets} query={query} timeZone={result.view.timeZone} />
      ) : (
        <BookingsBrowser projectSlug={projectSlug} page={empty} targets={[]} query={query} timeZone="UTC" unavailable />
      )}
    </PageShell>
  )
}
