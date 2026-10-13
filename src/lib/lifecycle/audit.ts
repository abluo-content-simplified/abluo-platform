// Server-only: writes through the service role; never import from a client component.
import { randomUUID } from 'node:crypto'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { ContentAction, PublishedSnapshot } from './transition'

/**
 * ADR-032 D9 — the content audit log writer (migration 041).
 *
 * One row per editorial lifecycle action on a project's content item. Rows
 * hold ids, dates and the lifecycle state after the change — never content,
 * titles or other personal data beyond the acting user's id.
 *
 * Attribution is exact: dashboard rows carry the signed-in user (or, in
 * support mode, the Abluo admin, flagged `support`); Studio rows (slice 3b)
 * are `studio`; nothing is ever attributed to a person by inference.
 *
 * Correlation: every dashboard write to Sanity uses a transaction id chosen
 * here (`abluo-dash-<uuid>`, unique per dataset as Sanity requires) and the
 * row stores it. Slice 3b's webhook and reconciliation meet the dashboard's
 * record on (sanity_transaction_id, content_id) — a unique index — so the same
 * change is never recorded twice and a missing record can be found.
 *
 * Best-effort, never silent: a write never breaks the user's action, but a
 * failure is retried once and then logged with the tag CONTENT_AUDIT_LOG_TAG
 * (searchable in the runtime logs); slice 3b's reconciliation re-creates the
 * missing row from Sanity's transaction history.
 */

export const CONTENT_AUDIT_LOG_TAG = '[content-audit] not recorded'
export const DASHBOARD_TRANSACTION_PREFIX = 'abluo-dash-'

export type AuditOutcome = 'ok' | 'refused' | 'failed'
export type AuditActorKind = 'user' | 'studio' | 'system'

export type ContentAuditEntry = {
  projectId: string | null
  contentType: string
  contentId: string
  action: ContentAction
  actorKind: AuditActorKind
  actorId: string | null
  outcome: AuditOutcome
  transactionId: string | null
  detail?: Record<string, unknown>
  /** When the change happened (Studio / reconciliation: the Sanity transaction time). Default: now. */
  occurredAt?: string
}

export type ContentAuditWriter = (entry: ContentAuditEntry) => Promise<void>

/** A Sanity transaction id for one dashboard write (Mutations API `transactionId`). */
export function newDashboardTransactionId(): string {
  return `${DASHBOARD_TRANSACTION_PREFIX}${randomUUID()}`
}

export function isDashboardTransactionId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(DASHBOARD_TRANSACTION_PREFIX)
}

/** Who acts, from the authorization context: the user, flagged when in support mode. */
export function dashboardActor(ctx: Pick<TenantAuthorizationContext, 'userId' | 'support'>): {
  actorKind: 'user'
  actorId: string
  detail: Record<string, unknown>
} {
  return { actorKind: 'user', actorId: ctx.userId, detail: ctx.support ? { support: true } : {} }
}

/** The row as stored (snake_case). Exported for tests. */
export function toRow(entry: ContentAuditEntry): Record<string, unknown> {
  return {
    project_id: entry.projectId,
    content_type: entry.contentType,
    content_id: entry.contentId,
    action: entry.action,
    actor_kind: entry.actorKind,
    actor_id: entry.actorId,
    outcome: entry.outcome,
    sanity_transaction_id: entry.transactionId,
    detail: entry.detail ?? {},
    ...(entry.occurredAt && { occurred_at: entry.occurredAt }),
  }
}

type AuditDb = { from: (table: 'content_audit_log') => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string; code?: string } | null }> } }

let warnedUnconfigured = false

