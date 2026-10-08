import { useFormatter, useTranslations } from 'next-intl'
import { RankedList } from '@/components/app/ui/RankedList'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Sparkline } from '@/components/app/ui/Sparkline'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import type { MetricValue, ProjectAnalyticsView } from '@/lib/analytics/view'

/**
 * The analytics widgets for ONE site (ADR-029 §3.4) — the same composition on
 * the client's Analytics page and on the admin's site page (ADR-030: "clicking
 * a site shows the same widgets the client sees"), so it lives in the shared
 * layer and reads only `app.analytics` copy. Presentational: it gets a
 * finished `ProjectAnalyticsView` (stored snapshot, never a live Google call).
 *
 * Render it only when `view.hasData`; the page decides what "nothing yet"
 * says to its own reader.
 */

const CHANNEL_KEY = (channel: string) =>
  channel
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))

export function useDelta() {
  const t = useTranslations('app.analytics')
  return (m: MetricValue | null | undefined, period: string = t('previousPeriod'), goodWhen: 'up' | 'down' = 'up') =>
    m && m.change !== null ? { percent: m.change, period, goodWhen } : null
}

export function DailySparkline({ points, label }: { points: { date: string; value: number }[]; label: string }) {
  const format = useFormatter()
  return (
    <Sparkline
      values={points.map((p) => p.value)}
      labels={points.map((p) => `${format.dateTime(new Date(`${p.date}T12:00:00Z`), { day: 'numeric', month: 'short' })} · ${format.number(p.value)}`)}
      label={label}
    />
  )
}

export function AnalyticsOverview({ view }: { view: ProjectAnalyticsView }) {
  const t = useTranslations('app.analytics')
  const format = useFormatter()
  const delta = useDelta()

  const channel = (raw: string) => {
    const key = CHANNEL_KEY(raw)
    return t.has(`channels.${key}`) ? t(`channels.${key}` as 'channels.direct') : raw
  }
  const until = view.periodEnd ? format.dateTime(new Date(`${view.periodEnd}T12:00:00Z`), { day: 'numeric', month: 'long' }) : null
  const updated = view.fetchedAt ? format.dateTime(new Date(view.fetchedAt), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null

  const tiles = [
    view.visitors ? (
      <StatTile
        key="visitors"
        label={t('visitors')}
        value={view.visitors.value}
        delta={delta(view.visitors)}
        trend={view.dailyVisitors.length > 1 ? <DailySparkline points={view.dailyVisitors} label={t('dailyVisitors')} /> : null}
      />
    ) : null,
    view.pageViews ? <StatTile key="views" label={t('pageViews')} value={view.pageViews.value} delta={delta(view.pageViews)} /> : null,
    view.searchClicks ? (
      <StatTile key="clicks" label={t('searchClicks')} value={view.searchClicks.value} delta={delta(view.searchClicks)} sub={view.impressions ? t('impressions', { count: view.impressions.value }) : null} />
    ) : null,
    view.position ? (
      <StatTile key="position" label={t('position')} value={view.position.value} delta={delta(view.position, undefined, 'down')} sub={t('positionHint')} />
    ) : null,
  ].filter(Boolean)

  const lists = [
    view.topPages.length ? { id: 'top-pages', title: t('topPages'), items: view.topPages } : null,
    view.topChannels.length ? { id: 'top-channels', title: t('topChannels'), items: view.topChannels.map((c) => ({ ...c, label: channel(c.label) })) } : null,
    view.topQueries.length ? { id: 'top-queries', title: t('topQueries'), items: view.topQueries } : null,
  ].filter((l): l is NonNullable<typeof l> => l !== null)

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-1">
        {until ? <p className="text-sm leading-5 text-muted-foreground">{t('window', { days: 28, until })}</p> : null}
        {updated ? (
          <p className={`text-sm leading-5 ${view.stale ? 'text-destructive' : 'text-muted-foreground'}`}>
            {view.stale ? t('staleNote', { when: updated }) : t('updated', { when: updated })}
          </p>
        ) : null}
        {view.gsc !== 'connected' && !view.searchClicks ? <p className="text-sm leading-5 text-muted-foreground">{t('searchNotConnected')}</p> : null}
        {view.ga4 !== 'connected' && !view.visitors ? <p className="text-sm leading-5 text-muted-foreground">{t('trafficNotConnected')}</p> : null}
      </div>

      {tiles.length ? <StatGrid label={t('summary')}>{tiles}</StatGrid> : null}

      {lists.length ? (
        <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-3 lg:gap-6">
          {lists.map((l) => (
            <section key={l.id} aria-labelledby={l.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <SectionHeading id={l.id} title={l.title} />
              <RankedList label={l.title} items={l.items} max={8} />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
