import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { getAdminPortfolio } from '@/lib/admin/analytics'
import { TrendText } from './PortfolioBrowser'

/**
 * Admin Home block (ADR-030 §5.2): traffic across every site at a glance —
 * total visitors (28 days) vs the 28 before, the three biggest risers and
 * fallers, and how many sites are not connected / erroring / stale.
 *
 * Server component, self-contained: calls requireAbluoAdmin() (via
 * getAdminPortfolio) and renders nothing when refused. Reads stored snapshots
 * only. Records `analytics.portfolio.view` in the admin audit log.
 *
 * Wiring: `{/* ANALYTICS_SUMMARY_SLOT *\/}` on (admin)/dashboard →
 *   <AdminAnalyticsSummary />
 */
export async function AdminAnalyticsSummary() {
  const portfolio = await getAdminPortfolio({ audit: true }).catch((e) => {
    console.warn(`[admin/analytics] summary: ${e instanceof Error ? e.message : String(e)}`)
    return null
  })
  if (!portfolio) return null
  const t = await getTranslations('admin.analytics.summary')
  const s = portfolio.summary
  const hasTraffic = s.visitors.value > 0 || (s.visitors.previous ?? 0) > 0

  const movers = (title: string, id: string, items: typeof s.risers) =>
    items.length ? (
      <section aria-labelledby={id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <h3 id={id} className="text-sm leading-5 font-semibold text-foreground">
          {title}
        </h3>
        <ul className="flex flex-col">
          {items.map((m) => (
            <li key={m.slug}>
              <Link
                href={`/analytics/${m.slug}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-md text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="min-w-0 truncate text-foreground">{m.name}</span>
                <TrendText percent={m.change} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    ) : null

  return (
    <section aria-labelledby="admin-analytics-summary" className="flex flex-col gap-3">
      <SectionHeading id="admin-analytics-summary" title={t('heading')} seeAllHref="/analytics" />
      {!portfolio.ready || s.sites === 0 || (!hasTraffic && s.connected === 0) ? (
        <EmptyState compact titleAs="p" title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <StatGrid>
            <StatTile
              label={t('visitors')}
              value={s.visitors.value}
              delta={s.visitors.change === null ? null : { percent: s.visitors.change, period: t('previousPeriod') }}
              sub={t('acrossSites', { count: s.connected + s.stale })}
              href="/analytics"
            />
            <StatTile label={t('notConnected')} value={s.notConnected} sub={t('ofSites', { count: s.sites })} href="/analytics" />
            <StatTile label={t('erroring')} value={s.erroring} sub={s.stale ? t('stale', { count: s.stale }) : null} href="/analytics" />
          </StatGrid>
          {s.risers.length || s.fallers.length ? (
            <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
              {movers(t('risers'), 'analytics-risers', s.risers)}
              {movers(t('fallers'), 'analytics-fallers', s.fallers)}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
