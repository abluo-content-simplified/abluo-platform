import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getViewerAccount } from '@/lib/api/viewer-account'

/**
 * Admin Support Tickets (Tom, 2026-10-22). A "coming soon" page: the requests
 * clients will send from their dashboard's Support page arrive here once the
 * ticketing system is built. No data is read or written.
 */
export const dynamic = 'force-dynamic'

export default async function AdminSupportPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')

  const [t, viewer] = await Promise.all([getTranslations('admin.supportTickets'), getViewerAccount(actor.userId)])
  const firstName = viewer.name.trim().split(/\s+/)[0] ?? ''

  return (
    <PageShell>
      <PageHeader title={t('title')} />
      <EmptyState
        title={firstName ? t('greeting', { name: firstName }) : t('greetingNoName')}
        body={t('body')}
      />
    </PageShell>
  )
}
