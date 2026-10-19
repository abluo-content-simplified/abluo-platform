/**
 * ADR-032 D9 amendment (slice 3b) — Activity for changes made outside the
 * dashboard, and the safety net for everything.
 *
 *   Studio webhook   — a published lifecycle change in Sanity → one `studio`
 *                      row, attributed only after Sanity's History API
 *                      confirms a person made it (A1, A3).
 *   Reconciliation   — daily: every lifecycle change in Sanity's history
 *                      without a row is recorded late — missing dashboard
 *                      records (as unattributed `system`, never a person) and
 *                      missing Studio records (as `studio`) (A4).
 *   Retention        — PROVISIONAL (A5): `ok` rows 5 years; refused, failed
 *                      and unattributed rows 12 months.
 *
 * Idempotent everywhere: rows meet on (sanity_transaction_id, content_id),
 * so webhook retries (at-least-once delivery), a duplicate webhook (dev and
 * production share the dataset) and the daily job never double a record.
 * Pure except for the injected dependencies.
 */

import { isDashboardTransactionId, type ContentAuditEntry } from './audit'
import { LIFECYCLE_PUBLIC_RULES, type LifecycleType } from './public-types'
import { lifecycleAction, snapshotOf, type PublishedSnapshot } from './transition'
import type { ActivityStore } from './activity-store'

// ── Sanity webhook configuration (registered by hand in sanity.io/manage) ────

/** Published lifecycle documents only (drafts are ignored by Sanity by default). */
export const ACTIVITY_WEBHOOK_FILTER =
  '_type in ["post", "newsArticle", "event", "gallery", "faqSet"] && (delta::operation() != "update" || delta::changedAny((publishedAt, expiresAt, archivedAt)))'

export const ACTIVITY_WEBHOOK_PROJECTION = `{
  "documentId": coalesce(after()._id, before()._id),
  "type": coalesce(after()._type, before()._type),
  "projectSlug": coalesce(after().projectSlug, before().projectSlug),
  "publicId": coalesce(after().publicId, before().publicId),
  "operation": delta::operation(),
  "before": before(){ publishedAt, expiresAt, archivedAt },
  "after": after(){ publishedAt, expiresAt, archivedAt }
}`

export type StudioChange = {
  documentId: string
  type: LifecycleType
  projectSlug: string | null
  publicId: string | null
  before: PublishedSnapshot
  after: PublishedSnapshot
}

const isLifecycleType = (t: unknown): t is LifecycleType => typeof t === 'string' && t in LIFECYCLE_PUBLIC_RULES
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** The webhook body → a change, or null when it is not one we record. */
export function parseStudioChange(body: unknown): StudioChange | 'invalid' | null {
  const b = obj(body)
  if (!b) return 'invalid'
  const documentId = str(b.documentId)
  if (!documentId) return 'invalid'
  if (documentId.startsWith('drafts.') || documentId.startsWith('versions.')) return null
  if (!isLifecycleType(b.type)) return null
  return {
    documentId,
    type: b.type,
    projectSlug: str(b.projectSlug),
    publicId: str(b.publicId),
    before: obj(b.before) ? snapshotOf(obj(b.before)) : null,
    after: obj(b.after) ? snapshotOf(obj(b.after)) : null,
  }
}

/** Activity rows of an event use its publicId (D9), every other type its _id. */
export const contentIdOf = (type: LifecycleType, documentId: string, publicId: string | null) =>
  type === 'event' && publicId ? publicId : documentId

export type StudioDeps = {
  store: ActivityStore
  /** The transaction's author per Sanity's History API; null when Sanity has no such transaction. */
  authorOf: (documentId: string, transactionId: string) => Promise<string | null>
  /** The dashboard write token's Sanity identity. */
  dashboardIdentity: () => Promise<string>
  now?: () => Date
}

export type WebhookOutcome =
  | { status: 204; result: 'ignored' | 'dashboard' | 'recorded' | 'duplicate' }
  | { status: 400; result: 'invalid' }
  | { status: 503; result: 'retry' }

/**
 * One webhook delivery. 503 asks Sanity to retry (author not confirmable yet,
 * storage failed); whatever still fails after Sanity's retries is repaired by
 * the daily reconciliation.
 */
export async function recordStudioChange(
  input: { body: unknown; transactionId: string | null; transactionTime: string | null },
  deps: StudioDeps
): Promise<WebhookOutcome> {
  const change = parseStudioChange(input.body)
  if (change === 'invalid' || !input.transactionId) return { status: 400, result: 'invalid' }
  if (!change) return { status: 204, result: 'ignored' }
  const at = input.transactionTime && !Number.isNaN(Date.parse(input.transactionTime)) ? new Date(input.transactionTime) : (deps.now ?? (() => new Date()))()
  const action = lifecycleAction(change.before, change.after, LIFECYCLE_PUBLIC_RULES[change.type], at)
  if (!action) return { status: 204, result: 'ignored' }
  // The dashboard records its own writes (slice 3a); reconciliation checks it did.
  if (isDashboardTransactionId(input.transactionId)) return { status: 204, result: 'dashboard' }

  let author: string | null
  let dashboard: string
  try {
    ;[author, dashboard] = await Promise.all([deps.authorOf(change.documentId, input.transactionId), deps.dashboardIdentity()])
  } catch {
    return { status: 503, result: 'retry' }
  }
  if (!author) return { status: 503, result: 'retry' }
  // Written with the dashboard's token but not by the dashboard (scripts,
  // other server code): never a person. Left to reconciliation, which records
  // it as unattributed and surfaces it to Abluo admins.
  if (author === dashboard) return { status: 204, result: 'dashboard' }

  let projectId: string | null
  try {
    projectId = change.projectSlug ? await deps.store.projectIdForSlug(change.projectSlug) : null
  } catch {
    return { status: 503, result: 'retry' }
  }
  const r = await deps.store.insert({
    projectId,
    contentType: change.type,
    contentId: contentIdOf(change.type, change.documentId, change.publicId),
    action,
    actorKind: 'studio',
    actorId: null,
    outcome: 'ok',
    transactionId: input.transactionId,
    occurredAt: at.toISOString(),
    detail: { sanityUserId: author, state: change.after },
  })
  if (r === 'error') return { status: 503, result: 'retry' }
  return { status: 204, result: r === 'duplicate' ? 'duplicate' : 'recorded' }
}

