import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { Notice } from '@/components/app/ui/Notice'
import { SupportTicketsBrowser } from '@/components/client/tickets/SupportTicketsBrowser'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { ticketAccess } from '@/lib/support-tickets/access'
import { listClientTickets } from '@/lib/support-tickets/service'

/**
 * Client dashboard — Support. Support Tickets V1 (ADR-039): the person's
 * requests as a Records list with "New Request". While the ticket tables are
 * not there yet (migration 046 not applied → `unavailable`) the page stays the
 * calm "coming soon" message it has been. Anyone with a grant on the project
 * may open it, like the nav item (`TENANT_SURFACES`, requires {}).
 */
export const dynamic = 'force-dynamic'

export default async function SupportPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/support`)
  if (!resolveProjectGrant(ctx.projects, projectSlug)) notFound()

  const access = ticketAccess(ctx, projectSlug)
  const list = access ? await listClientTickets(access) : null
  if (access && list?.ok) {
    return (
      <PageShell>
        <SupportTicketsBrowser tickets={list.value} projectSlug={projectSlug} canWrite={access.canWrite} supportMode={access.supportMode} />
      </PageShell>
    )
  }
  if (access && list && !list.ok && list.reason !== 'unavailable') {
    const tt = await getTranslations('clientDashboard.supportTickets')
    return (
      <PageShell>
        <PageHeader title={tt('title')} />
        <Notice tone="error">{tt('errors.error')}</Notice>
      </PageShell>
    )
  }

  const [t, viewer] = await Promise.all([getTranslations('clientDashboard.supportPage'), getViewerAccount(ctx.userId)])
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
