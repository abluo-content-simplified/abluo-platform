import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageShell } from '@/components/app/ui/PageShell'
import { AdminConversationView } from '@/components/admin/messages/AdminConversationView'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getAdminConversation } from '@/lib/messages/service'

/** Admin — one conversation (ADR-050): thread, recipients with "Seen" (D6), reply, archive. Opening it marks it read for this admin. */
export const dynamic = 'force-dynamic'

export default async function AdminConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')
  const { conversationId } = await params
  const result = await getAdminConversation(actor.userId, conversationId)
  if (!result.ok) {
    if (result.reason === 'notFound' || result.reason === 'unavailable') notFound()
    const t = await getTranslations('admin.messages')
    return (
      <PageShell>
        <EmptyState title={t('loadFailedTitle')} body={t('loadFailedBody')} />
      </PageShell>
    )
  }
  return (
    <PageShell>
      <AdminConversationView conversation={result.value} />
    </PageShell>
  )
}