/** The default writer: service role, one retry, then a tagged log line. */
export async function recordContentActivity(entry: ContentAuditEntry, deps: { db?: AuditDb } = {}): Promise<void> {
  const row = toRow(entry)
  // No Supabase at all (local tooling, unit tests): nothing can be stored —
  // said once per process instead of once per action.
  if (!deps.db && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    if (!warnedUnconfigured) console.error(`${CONTENT_AUDIT_LOG_TAG}: Supabase is not configured in this environment`)
    warnedUnconfigured = true
    return
  }
  const attempt = async (): Promise<string | null> => {
    try {
      const write = (db: AuditDb) => db.from('content_audit_log').insert(row)
      const { error } = deps.db
        ? await write(deps.db)
        : await runAsTrustedSystemOperation('ADR-032 D9 — append one content lifecycle record to content_audit_log', (sb) =>
            Promise.resolve(write(sb as unknown as AuditDb))
          )
      // 23505: this transaction is already recorded for this item — nothing lost.
      if (!error || error.code === '23505') return null
      return error.message
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  const first = await attempt()
  if (first === null) return
  const second = await attempt()
  if (second === null) return
  console.error(
    `${CONTENT_AUDIT_LOG_TAG}: ${entry.contentType}/${entry.contentId} ${entry.action} (${entry.outcome}) txn=${entry.transactionId ?? '-'}: ${second}`
  )
}

// ── Recording a dashboard action ─────────────────────────────────────────────

/**
 * The dashboard's error classes all carry an opaque `code`: 'failed' means it
 * broke; every other code (forbidden, not_found, conflict, in_use, invalid_*,
 * missing_*, …) means the platform said no. Anything else is a failure.
 */
function outcomeOf(error: unknown): AuditOutcome {
  if (error instanceof TenantAuthorizationError) return 'refused'
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code !== 'failed' ? 'refused' : 'failed'
}

export type AuditedResult<T> = {
  value: T
  /** null = the call changed nothing lifecycle-relevant; no row. */
  action: ContentAction | null
  /** Override (events record their publicId once it is known). */
  contentId?: string
  state?: PublishedSnapshot
  detail?: Record<string, unknown>
}

/**
 * Runs one dashboard lifecycle operation and records it. `run` receives the
 * Sanity transaction id it must commit with. On success the resulting action
 * is recorded (`ok`); on a refusal or failure the intended action is recorded
 * as `refused` / `failed` and the error is re-thrown unchanged. Recording never
 * changes what the caller sees.
 *
 * `contentId` null (an id that is not even a valid id) records nothing.
 */
export async function audited<T>(
  spec: {
    ctx: Pick<TenantAuthorizationContext, 'userId' | 'support'>
    projectId: string
    contentType: string
    contentId: string | null
    intended: ContentAction
    writer?: ContentAuditWriter
  },
  run: (transactionId: string) => Promise<AuditedResult<T>>
): Promise<T> {
  const writer = spec.writer ?? ((e: ContentAuditEntry) => recordContentActivity(e))
  // Recording never changes what the caller sees, whatever the writer does.
  const write = async (e: ContentAuditEntry) => {
    try {
      await writer(e)
    } catch (err) {
      console.error(`${CONTENT_AUDIT_LOG_TAG}: ${e.contentType}/${e.contentId} ${e.action} (${e.outcome}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const transactionId = newDashboardTransactionId()
  const actor = dashboardActor(spec.ctx)
  let result: AuditedResult<T>
  try {
    result = await run(transactionId)
  } catch (error) {
    if (spec.contentId) {
      const outcome = outcomeOf(error)
      await write({
        projectId: spec.projectId,
        contentType: spec.contentType,
        contentId: spec.contentId,
        action: spec.intended,
        actorKind: actor.actorKind,
        actorId: actor.actorId,
        outcome,
        // A failed write may still have reached Sanity: keep its id for reconciliation.
        transactionId: outcome === 'failed' ? transactionId : null,
        detail: { ...actor.detail, code: (error as { code?: unknown })?.code ?? null },
      })
    }
    throw error
  }
  const contentId = result.contentId ?? spec.contentId
  if (result.action && contentId) {
    await write({
      projectId: spec.projectId,
      contentType: spec.contentType,
      contentId,
      action: result.action,
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      outcome: 'ok',
      transactionId,
      detail: { ...actor.detail, ...(result.state !== undefined && { state: result.state }), ...result.detail },
    })
  }
  return result.value
}
