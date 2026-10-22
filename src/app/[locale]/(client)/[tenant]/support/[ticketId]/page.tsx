import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Notice } from '@/components/app/ui/Notice'
import { PageShell } from '@/components/app/ui/PageShell'
import { TicketConversation } from '@/components/client/tickets/TicketConversation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { ticketAccess } from '@/lib/support-tickets/access'
import { getClientTicket } from '@/lib/support-tickets/service'

/**
 * Client dashboard — one support request (ADR-039). Reading it marks it read
 * for this person. A request the person may not see is a 404, like one that
 * does not exist.
 */
export const dynamic = 'force-dynamic'

export default async function SupportTicketPage({ params }: { params: Promise<{ tenant: string; ticketId: string }> }) {
  const { tenant: projectSlug, ticketId } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/support/${encodeURIComponent(ticketId)}`)
  if (!resolveProjectGrant(ctx.projects, projectSlug)) notFound()
  const access = ticketAccess(ctx, projectSlug)
  if (!access) notFound()

  const result = await getClientTicket(access, ticketId, { markRead: !access.supportMode })
  if (!result.ok) {
    if (result.reason === 'error') {
      const t = await getTranslations('clientDashboard.supportTickets')
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
      <TicketConversation ticket={result.value} projectSlug={projectSlug} supportMode={access.supportMode} />
    </PageShell>
  )
}
