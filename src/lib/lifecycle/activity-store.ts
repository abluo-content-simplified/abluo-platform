// Server-only: service role; never import from a client component.
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { toRow, type ContentAuditEntry } from './audit'

/**
 * The content audit log as the Studio webhook, the reconciliation job and the
 * admin attention rule use it (ADR-032 D9 amendment A3–A5). Unlike the
 * dashboard writer, inserts report their outcome: a webhook that cannot store
 * its record must answer 5xx so Sanity retries.
 */

export type InsertResult = 'ok' | 'duplicate' | 'error'

export type ActivityIssue = { projectId: string; kind: 'unattributed' | 'reconciled' | 'failed'; occurredAt: string }

export type ActivityStore = {
  insert(entry: ContentAuditEntry): Promise<InsertResult>
  /** Is this Sanity transaction already recorded for this item (under any of its ids)? */
  hasTransaction(transactionId: string, contentIds: string[]): Promise<boolean>
  projectIdForSlug(slug: string): Promise<string | null>
  /** Deletes rows past retention; returns how many of each. */
  purge(cut: { okBefore: string; shortBefore: string }): Promise<{ ok: number; short: number }>
  /** Rows Abluo admins must look at, since a moment. */
  issuesSince(since: string): Promise<ActivityIssue[]>
}

type Db = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

const REASON = 'ADR-032 D9 — content audit log: Studio webhook, reconciliation, retention and admin monitoring'

export function createSupabaseActivityStore(dbOverride?: Db): ActivityStore {
  const withDb = <T>(fn: (db: Db) => Promise<T>): Promise<T> =>
    dbOverride ? fn(dbOverride) : runAsTrustedSystemOperation(REASON, (sb) => fn(sb as unknown as Db))
  return {
    insert: (entry) =>
      withDb(async (db) => {
        const { error } = await db.from('content_audit_log').insert(toRow(entry))
        if (!error) return 'ok'
        return error.code === '23505' ? 'duplicate' : 'error'
      }).catch(() => 'error' as const),
    hasTransaction: (transactionId, contentIds) =>
      withDb(async (db) => {
        const { data, error } = await db
          .from('content_audit_log')
          .select('id')
          .eq('sanity_transaction_id', transactionId)
          .in('content_id', contentIds)
          .limit(1)
        if (error) throw new Error(`content audit: ${error.message}`)
        return (data ?? []).length > 0
      }),
    projectIdForSlug: (slug) =>
      withDb(async (db) => {
        const { data, error } = await db.from('projects').select('id').eq('slug', slug).limit(1)
        if (error) throw new Error(`content audit: ${error.message}`)
        return (data?.[0]?.id as string | undefined) ?? null
      }),
    purge: (cut) =>
      withDb(async (db) => {
        const del = async (q: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          const { data, error } = await q.select('id')
          if (error) throw new Error(`content audit purge: ${error.message}`)
          return (data ?? []).length as number
        }
        const ok = await del(db.from('content_audit_log').delete().eq('outcome', 'ok').lt('occurred_at', cut.okBefore))
        const short =
          (await del(db.from('content_audit_log').delete().in('outcome', ['refused', 'failed']).lt('occurred_at', cut.shortBefore))) +
          (await del(db.from('content_audit_log').delete().eq('detail->>unattributed', 'true').lt('occurred_at', cut.shortBefore)))
        return { ok, short }
      }),
    issuesSince: (since) =>
      withDb(async (db) => {
        const { data, error } = await db
          .from('content_audit_log')
          .select('project_id, outcome, occurred_at, detail')
          .gte('occurred_at', since)
          .or('outcome.eq.failed,detail->>unattributed.eq.true,detail->>reconciled.eq.true')
          .limit(1000)
        if (error) throw new Error(`content audit: ${error.message}`)
        const out: ActivityIssue[] = []
        for (const r of (data ?? []) as Array<{ project_id: string | null; outcome: string; occurred_at: string; detail: Record<string, unknown> | null }>) {
          if (!r.project_id) continue
          const kind = r.detail?.unattributed === true ? 'unattributed' : r.outcome === 'failed' ? 'failed' : 'reconciled'
          out.push({ projectId: r.project_id, kind, occurredAt: r.occurred_at })
        }
        return out
      }),
  }
}
