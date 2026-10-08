import { getTranslations } from 'next-intl/server'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { DailySparkline } from '@/components/app/analytics/AnalyticsOverview'
import { getAdminProjectAnalytics } from '@/lib/admin/analytics'
import { dataStatusOf } from '@/lib/analytics/view'
import { StatusPill } from './PortfolioBrowser'

/**
 * Compact analytics for the admin Project page (ADR-030 §5.2): visitors and
 * search clicks (28 days, vs the 28 before) with the daily sparkline, the data
 * status, and a link to the full site analytics.
 *
 * Server component, self-contained: requireAbluoAdmin() first (inside
 * getAdminProjectAnalytics), renders nothing when refused or when the project
 * is unknown. Records `project.analytics.view` in the admin audit log.
 *
 * Wiring: `{/* ANALYTICS_SLOT *\/}` on the admin Project page →
 *   <ProjectAnalyticsBlock projectId={project.id} />   (or slug={project.slug})
 */
export async function ProjectAnalyticsBlock(props: { projectId: string; slug?: never } | { slug: string; projectId?: never }) {
  const data = await getAdminProjectAnalytics(props.projectId ? { id: props.projectId } : { slug: props.slug! }, { audit: true }).catch((e) => {
    console.warn(`[admin/analytics] project block: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })
  if (!data) return null
  const t = await getTranslations('admin.analytics.block')
  const { view, project } = data
  const href = `/analytics/${project.slug}`

  return (
    <section aria-labelledby="project-analytics" className="flex flex-col gap-3">
      <SectionHeading id="project-analytics" title={t('heading')} seeAllHref={href} seeAllLabel={t('open')} />
      <div>
        <StatusPill status={dataStatusOf(view)} />
      </div>
      {view.hasData ? (
        <StatGrid>
          {view.visitors ? (
            <StatTile
              label={t('visitors')}
              value={view.visitors.value}
              delta={view.visitors.change === null ? null : { percent: view.visitors.change, period: t('previousPeriod') }}
              trend={view.dailyVisitors.length > 1 ? <DailySparkline points={view.dailyVisitors} label={t('dailyVisitors')} /> : null}
              href={href}
            />
          ) : null}
          {view.searchClicks ? (
            <StatTile
              label={t('searchClicks')}
              value={view.searchClicks.value}
              delta={view.searchClicks.change === null ? null : { percent: view.searchClicks.change, period: t('previousPeriod') }}
              href={href}
            />
          ) : null}
        </StatGrid>
      ) : (
        <EmptyState compact titleAs="p" title={t('emptyTitle')} body={t('emptyBody')} />
      )}
    </section>
  )
}
