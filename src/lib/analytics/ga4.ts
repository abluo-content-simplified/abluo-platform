/**
 * GA4 Data API adapter (ADR-029 §3.4). One `batchRunReports` call per project
 * and day, four reports:
 *   0. totals (activeUsers, sessions, screenPageViews) for the four windows
 *   1. top pages by screenPageViews (current window)
 *   2. sessions by default channel group (current window)
 *   3. daily activeUsers (current window)
 *
 * "Visitors" = GA4 `activeUsers` — the number GA4's own reports call "Users".
 * The request builder and the response mapper are pure and tested on fixture
 * JSON; `fetchGa4Metrics` is the only I/O.
 */
import { googleErrorMessage } from './google-auth'
import { daysOf } from './periods'
import type { Ga4Metrics, Ga4Totals, SnapshotWindows } from './types'

export const GA4_API = 'https://analyticsdata.googleapis.com/v1beta'
export const TOP_PAGES = 10
export const TOP_CHANNELS = 6

const WINDOW_NAMES = ['current', 'previous', 'last7', 'previous7'] as const

export function ga4BatchRequest(w: SnapshotWindows) {
  const current = [{ startDate: w.current.start, endDate: w.current.end }]
  return {
    requests: [
      {
        dateRanges: WINDOW_NAMES.map((name) => ({ startDate: w[name].start, endDate: w[name].end, name })),
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
      },
      {
        dateRanges: current,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: TOP_PAGES,
      },
      {
        dateRanges: current,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: TOP_CHANNELS,
      },
      {
        dateRanges: current,
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 100,
      },
    ],
  }
}

type Ga4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }
type Ga4Report = { dimensionHeaders?: { name?: string }[]; metricHeaders?: { name?: string }[]; rows?: Ga4Row[] }
export type Ga4BatchResponse = { reports?: Ga4Report[] }

const num = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function metricIndex(report: Ga4Report, name: string, fallback: number): number {
  const i = (report.metricHeaders ?? []).findIndex((h) => h.name === name)
  return i === -1 ? fallback : i
}

/** GA4 'YYYYMMDD' → 'YYYY-MM-DD'. */
function gaDate(v: string | undefined): string {
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : ''
}

/** Response → metrics. Missing rows (GA4 omits all-zero rows) count as 0. Pure. */
export function mapGa4Batch(json: Ga4BatchResponse, w: SnapshotWindows): Ga4Metrics {
  const [totals = {}, pages = {}, channels = {}, daily = {}] = json.reports ?? []

  const zero = (): Ga4Totals => ({ users: 0, sessions: 0, page_views: 0 })
  const byWindow: Record<(typeof WINDOW_NAMES)[number], Ga4Totals> = {
    current: zero(),
    previous: zero(),
    last7: zero(),
    previous7: zero(),
  }
  const rangeDim = (totals.dimensionHeaders ?? []).findIndex((h) => h.name === 'dateRange')
  const iu = metricIndex(totals, 'activeUsers', 0)
  const is = metricIndex(totals, 'sessions', 1)
  const ipv = metricIndex(totals, 'screenPageViews', 2)
  for (const row of totals.rows ?? []) {
    const name = row.dimensionValues?.[rangeDim === -1 ? 0 : rangeDim]?.value
    // Unnamed ranges come back as date_range_0 … date_range_3, in request order.
    const key = (WINDOW_NAMES as readonly string[]).includes(name ?? '')
      ? (name as (typeof WINDOW_NAMES)[number])
      : WINDOW_NAMES[Number(/^date_range_(\d)$/.exec(name ?? '')?.[1] ?? -1)]
    if (!key) continue
    byWindow[key] = {
      users: num(row.metricValues?.[iu]?.value),
      sessions: num(row.metricValues?.[is]?.value),
      page_views: num(row.metricValues?.[ipv]?.value),
    }
  }

  const usersByDay = new Map<string, number>()
  for (const row of daily.rows ?? []) {
    const d = gaDate(row.dimensionValues?.[0]?.value)
    if (d) usersByDay.set(d, num(row.metricValues?.[0]?.value))
  }

  return {
    ...byWindow,
    top_pages: (pages.rows ?? [])
      .map((r) => ({ path: r.dimensionValues?.[0]?.value ?? '', views: num(r.metricValues?.[0]?.value) }))
      .filter((p) => p.path)
      .slice(0, TOP_PAGES),
    top_channels: (channels.rows ?? [])
      .map((r) => ({ channel: r.dimensionValues?.[0]?.value ?? '', sessions: num(r.metricValues?.[0]?.value) }))
      .filter((c) => c.channel)
      .slice(0, TOP_CHANNELS),
    daily: daysOf(w.current).map((date) => ({ date, users: usersByDay.get(date) ?? 0 })),
  }
}

/** The one network call. Throws with Google's message on a refusal (e.g. 403 when the service account is not a Viewer). */
export async function fetchGa4Metrics(
  propertyId: string,
  w: SnapshotWindows,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Ga4Metrics> {
  if (!/^\d+$/.test(propertyId)) throw new Error(`GA4 property ID "${propertyId}" is not numeric`)
  const res = await fetchImpl(`${GA4_API}/properties/${propertyId}:batchRunReports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(ga4BatchRequest(w)),
  })
  if (!res.ok) throw new Error(await googleErrorMessage(res, 'GA4'))
  return mapGa4Batch((await res.json()) as Ga4BatchResponse, w)
}
