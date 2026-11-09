// Server-only: service role; never import from a client component.
// ── Digital Cards — the statistics store (Supabase digital_card_daily, migration 068) ──
//
// The ONLY code that talks to the digital-card statistics (ADR-049 D11). It
// calls the three service-role functions of migration 068 and nothing else:
//   recordHit() → digital_card_hit     (the hit endpoint, POST /api/cards/hit)
//   readStats() → digital_card_stats   (the dashboard, behind digital-cards.stats.read)
//   sweep()     → digital_card_sweep   (the daily cron, 13-month retention)
//
// Authorisation is the caller's job: the dashboard runs
// assertModuleAction(ctx, projectId, DIGITAL_CARD_PERMISSIONS.statsRead) and
// passes the project slug FROM THE GRANT; the hit endpoint checks the card and
// link against published Sanity data (DIGITAL_CARD_KNOWN_IDS_QUERY), the host,
// bots and the rate limit before calling recordHit().
//
// "Function missing" (migration 068 not applied yet) is a normal state:
// recordHit() answers false, readStats() { available: false }, sweep() null —
// never an exception, so the cards keep working.

import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { DIGITAL_CARD_DIRECT_SOURCE, DIGITAL_CARD_SOURCE_PATTERN, type DigitalCardHitKind } from '@/lib/modules/digital-cards/model'

const REASON = 'ADR-049 Digital Cards: server-only aggregate visit statistics (migration 068)'

export const DIGITAL_CARD_STATS_MAX_DAYS = 400

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const CARD_RE = /^[A-Za-z0-9-]{1,64}$/
const LINK_RE = /^[A-Za-z0-9_-]{1,64}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export interface DigitalCardHit {
  /** Sanity projectSlug. */
  projectSlug: string
  /** digitalCard.publicId. */
  cardId: string
  kind: DigitalCardHitKind
  /** digitalCard.links[]._key — required for a click, ignored for a visit. */
  linkKey?: string | null
  /** Already normalised (normalizeSource); anything else is stored as 'direct'. */
  source?: string | null
}

export interface DigitalCardStatsQuery {
  projectSlug: string
  /** null / undefined = every card of the project. */
  cardId?: string | null
  /** Inclusive, YYYY-MM-DD (Europe/Rome days — see statsRange). */
  from: string
  to: string
}

export interface DigitalCardCounts {
  visits: number
  clicks: number
}

export interface DigitalCardStats {
  totals: DigitalCardCounts
  /** Per card, most visits first. */
  cards: Array<{ cardId: string } & DigitalCardCounts>
  /** Per link (clicks only), most clicks first. */
  links: Array<{ cardId: string; linkKey: string; clicks: number }>
  /** Per source, most visits first. */
  sources: Array<{ source: string } & DigitalCardCounts>
  /** Per day with data, oldest first (days without data are absent — fill in the chart). */
  days: Array<{ day: string } & DigitalCardCounts>
}

export type DigitalCardStatsRead = { available: false } | { available: true; stats: DigitalCardStats }

export interface DigitalCardStatsStore {
  /** Counts one visit or click. true = counted; false = not configured, migration missing, or invalid input. Never throws. */
  recordHit(hit: DigitalCardHit): Promise<boolean>
  /** Aggregated statistics. Throws DigitalCardStatsError('invalid') on a bad query, ('failed') on a database error. */
  readStats(query: DigitalCardStatsQuery): Promise<DigitalCardStatsRead>
  /** Deletes rows older than 13 months; the number deleted, or null when unavailable. */
  sweep(): Promise<number | null>
}

export class DigitalCardStatsError extends Error {
  constructor(
    public readonly code: 'invalid' | 'failed',
    message: string,
  ) {
    super(message)
    this.name = 'DigitalCardStatsError'
  }
}

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }
export type DigitalCardStatsDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> }

/** PostgREST PGRST202 / Postgres 42883 / 42P01: migration 068 not applied. */
export function isMissingDigitalCardStats(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || error.code === 'PGRST205') return true
  const m = error.message ?? ''
  return /could not find the function .*digital_card_/i.test(m) || /digital_card_\w+.* does not exist/i.test(m)
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])

/** The jsonb of digital_card_stats → typed, tolerant of missing parts. */
export function parseDigitalCardStats(data: unknown): DigitalCardStats {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const totals = d.totals && typeof d.totals === 'object' ? (d.totals as Record<string, unknown>) : {}
  return {
    totals: { visits: num(totals.visits), clicks: num(totals.clicks) },
    cards: list(d.cards).map((r) => ({ cardId: str(r.cardId), visits: num(r.visits), clicks: num(r.clicks) })),
    links: list(d.links).map((r) => ({ cardId: str(r.cardId), linkKey: str(r.linkKey), clicks: num(r.clicks) })),
    sources: list(d.sources).map((r) => ({ source: str(r.source), visits: num(r.visits), clicks: num(r.clicks) })),
    days: list(d.days).map((r) => ({ day: str(r.day), visits: num(r.visits), clicks: num(r.clicks) })),
  }
}

