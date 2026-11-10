import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { MessagesBrowser } from '@/components/client/messages/MessagesBrowser'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { messageAccess } from '@/lib/messages/access'
import { listClientConversations } from '@/lib/messages/service'

/**
 * Client dashboard — Messages (ADR-050): the person's own conversations with
 * Abluo on this site, as a Records list. Personal (D2): nobody else's. In an
 * Abluo support visit the page says so instead of listing anything (D6).
 */
export const dynamic = 'force-dynamic'

export default async function MessagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/messages`)
  const access = messageAccess(ctx, projectSlug)
  if (!access) notFound()
  const t = await getTranslations('clientDashboard.messages')
  if (access.supportMode) {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <Notice>{t('supportMode')}</Notice>
      </PageShell>
    )
  }
  const list = await listClientConversations(access)
  if (!list.ok) {
    if (list.reason === 'unavailable') notFound()
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <Notice tone="error">{t('errors.error')}</Notice>
      </PageShell>
    )
  }
  return (
    <PageShell>
      <MessagesBrowser conversations={list.value} projectSlug={projectSlug} />
    </PageShell>
  )
}
