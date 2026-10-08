/**
 * Search Console API adapter (ADR-029 §3.4). Two `searchAnalytics.query`
 * calls per project and day:
 *   1. by date over the previous + current 28 days — all four windows'
 *      totals are summed from it (clicks/impressions add up; CTR and the
 *      impression-weighted position are derived, the way Search Console does)
 *   2. top queries by clicks (current window)
 *
 * `dataState: 'all'` includes the fresh (not yet final) last days, so the
 * window really ends yesterday. Pure mappers, tested on fixture JSON.
 */
import { googleErrorMessage } from './google-auth'
import { daysOf, inWindow } from './periods'
import type { DateWindow, GscMetrics, GscTotals, SnapshotWindows } from './types'

export const GSC_API = 'https://searchconsole.googleapis.com/webmasters/v3'
export const TOP_QUERIES = 10

export type GscRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }
export type GscResponse = { rows?: GscRow[] }

export function gscDailyRequest(w: SnapshotWindows) {
  return { startDate: w.previous.start, endDate: w.current.end, dimensions: ['date'], rowLimit: 100, dataState: 'all' }
}

export function gscQueriesRequest(w: SnapshotWindows) {
  return { startDate: w.current.start, endDate: w.current.end, dimensions: ['query'], rowLimit: TOP_QUERIES, dataState: 'all' }
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Totals of the daily rows inside `w`. Pure. */
export function gscTotals(rows: readonly GscRow[], w: DateWindow): GscTotals {
  let clicks = 0
  let impressions = 0
  let weighted = 0
  for (const r of rows) {
    const day = r.keys?.[0]
    if (!day || !inWindow(day, w)) continue
    clicks += n(r.clicks)
    impressions += n(r.impressions)
    weighted += n(r.position) * n(r.impressions)
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? Math.round((weighted / impressions) * 10) / 10 : 0,
  }
}

export function mapGsc(daily: GscResponse, queries: GscResponse, w: SnapshotWindows): GscMetrics {
  const rows = daily.rows ?? []
  const byDay = new Map(rows.filter((r) => r.keys?.[0]).map((r) => [r.keys![0], r]))
  return {
    current: gscTotals(rows, w.current),
    previous: gscTotals(rows, w.previous),
    last7: gscTotals(rows, w.last7),
    previous7: gscTotals(rows, w.previous7),
    top_queries: (queries.rows ?? [])
      .map((r) => ({ query: r.keys?.[0] ?? '', clicks: n(r.clicks), impressions: n(r.impressions) }))
      .filter((q) => q.query)
      .slice(0, TOP_QUERIES),
    daily: daysOf(w.current).map((date) => ({ date, clicks: n(byDay.get(date)?.clicks), impressions: n(byDay.get(date)?.impressions) })),
  }
}

/** The network calls. `siteUrl` is the property exactly as named in Search Console. */
export async function fetchGscMetrics(
  siteUrl: string,
  w: SnapshotWindows,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GscMetrics> {
  const url = `${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`
  const call = async (body: object): Promise<GscResponse> => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await googleErrorMessage(res, 'Search Console'))
    return (await res.json()) as GscResponse
  }
  const [daily, queries] = await Promise.all([call(gscDailyRequest(w)), call(gscQueriesRequest(w))])
  return mapGsc(daily, queries, w)
}
