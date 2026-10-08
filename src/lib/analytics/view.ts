/**
 * Snapshot rows → what the analytics widgets show (client dashboard and admin
 * alike). Pure and browser-safe. The widgets never see a raw row.
 */
import { percentChange } from '@/lib/client/home-cards'
import { STALE_AFTER_MS } from './periods'
import type { AnalyticsSource, Ga4Metrics, GscMetrics, SnapshotRow } from './types'

/** connected = latest snapshot ok · error = latest failed · not_connected = no ID configured · missing = no snapshot yet. */
export type SourceState = 'connected' | 'not_connected' | 'error' | 'missing'

export type MetricValue = { value: number; previous: number | null; change: number | null }

export type ProjectAnalyticsView = {
  ga4: SourceState
  gsc: SourceState
  /** True when there is something to show (at least one source has had a good snapshot). */
  hasData: boolean
  /** The newest good snapshot is older than two days. */
  stale: boolean
  /** When the newest snapshot (good or not) was taken. */
  fetchedAt: string | null
  /** Last day of the window shown. */
  periodEnd: string | null
  visitors: MetricValue | null
  visitors7: MetricValue | null
  pageViews: MetricValue | null
  sessions: MetricValue | null
  searchClicks: MetricValue | null
  searchClicks7: MetricValue | null
  impressions: MetricValue | null
  /** Lower is better. Null when there were no impressions. */
  position: MetricValue | null
  dailyVisitors: { date: string; value: number }[]
  topPages: { label: string; value: number }[]
  topChannels: { label: string; value: number }[]
  topQueries: { label: string; value: number }[]
  /** Latest error per source (admin only shows these). */
  errors: { source: AnalyticsSource; message: string }[]
}

/** The latest row and the latest GOOD row of one source. */
export type SourceRows = { latest: SnapshotRow | null; latestOk: SnapshotRow | null }

/** Pick latest / latest-ok per source from rows of ONE project (any order). Pure. */
export function pickSourceRows(rows: readonly SnapshotRow[]): Record<AnalyticsSource, SourceRows> {
  const pick = (source: AnalyticsSource): SourceRows => {
    const mine = rows.filter((r) => r.source === source).sort((a, b) => (a.period_end < b.period_end ? 1 : a.period_end > b.period_end ? -1 : b.fetched_at.localeCompare(a.fetched_at)))
    return { latest: mine[0] ?? null, latestOk: mine.find((r) => r.status === 'ok') ?? null }
  }
  return { ga4: pick('ga4'), gsc: pick('gsc') }
}

const metric = (value: number, previous: number): MetricValue => ({ value, previous, change: percentChange(value, previous) })

function stateOf(r: SourceRows): SourceState {
  if (!r.latest) return 'missing'
  if (r.latest.status === 'ok') return 'connected'
  return r.latest.status === 'error' ? 'error' : 'not_connected'
}

export function projectAnalyticsView(rows: readonly SnapshotRow[], now: number = Date.now()): ProjectAnalyticsView {
  const { ga4, gsc } = pickSourceRows(rows)
  const g = ga4.latestOk?.metrics as Ga4Metrics | undefined
  const s = gsc.latestOk?.metrics as GscMetrics | undefined
  const okDates = [ga4.latestOk?.fetched_at, gsc.latestOk?.fetched_at].filter((d): d is string => Boolean(d)).sort()
  const anyDates = [ga4.latest?.fetched_at, gsc.latest?.fetched_at].filter((d): d is string => Boolean(d)).sort()
  const newestOk = okDates.at(-1) ?? null
  const ends = [ga4.latestOk?.period_end, gsc.latestOk?.period_end].filter((d): d is string => Boolean(d)).sort()

  return {
    ga4: stateOf(ga4),
    gsc: stateOf(gsc),
    hasData: Boolean(g?.current || s?.current),
    stale: newestOk ? now - Date.parse(newestOk) > STALE_AFTER_MS : false,
    fetchedAt: anyDates.at(-1) ?? null,
    periodEnd: ends.at(-1) ?? null,
    visitors: g?.current ? metric(g.current.users, g.previous?.users ?? 0) : null,
    visitors7: g?.last7 ? metric(g.last7.users, g.previous7?.users ?? 0) : null,
    pageViews: g?.current ? metric(g.current.page_views, g.previous?.page_views ?? 0) : null,
    sessions: g?.current ? metric(g.current.sessions, g.previous?.sessions ?? 0) : null,
    searchClicks: s?.current ? metric(s.current.clicks, s.previous?.clicks ?? 0) : null,
    searchClicks7: s?.last7 ? metric(s.last7.clicks, s.previous7?.clicks ?? 0) : null,
    impressions: s?.current ? metric(s.current.impressions, s.previous?.impressions ?? 0) : null,
    position:
      s?.current && s.current.impressions > 0
        ? {
            value: s.current.position,
            previous: s.previous?.impressions ? s.previous.position : null,
            change: s.previous?.impressions ? percentChange(s.current.position, s.previous.position) : null,
          }
        : null,
    dailyVisitors: (g?.daily ?? []).map((d) => ({ date: d.date, value: d.users })),
    topPages: (g?.top_pages ?? []).map((p) => ({ label: p.path, value: p.views })),
    topChannels: (g?.top_channels ?? []).map((c) => ({ label: c.channel, value: c.sessions })),
    topQueries: (s?.top_queries ?? []).map((q) => ({ label: q.query, value: q.clicks })),
    errors: [ga4.latest, gsc.latest].filter((r): r is SnapshotRow => r?.status === 'error').map((r) => ({ source: r.source, message: r.error ?? '' })),
  }
}

