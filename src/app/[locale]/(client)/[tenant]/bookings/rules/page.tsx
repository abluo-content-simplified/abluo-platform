import { notFound, redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { BookingsTabs } from '@/components/client/reservations/BookingsTabs'
import { BookingRules } from '@/components/client/reservations/BookingRules'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { BOOKING_READ_PERMISSION, loadBookingRules } from '@/lib/reservations/server/settings-service'
import { readSiteFacts } from '@/lib/reservations/server/settings-site.server'
import { getSettingsStore } from '@/lib/reservations/server/settings-store.server'

/**
 * Client dashboard — Bookings → Booking rules (ADR-044 D7, D9, D13, D16.14/15).
 * Needs the Reservations module on the project and `reservations.booking.read`
 * (anything else is a 404, like every other module page). Saving needs
 * `reservations.settings.manage`; without it the page is read-only. Before
 * migration 066 is applied the page says so calmly instead of failing.
 */
export const dynamic = 'force-dynamic'

export default async function BookingRulesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/bookings/rules`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes('reservations') || !grant.permissions.includes(BOOKING_READ_PERMISSION)) notFound()

  let result
  try {
    result = await loadBookingRules(ctx, grant.projectId, { store: getSettingsStore(), readSite: readSiteFacts })
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <BookingsTabs projectSlug={projectSlug} current="rules" />
      {result.ok ? <BookingRules projectSlug={projectSlug} initial={result.view} /> : <BookingRules projectSlug={projectSlug} initial={null} />}
    </PageShell>
  )
}
