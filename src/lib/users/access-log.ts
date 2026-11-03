// Server-only: writes through the service-role client handed in by the caller.

/**
 * Access history (ADR-030 amendment A1, migration 049): who changed someone's
 * access to a site — role/extras changed, archived, restored. Invitations are
 * NOT copied here; they are a history of their own in `invitations`.
 *
 * `detail` holds roles and extras only (before/after) plus `support: true`
 * when an Abluo admin made the change in support mode — never emails, tokens
 * or content.
 *
 * Best-effort like the admin audit log: a failure (e.g. 049 not applied yet)
 * never undoes or blocks the change it describes.
 */
export type AccessAuditAction = 'member.change' | 'member.archive' | 'member.restore'

export type AccessAuditEntry = {
  actorId: string
  subjectUserId: string
  projectId: string
  action: AccessAuditAction
  detail?: Record<string, unknown>
}

type Db = { from: (table: 'access_audit_log') => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pure: the row stored for one entry. Exported for tests. */
export function accessAuditRow(entry: AccessAuditEntry, opts: { support?: boolean } = {}) {
  return {
    actor_id: entry.actorId,
    subject_user_id: entry.subjectUserId,
    project_id: entry.projectId,
    action: entry.action,
    detail: { ...(entry.detail ?? {}), ...(opts.support ? { support: true } : {}) },
  }
}

export async function recordAccessChange(db: unknown, entry: AccessAuditEntry, opts: { support?: boolean } = {}): Promise<void> {
  try {
    const { error } = await (db as Db).from('access_audit_log').insert(accessAuditRow(entry, opts))
    if (error) console.warn(`access log: not recorded (${entry.action}): ${error.message}`)
  } catch (e) {
    console.warn(`access log: not recorded (${entry.action}): ${e instanceof Error ? e.message : String(e)}`)
  }
}
