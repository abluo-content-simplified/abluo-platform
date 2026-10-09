/**
 * Website analytics snapshots (ADR-029 §3.4, migration 036) — shared types.
 * Browser-safe: no I/O, no server imports.
 *
 * The JSON shapes below are what `analytics_snapshots.metrics` stores. Keys are
 * snake_case because they are database payload; keep them stable — a rename
 * needs a data migration (old rows keep the old shape).
 */

export type AnalyticsSource = 'ga4' | 'gsc'
export type SnapshotStatus = 'ok' | 'error' | 'not_connected'

/** An inclusive date range, ISO days (YYYY-MM-DD). */
export type DateWindow = { start: string; end: string }

/**
 * The four windows every snapshot is measured over, all ending yesterday
 * (UTC): the last 28 days and the 28 before, the last 7 days and the 7 before.
 */
export type SnapshotWindows = {
  current: DateWindow
  previous: DateWindow
  last7: DateWindow
  previous7: DateWindow
}

export type Ga4Totals = { users: number; sessions: number; page_views: number }

export type Ga4Metrics = {
  current: Ga4Totals
  previous: Ga4Totals
  last7: Ga4Totals
  previous7: Ga4Totals
  /** Most viewed pages in the current window (path as GA4 reports it). */
  top_pages: { path: string; views: number }[]
  /** Sessions by GA4 default channel group in the current window. */
  top_channels: { channel: string; sessions: number }[]
  /** Daily users in the current window, oldest first, every day present. */
  daily: { date: string; users: number }[]
  // ── Added 2026-10-09 (analytics v2). Optional: snapshots taken before that lack them. ──
  /** Daily users in the PREVIOUS window, oldest first, every day present (the trend chart's comparison line). */
  daily_previous?: { date: string; users: number }[]
  /** Other websites that sent visitors (GA4 channel "Referral"), by sessions, current window. */
  top_referrers?: { source: string; sessions: number }[]
  /** AI assistants that sent visitors (channel "AI Assistant" or a known assistant domain), current window. */
  ai_sources?: { source: string; sessions: number }[]
  /** Sessions by device category (desktop / mobile / tablet / smart tv), current window. */
  devices?: { device: string; sessions: number }[]
}

export type GscTotals = {
  clicks: number
  impressions: number
  /** 0..1 (clicks / impressions). */
  ctr: number
  /** Impression-weighted average position; 0 when there were no impressions. */
  position: number
}

export type GscMetrics = {
  current: GscTotals
  previous: GscTotals
  last7: GscTotals
  previous7: GscTotals
  /** Top searches by clicks (current window). `position` added 2026-10-09 (absent on older snapshots). */
  top_queries: { query: string; clicks: number; impressions: number; position?: number }[]
  /** Daily clicks/impressions in the current window, oldest first, every day present. */
  daily: { date: string; clicks: number; impressions: number }[]
  // ── Added 2026-10-09 (analytics v2). Optional: snapshots taken before that lack them. ──
  /** Daily clicks/impressions in the PREVIOUS window (the trend chart's comparison line). */
  daily_previous?: { date: string; clicks: number; impressions: number }[]
  /** Searches the site is shown for often but rarely clicked (see gsc.ts `pickOpportunities`). */
  opportunities?: { query: string; clicks: number; impressions: number; position: number }[]
}

/** One `analytics_snapshots` row as written / read. */
export type SnapshotRow = {
  project_id: string
  source: AnalyticsSource
  period_start: string
  period_end: string
  status: SnapshotStatus
  metrics: Ga4Metrics | GscMetrics | Record<string, never>
  error: string | null
  fetched_at: string
}

/** What the snapshot job needs to know about one project. */
export type AnalyticsProjectConfig = {
  projectId: string
  /** Supabase `projects.slug` = Sanity `project.projectSlug`. */
  slug: string
  ga4PropertyId: string | null
  gscSiteUrl: string | null
}
