// Server-only: imports the service-role client; never import from a client component.
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Internal admin audit log (ADR-030, migration 033 — Tom, 2026-10-08).
 *
 * Every admin view of one client's data (project page, a project's analytics,
 * a project's media …) records who, what, which project, when. Internal only;
 * what the client gets to see is decided later.
 *
 * Views are de-duplicated: one `*.view` row per admin + action + project per
 * VIEW_DEDUPE_WINDOW_MS (checked in SQL before the insert). Re-renders, the
 * Home summary on every visit, and paging or filtering a list are the same
 * look, not new ones. Changes (`media.asset.*`) are always recorded.
 *
 * Best-effort by design: logging never breaks or slows the page it describes —
 * a failure (e.g. migration not applied yet) is swallowed and logged to the
 * server console. Call ONLY after `requireAbluoAdmin()` / the admin layout gate.
 */
export type AdminAuditAction =
  | 'project.view'
  | 'project.analytics.view'
  | 'analytics.portfolio.view'
  | 'media.project.view'
  | 'media.asset.update'
  | 'media.asset.delete'
  | 'media.asset.upload'
  // "New project" wizard (migration 037). `project_id` is set only once the
  // project row exists (the log's FK); before that the run id is in `detail`.
  | 'project.provision.view'
  | 'project.provision.check'
  | 'project.provision.start'
  | 'project.provision.retry'
  | 'project.provision.complete'
  | 'project.provision.fail'
  // Support mode (ADR-028 §8, migration 038). The client's own decisions are
  // logged here too, with the client user as actor and `detail.by = 'client'`.
  | 'support.visit.start'
  | 'support.visit.exit'
  | 'support.edit.request'
  | 'support.edit.allowed'
  | 'support.edit.declined'
  | 'support.edit.revoked'
  | 'support.edit.expired'
  | 'support.contact_requests.show'
  /** A server action / route handler run inside a support visit (every write attempt; `detail.writesAllowed`). */
  | 'support.action'
  // "Connect Google" on the project page (docs/engineering/analytics-setup.md →
  // Automatic setup). `detail.state` connected / waiting_for_site / error.
  | 'google.analytics.setup'
  | 'google.search_console.connect'

export const ADMIN_AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/

/** One view row per admin + action + project in this window. */
export const VIEW_DEDUPE_WINDOW_MS = 10 * 60 * 1000

/** Pure: a look (de-duplicated), not a change (always recorded). */
export function isViewAction(action: AdminAuditAction): boolean {
  return action.endsWith('.view')
}

/** Pure: the earliest `occurred_at` that still counts as the same view. */
export function viewDedupeSince(now: number): string {
  return new Date(now - VIEW_DEDUPE_WINDOW_MS).toISOString()
}

export type AdminAuditEntry = {
  actorId: string
  action: AdminAuditAction
  projectId?: string | null
  detail?: Record<string, unknown>
}

// Narrow structural type: the service-role client, or a fake in tests.
type AuditDb = { from: (table: 'admin_audit_log') => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** True when the same admin already recorded this view of this project within the window. */
async function recentlyViewed(db: AuditDb, entry: AdminAuditEntry, now: number): Promise<boolean> {
  const q = db
    .from('admin_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', entry.actorId)
    .eq('action', entry.action)
    .gte('occurred_at', viewDedupeSince(now))
  const { count, error } = await (entry.projectId ? q.eq('project_id', entry.projectId) : q.is('project_id', null))
  // A failed check records the view: a duplicate row is better than a missing one.
  return !error && (count ?? 0) > 0
}

export async function recordAdminAudit(entry: AdminAuditEntry, deps: { db?: AuditDb; now?: number } = {}): Promise<void> {
  try {
    const db = deps.db ?? (createAdminClient() as unknown as AuditDb)
    if (isViewAction(entry.action) && (await recentlyViewed(db, entry, deps.now ?? Date.now()))) return
    const { error } = await db
      .from('admin_audit_log')
      .insert({ actor_id: entry.actorId, action: entry.action, project_id: entry.projectId ?? null, detail: entry.detail ?? {} })
    if (error) console.warn(`admin audit: not recorded (${entry.action}): ${error.message}`)
  } catch (e) {
    console.warn(`admin audit: not recorded (${entry.action}): ${e instanceof Error ? e.message : String(e)}`)
  }
}