// ── Admin portfolio ─────────────────────────────────────────────────────────

/** One status per site for the admin list. */
export type DataStatus = 'connected' | 'not_connected' | 'error' | 'stale'

export function dataStatusOf(v: ProjectAnalyticsView): DataStatus {
  if (v.ga4 === 'error' || v.gsc === 'error') return 'error'
  if (!v.hasData) return 'not_connected'
  return v.stale ? 'stale' : 'connected'
}

export type PortfolioRow = {
  projectId: string
  slug: string
  name: string
  status: DataStatus
  /** Which sources are configured (as of the latest snapshot). */
  ga4: SourceState
  gsc: SourceState
  visitors7: number | null
  visitors28: number | null
  /** % change of 28-day visitors vs the 28 days before. */
  trend: number | null
  searchClicks28: number | null
  topChannel: string | null
  requests28: number | null
  dailyVisitors: number[]
}

export function portfolioRow(
  project: { id: string; slug: string; name: string },
  rows: readonly SnapshotRow[],
  requests28: number | null,
  now: number = Date.now(),
): PortfolioRow {
  const v = projectAnalyticsView(rows, now)
  return {
    projectId: project.id,
    slug: project.slug,
    name: project.name,
    status: dataStatusOf(v),
    ga4: v.ga4,
    gsc: v.gsc,
    visitors7: v.visitors7?.value ?? null,
    visitors28: v.visitors?.value ?? null,
    trend: v.visitors?.change ?? null,
    searchClicks28: v.searchClicks?.value ?? null,
    topChannel: v.topChannels[0]?.label ?? null,
    requests28,
    dailyVisitors: v.dailyVisitors.map((d) => d.value),
  }
}

export type PortfolioSummary = {
  visitors: MetricValue
  sites: number
  connected: number
  notConnected: number
  erroring: number
  stale: number
  /** Biggest relative movers among sites with a measurable change, max 3 each. */
  risers: { slug: string; name: string; change: number; visitors: number }[]
  fallers: { slug: string; name: string; change: number; visitors: number }[]
}

/** Totals across sites: only sites with GA4 data count toward visitors. Pure. */
export function portfolioSummary(rows: readonly PortfolioRow[], perSite: ReadonlyMap<string, ProjectAnalyticsView>): PortfolioSummary {
  let value = 0
  let previous = 0
  for (const r of rows) {
    const v = perSite.get(r.projectId)
    if (v?.visitors) {
      value += v.visitors.value
      previous += v.visitors.previous ?? 0
    }
  }
  const movers = rows
    .filter((r): r is PortfolioRow & { trend: number; visitors28: number } => r.trend !== null && r.visitors28 !== null)
    .map((r) => ({ slug: r.slug, name: r.name, change: r.trend, visitors: r.visitors28 }))
  return {
    visitors: metric(value, previous),
    sites: rows.length,
    connected: rows.filter((r) => r.status === 'connected').length,
    notConnected: rows.filter((r) => r.status === 'not_connected').length,
    erroring: rows.filter((r) => r.status === 'error').length,
    stale: rows.filter((r) => r.status === 'stale').length,
    risers: movers.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    fallers: movers.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 3),
  }
}
