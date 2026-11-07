// ── Reservations outbox — claim / finalize on reservation_outbox (ADR-044 D10) ─
//
// Same idea as Forms deliverEvent(): a row is CLAIMED by an atomic conditional
// update (only one runner gets it), and a row left `delivering` by a crashed
// run is claimable again once claimed_at is older than STALE_CLAIM_MS.
// Rows of another environment are never touched (one database serves
// production, preview and development).
import type { ReservationDb } from '../server/store'

export const MAX_ATTEMPTS = 5
export const STALE_CLAIM_MS = 10 * 60_000
export const BATCH = 25

export type OutboxStatus = 'pending' | 'delivering' | 'delivered' | 'failed' | 'dead' | 'skipped'

export type OutboxRow = {
  id: string
  project_id: string
  booking_id: string | null
  pass_id: string | null
  intent: string
  dedupe_key: string
  recipients: unknown
  locale: string
  payload: Record<string, unknown>
  environment: string
  status: OutboxStatus
  attempts: number
  provider_message_id: string | null
}

export type FinalizePatch = {
  status: Exclude<OutboxStatus, 'pending' | 'delivering'>
  attempts: number
  last_error: string | null
  provider_message_id?: string | null
  delivered_at?: string | null
  next_attempt_at?: string
  /** Replaces the payload (token-stripped). */
  payload?: Record<string, unknown>
}

export type OutboxRepo = {
  /** Ids of rows due now, oldest first (this environment only). 'unavailable' = table missing (066 not applied) or unreadable. */
  listDueIds(environment: string, now: Date, limit: number): Promise<string[] | 'unavailable'>
  /** Atomically takes one due row; null = somebody else has it / not due. */
  claim(id: string, environment: string, now: Date): Promise<OutboxRow | null>
  /** Writes the outcome of a claimed row; false = the claim was lost meanwhile. */
  finalize(id: string, patch: FinalizePatch): Promise<boolean>
}

const COLUMNS = 'id, project_id, booking_id, pass_id, intent, dedupe_key, recipients, locale, payload, environment, status, attempts, provider_message_id'

/** pending/failed and due, or delivering with a stale (or missing) claim. */
export function dueFilter(now: Date): string {
  const nowIso = now.toISOString()
  const staleIso = new Date(now.getTime() - STALE_CLAIM_MS).toISOString()
  return [
    `and(status.in.(pending,failed),next_attempt_at.lte.${nowIso})`,
    `and(status.eq.delivering,claimed_at.lt.${staleIso})`,
    'and(status.eq.delivering,claimed_at.is.null)',
  ].join(',')
}

export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000)
}

export function createSupabaseOutboxRepo(db: ReservationDb): OutboxRepo {
  return {
    async listDueIds(environment, now, limit) {
      const { data, error } = await db.from('reservation_outbox').select('id')
        .eq('environment', environment).or(dueFilter(now)).order('next_attempt_at', { ascending: true }).limit(limit)
      if (error) {
        console.error('[reservations] outbox list failed:', error.code ?? '', error.message ?? '')
        return 'unavailable'
      }
      return (Array.isArray(data) ? data : []).map((r: { id: string }) => r.id)
    },
    async claim(id, environment, now) {
      const iso = now.toISOString()
      const { data, error } = await db.from('reservation_outbox')
        .update({ status: 'delivering', claimed_at: iso, updated_at: iso })
        .eq('id', id).eq('environment', environment).or(dueFilter(now)).select(COLUMNS)
      if (error) throw new Error(error.message ?? 'outbox claim failed')
      const row = Array.isArray(data) ? data[0] : null
      return row ? ({ ...row, attempts: Number(row.attempts) || 0, payload: row.payload && typeof row.payload === 'object' ? row.payload : {} } as OutboxRow) : null
    },
    async finalize(id, patch) {
      const { data, error } = await db.from('reservation_outbox')
        .update({ ...patch, claimed_at: null, updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'delivering').select('id')
      if (error) throw new Error(error.message ?? 'outbox finalize failed')
      return Array.isArray(data) && data.length > 0
    },
  }
}
