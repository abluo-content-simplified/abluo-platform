// Server-only: imports the service-role client; never import from a client component.
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Internal admin audit log (ADR-030, migration 033 — Tom, 2026-10-08).
 *
 * Every admin view of one client's data (project page, a project's analytics,
 * a project's media …) records who, what, which project, when. Internal only;
 * what the client gets to see is decided later.
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

export const ADMIN_AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_.]{2,63}$/

export async function recordAdminAudit(entry: {
  actorId: string
  action: AdminAuditAction
  projectId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from('admin_audit_log')
      .insert({ actor_id: entry.actorId, action: entry.action, project_id: entry.projectId ?? null, detail: entry.detail ?? {} })
    if (error) console.warn(`admin audit: not recorded (${entry.action}): ${error.message}`)
  } catch (e) {
    console.warn(`admin audit: not recorded (${entry.action}): ${e instanceof Error ? e.message : String(e)}`)
  }
}
