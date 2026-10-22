import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getViewerAccount } from '@/lib/api/viewer-account'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'

/**
 * Client dashboard — Support (Tom, 2026-10-22). A "coming soon" page: the
 * support ticketing system (send a request, attach screenshots, follow its
 * status) is not built yet. Anyone with a grant on the project may open it,
 * like the nav item (`TENANT_SURFACES`, requires {}). No data is read or written.
 */
export const dynamic = 'force-dynamic'

export default async function SupportPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/support`)
  if (!resolveProjectGrant(ctx.projects, projectSlug)) notFound()

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
