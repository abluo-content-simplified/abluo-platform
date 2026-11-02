// Server-only: writes through the service role; never import from a client component.
//
// ── Catalogue audit writer (C12 §12.4) ───────────────────────────────────────
//
// Same pattern as the content audit writer (lifecycle/audit.ts,
// `recordContentActivity`): service role, one retry, then a tagged log line;
// it NEVER breaks the caller's action.
//
// M0 (C10-6): this writer ships BEFORE migration 061 is applied. Until then
// the table does not exist; that is "log and continue" — one tagged line per
// process, no retry, no error to the caller.
//
// Rows are written AFTER the Sanity commit, keyed by the Sanity transaction id
// (Supabase and Sanity cannot share a transaction, REVIEW C-20); the unique
// index (transaction_id, kind, target_id) makes retries safe — 23505 is
// success. A row that still fails is re-created by the daily reconciliation.

import { randomUUID } from 'node:crypto'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { catalogueTransactionId } from '@/lib/sanity/studio/catalogue-posture'
import { validateAuditDetail, type AuditOutcome, type AuditScope, type CatalogueAuditEntry, type CatalogueAuditKind } from './events'

export const CATALOGUE_AUDIT_LOG_TAG = '[catalogue-audit] not recorded'
export const CATALOGUE_AUDIT_TABLE = 'catalogue_audit_log'

export type CatalogueAuditWriter = (entry: CatalogueAuditEntry) => Promise<void>

type InsertResult = { error: { message: string; code?: string } | null }
export type AuditDb = { from: (table: typeof CATALOGUE_AUDIT_TABLE) => { insert: (row: Record<string, unknown>) => PromiseLike<InsertResult> } }

/** The row as stored (snake_case, migration 061). Exported for tests. */
export function toCatalogueAuditRow(entry: CatalogueAuditEntry): Record<string, unknown> {
  return {
    project_id: entry.projectId,
    kind: entry.kind,
    scope: entry.scope,
    target_id: entry.targetId ?? null,
    actor_kind: entry.actorKind,
    actor_id: entry.actorId,
    outcome: entry.outcome,
    transaction_id: entry.transactionId ?? null,
    correlation_id: entry.correlationId ?? null,
    detail: entry.detail,
    ...(entry.occurredAt && { occurred_at: entry.occurredAt }),
  }
}

/**
 * Postgres 42P01 (undefined_table) through PostgREST, or PostgREST's own
 * "table not in the schema cache" (PGRST205, older PGRST204/42P01 texts).
 */
export function isMissingTableError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  const m = error.message ?? ''
  return /relation .*catalogue_audit_log.* does not exist/i.test(m) || /could not find the table .*catalogue_audit_log/i.test(m)
}

let warnedUnconfigured = false
let warnedMissingTable = false

/** Tests only: forget the once-per-process warnings. */
export function resetCatalogueAuditWarnings() {
  warnedUnconfigured = false
  warnedMissingTable = false
}

const describe_ = (e: CatalogueAuditEntry) => `${e.kind} ${e.scope}/${e.targetId ?? '-'} (${e.outcome}) txn=${e.transactionId ?? '-'}`

