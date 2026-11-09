import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { getDateLocale } from '@/lib/i18n/date-locale-server'
import { AnalyticsOverview } from '@/components/app/analytics/AnalyticsOverview'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { canReadAnalytics, getProjectAnalytics } from '@/lib/analytics/read'
import { getProjectRequestStats } from '@/lib/analytics/requests'
import { DIGITAL_CARD_STATS_PERMISSION, getDigitalCardsOverview, type DigitalCardsOverview } from '@/lib/api/digital-cards'
import { DIGITAL_CARDS_MODULE_ID } from '@/lib/modules/digital-cards/model'
import { DigitalCardsAnalytics } from '@/components/client/digital-cards/DigitalCardsAnalytics'

/**
 * Client dashboard — Analytics (ADR-029 §3.4, Phase 3). How the website is
 * doing: visitors, page views, search clicks and position, vs the previous 28
 * days; trend charts, top pages, channels, searches, referring sites, AI
 * assistants, devices — and contact requests when the reader may see them
 * (analytics v2). Read-only, from the daily
 * snapshot (never a live Google call). Owners and Site admins see it; an
 * Editor only with the `analytics.read` extra — anyone else gets a 404.
 *
 * Nothing here exposes how the site is connected to Google: that is Abluo's
 * configuration (Studio). When nothing is connected yet, the page says so.
 *
 * Digital Cards (ADR-049 Amendment A): when the module is installed and the
 * reader holds digital-cards.stats.read, a block with all cards together
 * (last 30 days, our own cookieless counts) — shown whether or not Google is
 * connected.
 */
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/analytics`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !canReadAnalytics(grant)) notFound()

  const t = await getTranslations('clientDashboard.analytics')
  const showCards = grant.enabledModuleIds.includes(DIGITAL_CARDS_MODULE_ID) && grant.permissions.includes(DIGITAL_CARD_STATS_PERMISSION)
  const [view, requests, cards] = await Promise.all([
    getProjectAnalytics(ctx, grant.projectId).catch((e) => {
      console.warn(`[analytics] ${projectSlug}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }),
    // Only for readers who may see contact requests (Forms module + forms.submission.read).
    getProjectRequestStats(ctx, grant.projectId).catch((e) => {
      console.warn(`[analytics] ${projectSlug} requests: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }),
    showCards
      ? getDigitalCardsOverview(ctx, grant.projectId, { days: 30 }).catch((e): DigitalCardsOverview | null => {
          console.warn(`[analytics] ${projectSlug} digital cards: ${e instanceof Error ? e.message : String(e)}`)
          return null
        })
      : Promise.resolve(null),
  ])

  return (
    <PageShell>
      <PageHeader title={t('title')} />
      {view === null ? (
        <EmptyState title={t('errorTitle')} body={t('errorBody')} />
      ) : view.hasData ? (
        <AnalyticsOverview view={view} requests={requests} dateLocale={await getDateLocale()} />
      ) : (
        <EmptyState title={t('notConnectedTitle')} body={t('notConnectedBody')} />
      )}
      {showCards ? <div className="mt-7"><DigitalCardsAnalytics projectSlug={projectSlug} overview={cards} /></div> : null}
    </PageShell>
  )
}
