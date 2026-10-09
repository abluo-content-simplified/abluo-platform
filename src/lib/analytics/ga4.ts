/**
 * GA4 Data API adapter (ADR-029 §3.4). One `batchRunReports` call per project
 * and day, five reports (the API's maximum per batch):
 *   0. totals (activeUsers, sessions, screenPageViews) for the four windows
 *   1. top pages by screenPageViews (current window)
 *   2. sessions by default channel group × session source (current window) —
 *      the channel list, the referring websites and the AI assistants all
 *      come from this one report
 *   3. daily activeUsers over the previous + current window (trend chart)
 *   4. sessions by device category (current window)
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
export const TOP_REFERRERS = 10
/** Channel × source rows read: far more than a small site has, so the channel sums are exact in practice. */
export const SOURCE_ROWS = 250

/** GA4's default channel group for AI assistants (introduced 2025). */
export const AI_CHANNEL = 'AI Assistant'
const REFERRAL_CHANNEL = 'Referral'

/**
 * Assistant domains counted as AI even when GA4 still files them under
 * "Referral" (older properties, or assistants GA4 does not know yet).
 * Matched on the session source's host, suffix-wise.
 */
export const AI_ASSISTANT_DOMAINS = [
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'perplexity.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'claude.ai',
  'chat.mistral.ai',
  'chat.deepseek.com',
  'deepseek.com',
  'meta.ai',
  'grok.com',
  'you.com',
  'phind.com',
  'poe.com',
] as const

/** 'www.example.com' → 'example.com'; GA4 sources are hosts or names like "google" / "(direct)". */
export function sourceHost(source: string): string {
  return source.trim().toLowerCase().replace(/^www\./, '')
}

export function isAiSource(source: string): boolean {
  const h = sourceHost(source)
  return AI_ASSISTANT_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))
}

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
        dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: SOURCE_ROWS,
      },
      {
        dateRanges: [{ startDate: w.previous.start, endDate: w.current.end }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 100,
      },
      {
        dateRanges: current,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
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
  const [totals = {}, pages = {}, sources = {}, daily = {}, devices = {}] = json.reports ?? []

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

  // Channel × source → channels (summed), referring sites, AI assistants.
  // An assistant domain filed under "Referral" is counted as AI everywhere, so
  // the channel list and the AI list agree.
  const channelSessions = new Map<string, number>()
  const referrers = new Map<string, number>()
  const ai = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  for (const r of sources.rows ?? []) {
    const rawChannel = r.dimensionValues?.[0]?.value ?? ''
    const source = r.dimensionValues?.[1]?.value ?? ''
    const sessions = num(r.metricValues?.[0]?.value)
    if (!rawChannel) continue
    const aiHit = rawChannel === AI_CHANNEL || (source && isAiSource(source))
    const channel = aiHit ? AI_CHANNEL : rawChannel
    add(channelSessions, channel, sessions)
    if (aiHit && source && !source.startsWith('(')) add(ai, sourceHost(source), sessions)
    else if (channel === REFERRAL_CHANNEL && source && !source.startsWith('(')) add(referrers, sourceHost(source), sessions)
  }
  const ranked = <K extends string>(m: Map<string, number>, key: K, n: number) =>
    [...m.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([k, sessions]) => ({ [key]: k, sessions }) as Record<K, string> & { sessions: number })

  const allDays = new Map<string, number>()
  for (const row of daily.rows ?? []) {
    const d = gaDate(row.dimensionValues?.[0]?.value)
    if (d) allDays.set(d, num(row.metricValues?.[0]?.value))
  }

  return {
    ...byWindow,
    top_pages: (pages.rows ?? [])
      .map((r) => ({ path: r.dimensionValues?.[0]?.value ?? '', views: num(r.metricValues?.[0]?.value) }))
      .filter((p) => p.path)
      .slice(0, TOP_PAGES),
    top_channels: ranked(channelSessions, 'channel', TOP_CHANNELS),
    daily: daysOf(w.current).map((date) => ({ date, users: allDays.get(date) ?? 0 })),
    daily_previous: daysOf(w.previous).map((date) => ({ date, users: allDays.get(date) ?? 0 })),
    top_referrers: ranked(referrers, 'source', TOP_REFERRERS),
    ai_sources: ranked(ai, 'source', TOP_REFERRERS),
    devices: (devices.rows ?? [])
      .map((r) => ({ device: (r.dimensionValues?.[0]?.value ?? '').toLowerCase(), sessions: num(r.metricValues?.[0]?.value) }))
      .filter((d) => d.device && d.sessions > 0),
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
