import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Notice } from '@/components/app/ui/Notice'
import { PageShell } from '@/components/app/ui/PageShell'
import { ConversationView } from '@/components/client/messages/ConversationView'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { messageAccess } from '@/lib/messages/access'
import { getClientConversation } from '@/lib/messages/service'

/**
 * Client dashboard — one conversation (ADR-050). Reading it marks it read (and
 * its bell row). Someone who is not a participant gets a 404, like a
 * conversation that does not exist.
 */
export const dynamic = 'force-dynamic'

export default async function ConversationPage({ params }: { params: Promise<{ tenant: string; conversationId: string }> }) {
  const { tenant: projectSlug, conversationId } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/messages/${encodeURIComponent(conversationId)}`)
  const access = messageAccess(ctx, projectSlug)
  if (!access || access.supportMode) notFound()
  const result = await getClientConversation(access, conversationId)
  if (!result.ok) {
    if (result.reason === 'error') {
      const t = await getTranslations('clientDashboard.messages')
      return (
        <PageShell>
          <Notice tone="error">{t('errors.error')}</Notice>
        </PageShell>
      )
    }
    notFound()
  }
  return (
    <PageShell>
      <ConversationView conversation={result.value} projectSlug={projectSlug} />
    </PageShell>
  )
}
