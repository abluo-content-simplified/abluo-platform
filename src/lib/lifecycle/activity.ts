// Server-only: reads through the service role; never import from a client component.
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { ContentAction } from './transition'

/**
 * ADR-032 D9 — the per-item Activity a client sees: what happened, who did
 * it, when. Read-only; successful actions only (refusals and failures are
 * internal). Newest first.
 *
 * The actor shown is exactly what was recorded, never inferred:
 *   person        — a dashboard user, by their profile name
 *   member        — a dashboard user without a name on their profile
 *   formerMember  — a dashboard user whose account no longer exists
 *   support       — an Abluo admin acting in support mode (never named)
 *   team          — Abluo staff in Studio (slice 3b)
 *   system        — an automatic, unattributed record (slice 3b); never a person
 */

export type ActivityActorKind = 'person' | 'member' | 'formerMember' | 'support' | 'team' | 'system'
export type ActivityItem = { id: string; at: string; action: ContentAction; actor: { kind: ActivityActorKind; name: string | null } }

export const ACTIVITY_LIMIT = 100

type Row = { id: number | string; occurred_at: string; action: ContentAction; actor_kind: string; actor_id: string | null; detail: Record<string, unknown> | null }

/** Pure: one stored row → what the client sees. Exported for tests. */
export function toActivityItem(row: Row, names: ReadonlyMap<string, string>): ActivityItem {
  const base = { id: String(row.id), at: row.occurred_at, action: row.action }
  const detail = row.detail ?? {}
  if (row.actor_kind === 'studio') return { ...base, actor: { kind: 'team', name: null } }
  if (row.actor_kind !== 'user') return { ...base, actor: { kind: 'system', name: null } }
  if (detail.support === true) return { ...base, actor: { kind: 'support', name: null } }
  if (!row.actor_id) return { ...base, actor: { kind: 'formerMember', name: null } }
  const name = names.get(row.actor_id)?.trim()
  return { ...base, actor: name ? { kind: 'person', name } : { kind: 'member', name: null } }
}

type Db = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * The Activity of one content item. `contentIds` lists every id the item was
 * recorded under (e.g. an event's publicId and its _id). The CALLER has
 * already checked permission and ownership.
 */
export async function readContentActivity(
  q: { projectId: string; contentType: string; contentIds: string[] },
  deps: { db?: Db } = {}
): Promise<ActivityItem[]> {
  const run = async (db: Db): Promise<ActivityItem[]> => {
    const { data, error } = await db
      .from('content_audit_log')
      .select('id, occurred_at, action, actor_kind, actor_id, detail')
      .eq('project_id', q.projectId)
      .eq('content_type', q.contentType)
      .in('content_id', q.contentIds)
      .eq('outcome', 'ok')
      .order('occurred_at', { ascending: false })
      .limit(ACTIVITY_LIMIT)
    if (error) throw new Error(`activity: ${error.message}`)
    const rows = (data ?? []) as Row[]
    const userIds = [...new Set(rows.filter((r) => r.actor_kind === 'user' && r.actor_id && r.detail?.support !== true).map((r) => r.actor_id as string))]
    const names = new Map<string, string>()
    if (userIds.length) {
      const { data: profiles } = await db.from('profiles').select('id, full_name').in('id', userIds)
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) names.set(p.id, p.full_name)
    }
    return rows.map((r) => toActivityItem(r, names))
  }
  return deps.db
    ? run(deps.db)
    : runAsTrustedSystemOperation('ADR-032 D9 — read one content item\'s Activity after the caller\'s permission check', (sb) => run(sb as unknown as Db))
}
