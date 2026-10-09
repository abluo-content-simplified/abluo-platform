import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FactRow } from '@/components/app/ui/FactRow'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { AnalyticsOverview } from '@/components/app/analytics/AnalyticsOverview'
import { RefreshNowButton } from '@/components/admin/analytics/RefreshNowButton'
import { StatusPill } from '@/components/admin/analytics/PortfolioBrowser'
import { getAdminProjectAnalytics } from '@/lib/admin/analytics'
import { dataStatusOf } from '@/lib/analytics/view'

export const dynamic = 'force-dynamic'

/**
 * Admin → Analytics → one site: the SAME widgets the client sees
 * (AnalyticsOverview), plus what only Abluo sees — the data status, the last
 * error from Google, which IDs are set in Studio, and "Refresh now".
 * requireAbluoAdmin() inside getAdminProjectAnalytics; the view is audited
 * (`project.analytics.view`).
 */
export default async function AdminSiteAnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await getAdminProjectAnalytics({ slug }, { audit: true })
  if (!data) notFound()
  const t = await getTranslations('admin.analytics')
  const { project, view, config, requests } = data

  return (
    <PageShell>
      <div className="space-y-1">
        <Link href="/analytics" className="inline-flex min-h-11 items-center text-sm font-medium text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {t('site.back')}
        </Link>
        <PageHeader title={project.name} actions={<RefreshNowButton slug={project.slug} />} />
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono">{project.slug}</span>
          <StatusPill status={dataStatusOf(view)} />
        </div>
      </div>

      {view.errors.length ? (
        <div role="alert" className="flex flex-col gap-1 rounded-2xl border border-destructive px-4 py-3 text-sm">
          <p className="font-medium text-destructive">{t('site.errorTitle')}</p>
          {view.errors.map((e) => (
            <p key={e.source} className="break-words text-foreground">
              <span className="font-medium">{t(`site.source.${e.source}`)}:</span> {e.message}
            </p>
          ))}
        </div>
      ) : null}

      {view.hasData ? <AnalyticsOverview view={view} requests={requests} /> : <EmptyState title={t('site.emptyTitle')} body={t('site.emptyBody')} />}

      <section aria-labelledby="analytics-config" className="flex flex-col gap-3">
        <SectionHeading id="analytics-config" title={t('site.configHeading')} />
        <dl className="rounded-xl border border-border bg-card px-4">
          <FactRow label={t('site.ga4Property')}>{config.ga4PropertyId ?? <span className="text-muted-foreground">{t('site.notSet')}</span>}</FactRow>
          <FactRow label={t('site.gscProperty')}>{config.gscSiteUrl ?? <span className="text-muted-foreground">{t('site.notSet')}</span>}</FactRow>
          <FactRow label={t('site.ga4State')}>{t(`site.state.${view.ga4}`)}</FactRow>
          <FactRow label={t('site.gscState')}>{t(`site.state.${view.gsc}`)}</FactRow>
        </dl>
        <p className="text-sm text-muted-foreground">{t('site.configHint')}</p>
      </section>
    </PageShell>
  )
}
