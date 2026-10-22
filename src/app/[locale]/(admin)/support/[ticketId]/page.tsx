import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AdminTicketView } from '@/components/admin/tickets/AdminTicketView'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getAdminTicket } from '@/lib/support-tickets/service'

/**
 * One support ticket for the Abluo admin (ADR-039). Reading it marks it read
 * for this admin. `?support=unavailable|failed` is the result of a failed
 * "View as Client" (same wording as the project page).
 */
export const dynamic = 'force-dynamic'

export default async function AdminTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticketId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')
  const [{ ticketId }, query] = await Promise.all([params, searchParams])

  const result = await getAdminTicket(actor.userId, ticketId)
  if (!result.ok) {
    if (result.reason === 'notFound') notFound()
    const t = await getTranslations('admin.supportTickets')
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <EmptyState title={t('loadFailedTitle')} body={t('loadFailedBody')} />
      </PageShell>
    )
  }
  const flag = Array.isArray(query.support) ? query.support[0] : query.support
  return (
    <PageShell>
      <AdminTicketView ticket={result.value} supportNotice={flag === 'unavailable' || flag === 'failed' ? flag : null} />
    </PageShell>
  )
}
