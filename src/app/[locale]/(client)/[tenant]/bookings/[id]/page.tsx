import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/app/ui/BackLink'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageShell } from '@/components/app/ui/PageShell'
import { BookingDetailView } from '@/components/client/reservations/BookingDetailView'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { getBookingsDeps } from '@/lib/reservations/server/bookings-deps.server'
import { BOOKING_READ_PERMISSION, loadBookingDetail } from '@/lib/reservations/server/bookings-service'

/**
 * Client dashboard — Bookings → one booking (ADR-044 D4-D6, D16.18). Same gate as
 * the list: the module on the project and `reservations.booking.read`; a booking
 * of another project is a 404 (every read carries the project id).
 */
export const dynamic = 'force-dynamic'

export default async function BookingDetailPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/bookings/${id}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes('reservations') || !grant.permissions.includes(BOOKING_READ_PERMISSION)) notFound()

  let result
  try {
    result = await loadBookingDetail(ctx, grant.projectId, id, getBookingsDeps())
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  if (!result.ok && result.error === 'not_found') notFound()

  if (!result.ok) {
    const t = await getTranslations('clientDashboard.bookings.detail')
    return (
      <PageShell>
        <BackLink href={`/${projectSlug}/bookings`} label={t('back')} />
        <EmptyState title={t('unavailableTitle')} body={t('unavailableBody')} />
      </PageShell>
    )
  }
  return (
    <PageShell>
      <BookingDetailView projectSlug={projectSlug} detail={result.view.detail} timeZone={result.view.timeZone} can={result.view.can} />
    </PageShell>
  )
}
