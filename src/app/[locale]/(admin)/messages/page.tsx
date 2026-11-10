import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { AdminMessagesBrowser } from '@/components/admin/messages/AdminMessagesBrowser'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { listAdminConversations } from '@/lib/messages/service'

/**
 * Admin Messages (ADR-050): every conversation — the Abluo side is a team
 * inbox (D1). `?view=archived` lists the archived ones. Reads with the
 * SERVICE ROLE, so it checks `requireAbluoAdmin()` itself besides the layout.
 */
export const dynamic = 'force-dynamic'

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')
  const archived = (await searchParams).view === 'archived'
  const result = await listAdminConversations(actor.userId, { archived })
  const t = await getTranslations('admin.messages')
  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <EmptyState title={result.reason === 'unavailable' ? t('unavailableTitle') : t('loadFailedTitle')} body={result.reason === 'unavailable' ? t('unavailableBody') : t('loadFailedBody')} />
      </PageShell>
    )
  }
  return (
    <PageShell>
      <AdminMessagesBrowser conversations={result.value} archived={archived} />
    </PageShell>
  )
}