// ── Daily reconciliation ─────────────────────────────────────────────────────

export const RECONCILE_LOOKBACK_HOURS = 26
/** Changes younger than this are left to the webhook and the dashboard. */
export const RECONCILE_SETTLE_MINUTES = 60
export const RECONCILE_TRANSACTION_LIMIT = 1000

export type ReconcileDeps = {
  store: ActivityStore
  dashboardIdentity: () => Promise<string>
  transactionsBetween: (from: Date, to: Date, limit: number) => Promise<Array<{ id: string; timestamp: string; author: string; documentIDs: string[] }>>
  documentAt: (documentId: string, at: { revision: string } | { time: string }) => Promise<Record<string, unknown> | null>
  now?: () => Date
}

export type ReconcileSummary = {
  transactions: number
  checked: number
  repairedStudio: number
  repairedUnattributed: number
  failed: number
  /** The window held more transactions than one run reads — some were not checked. */
  capped: boolean
}

export async function reconcileActivity(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const from = new Date(now.getTime() - RECONCILE_LOOKBACK_HOURS * 3600_000)
  const to = new Date(now.getTime() - RECONCILE_SETTLE_MINUTES * 60_000)
  const txns = await deps.transactionsBetween(from, to, RECONCILE_TRANSACTION_LIMIT)
  const dashboard = await deps.dashboardIdentity()
  const summary: ReconcileSummary = { transactions: txns.length, checked: 0, repairedStudio: 0, repairedUnattributed: 0, failed: 0, capped: txns.length >= RECONCILE_TRANSACTION_LIMIT }
  const projectIds = new Map<string, string | null>()

  for (const t of txns) {
    for (const documentId of t.documentIDs) {
      if (documentId.startsWith('drafts.') || documentId.startsWith('versions.')) continue
      try {
        const afterDoc = await deps.documentAt(documentId, { revision: t.id })
        // A revision lookup of a delete returns nothing, or the last earlier revision.
        const after = afterDoc && afterDoc._rev === t.id ? afterDoc : null
        const beforeDoc = await deps.documentAt(documentId, { time: new Date(Date.parse(t.timestamp) - 1).toISOString() })
        const type = (after ?? beforeDoc)?._type
        if (!isLifecycleType(type)) continue
        summary.checked++
        const action = lifecycleAction(snapshotOf(beforeDoc), snapshotOf(after), LIFECYCLE_PUBLIC_RULES[type], new Date(t.timestamp))
        if (!action) continue
        const publicId = str((after ?? beforeDoc)?.publicId)
        const contentId = contentIdOf(type, documentId, publicId)
        if (await deps.store.hasTransaction(t.id, [...new Set([contentId, documentId])])) continue

        const slug = str((after ?? beforeDoc)?.projectSlug)
        if (slug && !projectIds.has(slug)) projectIds.set(slug, await deps.store.projectIdForSlug(slug))
        const byDashboardToken = t.author === dashboard || isDashboardTransactionId(t.id)
        const entry: ContentAuditEntry = {
          projectId: slug ? (projectIds.get(slug) ?? null) : null,
          contentType: type,
          contentId,
          action,
          actorKind: byDashboardToken ? 'system' : 'studio',
          actorId: null,
          outcome: 'ok',
          transactionId: t.id,
          occurredAt: t.timestamp,
          detail: byDashboardToken
            ? { reconciled: true, unattributed: true, state: snapshotOf(after) }
            : { reconciled: true, sanityUserId: t.author, state: snapshotOf(after) },
        }
        const r = await deps.store.insert(entry)
        if (r === 'error') summary.failed++
        else if (r === 'ok') byDashboardToken ? summary.repairedUnattributed++ : summary.repairedStudio++
      } catch {
        summary.failed++
      }
    }
  }
  return summary
}

// ── Retention (PROVISIONAL — ADR-032 amendment A5) ───────────────────────────

export const RETENTION_OK_YEARS = 5
export const RETENTION_SHORT_MONTHS = 12

export function retentionCutoffs(now: Date): { okBefore: string; shortBefore: string } {
  const ok = new Date(now)
  ok.setUTCFullYear(ok.getUTCFullYear() - RETENTION_OK_YEARS)
  const short = new Date(now)
  short.setUTCMonth(short.getUTCMonth() - RETENTION_SHORT_MONTHS)
  return { okBefore: ok.toISOString(), shortBefore: short.toISOString() }
}