/** Click-through rate in percent (clicks / visits), 0 when there are no visits. */
export function clickThroughRate(c: DigitalCardCounts): number {
  return c.visits > 0 ? Math.round((c.clicks / c.visits) * 1000) / 10 : 0
}

/** The day (YYYY-MM-DD) of an instant in the time zone the database counts in (Europe/Rome). */
export function statsDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** The last `days` days including today (Europe/Rome), for the 7 / 30 / 90 / 365 ranges. */
export function statsRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const n = Math.max(1, Math.min(DIGITAL_CARD_STATS_MAX_DAYS, Math.floor(days)))
  const to = statsDay(now)
  const [y, m, d] = to.split('-').map(Number)
  const from = new Date(Date.UTC(y, m - 1, d - (n - 1))).toISOString().slice(0, 10)
  return { from, to }
}

function validQuery(q: DigitalCardStatsQuery): boolean {
  if (!q || !PROJECT_RE.test(q.projectSlug ?? '')) return false
  if (q.cardId != null && !CARD_RE.test(q.cardId)) return false
  if (!DAY_RE.test(q.from ?? '') || !DAY_RE.test(q.to ?? '')) return false
  const span = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000
  return Number.isFinite(span) && span >= 0 && span <= DIGITAL_CARD_STATS_MAX_DAYS
}

export function createDigitalCardStatsStore(dbOverride?: DigitalCardStatsDb): DigitalCardStatsStore {
  const configured = () => Boolean(dbOverride) || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  const withDb = <T>(fn: (db: DigitalCardStatsDb) => Promise<T>): Promise<T> =>
    dbOverride ? fn(dbOverride) : runAsTrustedSystemOperation(REASON, (sb) => fn(sb as unknown as DigitalCardStatsDb))

  return {
    recordHit: async (hit) => {
      if (!hit || !PROJECT_RE.test(hit.projectSlug ?? '') || !CARD_RE.test(hit.cardId ?? '')) return false
      if (hit.kind !== 'visit' && hit.kind !== 'click') return false
      if (hit.kind === 'click' && !LINK_RE.test(hit.linkKey ?? '')) return false
      if (!configured()) return false
      const source = typeof hit.source === 'string' && DIGITAL_CARD_SOURCE_PATTERN.test(hit.source) ? hit.source : DIGITAL_CARD_DIRECT_SOURCE
      try {
        return await withDb(async (db) => {
          const { error } = await db.rpc('digital_card_hit', {
            p_project: hit.projectSlug,
            p_card: hit.cardId,
            p_link: hit.kind === 'click' ? hit.linkKey : null,
            p_source: source,
            p_kind: hit.kind,
          })
          return !error
        })
      } catch {
        return false
      }
    },

    readStats: async (query) => {
      if (!validQuery(query)) throw new DigitalCardStatsError('invalid', 'Invalid statistics range.')
      if (!configured()) return { available: false }
      try {
        return await withDb(async (db) => {
          const { data, error } = await db.rpc('digital_card_stats', {
            p_project: query.projectSlug,
            p_card: query.cardId ?? null,
            p_from: query.from,
            p_to: query.to,
          })
          if (isMissingDigitalCardStats(error)) return { available: false } as const
          if (error) throw new DigitalCardStatsError('failed', 'Could not read the statistics.')
          return { available: true, stats: parseDigitalCardStats(data) } as const
        })
      } catch (error) {
        if (error instanceof DigitalCardStatsError) throw error
        throw new DigitalCardStatsError('failed', 'Could not read the statistics.')
      }
    },

    sweep: async () => {
      if (!configured()) return null
      return withDb(async (db) => {
        const { data, error } = await db.rpc('digital_card_sweep')
        if (isMissingDigitalCardStats(error)) return null
        if (error) throw new DigitalCardStatsError('failed', 'Could not sweep the statistics.')
        return num(data)
      })
    },
  }
}

let defaultStore: DigitalCardStatsStore | null = null
const store = () => (defaultStore ??= createDigitalCardStatsStore())

/** Counts one visit or click with the service role. Never throws. */
export const recordHit = (hit: DigitalCardHit): Promise<boolean> => store().recordHit(hit)
/** Aggregated statistics. The caller has authorised digital-cards.stats.read and takes projectSlug from the grant. */
export const readStats = (query: DigitalCardStatsQuery): Promise<DigitalCardStatsRead> => store().readStats(query)
/** 13-month retention (cron). */
export const sweep = (): Promise<number | null> => store().sweep()
