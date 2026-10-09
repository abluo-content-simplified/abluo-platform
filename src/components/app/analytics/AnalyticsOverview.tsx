import { useFormatter, useTranslations } from 'next-intl'
import { RankedList } from '@/components/app/ui/RankedList'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Sparkline } from '@/components/app/ui/Sparkline'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { TrendChart } from '@/components/app/ui/TrendChart'
import type { RequestStats } from '@/lib/analytics/request-stats'
import type { MetricValue, ProjectAnalyticsView } from '@/lib/analytics/view'
import { UpdatedNote } from './UpdatedNote'

/**
 * The analytics widgets for ONE site (ADR-029 §3.4) — the same composition on
 * the client's Analytics page and on the admin's site page (ADR-030: "clicking
 * a site shows the same widgets the client sees"), so it lives in the shared
 * layer and reads only `app.analytics` copy. Presentational: it gets a
 * finished `ProjectAnalyticsView` (stored snapshot, never a live Google call).
 *
 * Render it only when `view.hasData`; the page decides what "nothing yet"
 * says to its own reader.
 *
 * Analytics v2 (Tom 2026-10-09): trend charts (this 28 days vs the 28 before),
 * top 10 Google searches, searches to work on, referring websites, AI
 * assistants, phone vs computer, and contact requests (our own data — passed
 * in as `requests`, null when the reader may not see them). Lists a snapshot
 * does not have yet (taken before v2, or simply empty) are left out.
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

export function AnalyticsOverview({ view, requests = null }: { view: ProjectAnalyticsView; requests?: RequestStats | null }) {
  const t = useTranslations('app.analytics')
  const format = useFormatter()
  const delta = useDelta()

  const channel = (raw: string) => {
    const key = CHANNEL_KEY(raw)
    return t.has(`channels.${key}`) ? t(`channels.${key}` as 'channels.direct') : raw
  }
  const device = (raw: string) => (t.has(`devices.${raw.replace(/\s+/g, '')}`) ? t(`devices.${raw.replace(/\s+/g, '')}` as 'devices.desktop') : raw)
  const until = view.periodEnd ? format.dateTime(new Date(`${view.periodEnd}T12:00:00Z`), { day: 'numeric', month: 'long', timeZone: 'UTC' }) : null
  const percent = (share: number) => format.number(share, { style: 'percent', maximumFractionDigits: 0 })

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
    requests ? (
      <StatTile
        key="requests"
        label={t('requests')}
        value={requests.current}
        delta={requests.change === null ? null : { percent: requests.change, period: t('previousPeriod') }}
      />
    ) : null,
  ].filter(Boolean)

  const chartLabels = { current: t('chart.current'), previous: t('chart.previous'), date: t('chart.date') }
  const charts = [
    view.dailyVisitors.length > 1 ? { id: 'visitors', title: t('chart.visitors'), current: view.dailyVisitors, previous: view.dailyVisitorsPrevious } : null,
    view.searchClicks && view.dailyClicks.length > 1 ? { id: 'clicks', title: t('chart.clicks'), current: view.dailyClicks, previous: view.dailyClicksPrevious } : null,
    requests && requests.current + requests.previous > 0 ? { id: 'requests', title: t('chart.requests'), current: requests.daily, previous: requests.dailyPrevious } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null)

  type List = { id: string; title: string; hint?: string; items: { label: string; value: number; detail?: string }[]; max?: number }
  const lists = ([
    view.topPages.length ? { id: 'top-pages', title: t('topPages'), items: view.topPages } : null,
    view.topChannels.length ? { id: 'top-channels', title: t('topChannels'), items: view.topChannels.map((c) => ({ ...c, label: channel(c.label) })) } : null,
    view.topQueries.length ? { id: 'top-queries', title: t('topQueries'), hint: t('topQueriesHint'), items: view.topQueries, max: 10 } : null,
    view.opportunities.length
      ? {
          id: 'opportunities',
          title: t('opportunities'),
          hint: t('opportunitiesHint'),
          items: view.opportunities.map((o) => ({ label: o.label, value: o.value, detail: t('positionShort', { position: format.number(o.position, { maximumFractionDigits: 1 }) }) })),
        }
      : null,
    view.topReferrers.length ? { id: 'referrers', title: t('referrers'), hint: t('referrersHint'), items: view.topReferrers } : null,
    view.aiSources.length ? { id: 'ai', title: t('aiSources'), hint: t('aiSourcesHint'), items: view.aiSources } : null,
    view.devices.length ? { id: 'devices', title: t('devices.title'), items: view.devices.map((d) => ({ label: device(d.label), value: d.value, detail: percent(d.share) })) } : null,
    requests?.topPages.length ? { id: 'request-pages', title: t('requestPages'), hint: t('requestPagesHint'), items: requests.topPages } : null,
  ] as (List | null)[]).filter((l): l is List => l !== null)

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-1">
        {until ? <p className="text-sm leading-5 text-muted-foreground">{t('window', { days: 28, until })}</p> : null}
        {view.fetchedAt ? <UpdatedNote iso={view.fetchedAt} stale={view.stale} /> : null}
        {view.gsc !== 'connected' && !view.searchClicks ? <p className="text-sm leading-5 text-muted-foreground">{t('searchNotConnected')}</p> : null}
        {view.ga4 !== 'connected' && !view.visitors ? <p className="text-sm leading-5 text-muted-foreground">{t('trafficNotConnected')}</p> : null}
      </div>

      {tiles.length ? <StatGrid label={t('summary')}>{tiles}</StatGrid> : null}

      {charts.length ? (
        <section aria-labelledby="analytics-trends" className="flex flex-col gap-3">
          <SectionHeading id="analytics-trends" title={t('chart.heading')} />
          <div className={`grid grid-cols-1 gap-4 ${charts.length > 1 ? 'lg:grid-cols-2' : ''}`}>
            {charts.map((c) => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                <TrendChart title={c.title} current={c.current} previous={c.previous} labels={chartLabels} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {lists.length ? (
        <div className="grid grid-cols-1 items-start gap-7 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {lists.map((l) => (
            <section key={l.id} aria-labelledby={l.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-1">
                <SectionHeading id={l.id} title={l.title} />
                {l.hint ? <p className="text-xs leading-4 text-muted-foreground">{l.hint}</p> : null}
              </div>
              <RankedList label={l.title} items={l.items} max={l.max ?? 8} />
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
