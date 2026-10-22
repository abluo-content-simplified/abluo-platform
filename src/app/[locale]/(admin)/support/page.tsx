import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { AdminTicketsBrowser } from '@/components/admin/tickets/AdminTicketsBrowser'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { applyAdminView, parseAdminView, projectOptions } from '@/lib/support-tickets/admin-view'
import { listAdminTickets } from '@/lib/support-tickets/service'

/**
 * Admin Support Tickets (ADR-039): every client request, newest activity first.
 * Filters are URL search params (`project`, `status`, `severity`; status defaults
 * to "Active" = not resolved). Reads with the SERVICE ROLE, so it checks
 * `requireAbluoAdmin()` itself besides the `(admin)` layout gate. Until the
 * ticket tables exist (migration 046) it keeps the "coming soon" state.
 */
export const dynamic = 'force-dynamic'

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')

  const view = parseAdminView(await searchParams)
  // One read of everything; the filters are applied in memory so the project list and the total come from the same rows.
  const result = await listAdminTickets(actor.userId, { status: 'all' })
  const t = await getTranslations('admin.supportTickets')

  if (!result.ok && result.reason === 'unavailable') {
    const viewer = await getViewerAccount(actor.userId)
    const firstName = viewer.name.trim().split(/\s+/)[0] ?? ''
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <EmptyState title={firstName ? t('greeting', { name: firstName }) : t('greetingNoName')} body={t('body')} />
      </PageShell>
    )
  }
  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <EmptyState title={t('loadFailedTitle')} body={t('loadFailedBody')} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <AdminTicketsBrowser
        title={t('title')}
        tickets={applyAdminView(result.value, view)}
        total={result.value.length}
        projects={projectOptions(result.value)}
        view={view}
      />
    </PageShell>
  )
}
