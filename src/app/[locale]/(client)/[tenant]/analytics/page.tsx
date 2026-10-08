import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { AnalyticsOverview } from '@/components/app/analytics/AnalyticsOverview'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { canReadAnalytics, getProjectAnalytics } from '@/lib/analytics/read'

/**
 * Client dashboard — Analytics (ADR-029 §3.4, Phase 3). How the website is
 * doing: visitors, page views, search clicks and position, vs the previous 28
 * days; top pages, channels and search queries. Read-only, from the daily
 * snapshot (never a live Google call). Owners and Site admins see it; an
 * Editor only with the `analytics.read` extra — anyone else gets a 404.
 *
 * Nothing here exposes how the site is connected to Google: that is Abluo's
 * configuration (Studio). When nothing is connected yet, the page says so.
 */
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/analytics`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !canReadAnalytics(grant)) notFound()

  const t = await getTranslations('clientDashboard.analytics')
  const view = await getProjectAnalytics(ctx, grant.projectId).catch((e) => {
    console.warn(`[analytics] ${projectSlug}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })

  return (
    <PageShell>
      <PageHeader title={t('title')} />
      {view === null ? (
        <EmptyState title={t('errorTitle')} body={t('errorBody')} />
      ) : view.hasData ? (
        <AnalyticsOverview view={view} />
      ) : (
        <EmptyState title={t('notConnectedTitle')} body={t('notConnectedBody')} />
      )}
    </PageShell>
  )
}