/** Default writer: validate → insert (service role) → one retry → tagged log. Never throws. */
export async function recordCatalogueActivity(entry: CatalogueAuditEntry, deps: { db?: AuditDb } = {}): Promise<void> {
  // Content-free by contract: a payload that fails the allowlist is never stored (and never logged).
  if (!validateAuditDetail(entry.kind, entry.detail)) {
    console.error(`${CATALOGUE_AUDIT_LOG_TAG}: ${describe_(entry)}: detail rejected by the payload allowlist`)
    return
  }
  if (!deps.db && (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    if (!warnedUnconfigured) console.error(`${CATALOGUE_AUDIT_LOG_TAG}: Supabase is not configured in this environment`)
    warnedUnconfigured = true
    return
  }
  const row = toCatalogueAuditRow(entry)
  type Attempt = { ok: true } | { ok: false; missingTable: boolean; message: string }
  const attempt = async (): Promise<Attempt> => {
    try {
      const write = (db: AuditDb) => db.from(CATALOGUE_AUDIT_TABLE).insert(row)
      const { error } = deps.db
        ? await write(deps.db)
        : await runAsTrustedSystemOperation('C12 — append one Catalogue event to catalogue_audit_log', (sb) => Promise.resolve(write(sb as unknown as AuditDb)))
      // 23505: this (transaction, kind, target) is already recorded — nothing lost.
      if (!error || error.code === '23505') return { ok: true }
      return { ok: false, missingTable: isMissingTableError(error), message: error.message }
    } catch (e) {
      return { ok: false, missingTable: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
  const first = await attempt()
  if (first.ok) return
  if (first.missingTable) {
    // M0: migration 061 not applied yet — log once and continue; retrying cannot help.
    if (!warnedMissingTable) console.error(`${CATALOGUE_AUDIT_LOG_TAG}: table ${CATALOGUE_AUDIT_TABLE} is missing (migration 061 not applied) — ${describe_(entry)}`)
    warnedMissingTable = true
    return
  }
  const second = await attempt()
  if (second.ok) return
  console.error(`${CATALOGUE_AUDIT_LOG_TAG}: ${describe_(entry)}: ${second.message}`)
}

/** As lifecycle/audit.ts: refusals carry an opaque non-'failed' code; anything else is a failure. */
function outcomeOf(error: unknown): AuditOutcome {
  if (error instanceof TenantAuthorizationError) return 'refused'
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code !== 'failed' ? 'refused' : 'failed'
}

/**
 * Wrapper for Catalogue operations (mirrors `audited()`): `run` receives the
 * Sanity transaction id it must commit with (`abluo-dash-…`, one of
 * CATALOGUE_WRITER_PREFIXES) and returns the value plus the content-free
 * detail. Success records `ok`; a refusal/failure records the intended kind
 * as `refused` / `failed` and re-throws unchanged. Recording never changes
 * what the caller sees.
 */
export async function auditedCatalogue<T>(
  spec: {
    ctx: Pick<TenantAuthorizationContext, 'userId' | 'support'>
    projectId: string
    kind: CatalogueAuditKind
    scope?: AuditScope
    targetId?: string
    correlationId?: string
    writer?: CatalogueAuditWriter
    /** Test seam; default randomUUID. */
    uuid?: () => string
  },
  run: (transactionId: string) => Promise<{ value: T; detail: object; scope?: AuditScope; targetId?: string }>
): Promise<T> {
  const writer = spec.writer ?? ((e: CatalogueAuditEntry) => recordCatalogueActivity(e))
  const write = async (e: CatalogueAuditEntry) => {
    try {
      await writer(e)
    } catch (err) {
      console.error(`${CATALOGUE_AUDIT_LOG_TAG}: ${describe_(e)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const transactionId = catalogueTransactionId('dash', (spec.uuid ?? randomUUID)())
  const support = spec.ctx.support ? { support: true } : {}
  const base = {
    projectId: spec.projectId,
    kind: spec.kind,
    actorKind: 'user' as const,
    actorId: spec.ctx.userId,
    ...(spec.correlationId !== undefined && { correlationId: spec.correlationId }),
  }
  let result: Awaited<ReturnType<typeof run>>
  try {
    result = await run(transactionId)
  } catch (error) {
    const outcome = outcomeOf(error)
    await write({
      ...base,
      scope: spec.scope ?? 'project',
      ...(spec.targetId !== undefined && { targetId: spec.targetId }),
      outcome,
      // A failed write may still have reached Sanity: keep its id for reconciliation.
      ...(outcome === 'failed' && { transactionId }),
      detail: { ...support, code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : null },
    })
    throw error
  }
  const targetId = result.targetId ?? spec.targetId
  await write({
    ...base,
    scope: result.scope ?? spec.scope ?? 'project',
    ...(targetId !== undefined && { targetId }),
    outcome: 'ok',
    transactionId,
    detail: { ...result.detail, ...support },
  })
  return result.value
}
