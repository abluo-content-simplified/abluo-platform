// ── Connections — tenant side: list, pause, resume, revoke (ours) ─────────────
//
// Used by the client dashboard's "Connected apps" screen (UI in step 4c).
// Every function checks `connections.manage` on the Connection's OWN project
// (looked up server-side — the caller's project id is never trusted), and
// support mode may look but never change anything.

import { can, type AuthzSubject } from '@/lib/authz/check'
import { endAllCredentials, revokeConnectionNow } from './lifecycle'
import { systemClock, type Clock } from './policy'
import type { ConnectionsStore } from './store'
import type { ConnectionRow, ConnectionStatus, SharedResources } from './types'

type Subject = (AuthzSubject & { userId: string }) | null | undefined
export type ManageError = 'forbidden' | 'support_mode' | 'not_found' | 'invalid_state'
export type ManageResult = { ok: true; status: ConnectionStatus } | { ok: false; error: ManageError }

export interface ConnectionSummary {
  id: string
  appName: string
  status: ConnectionStatus
  statusReason: string | null
  resources: SharedResources
  sandbox: boolean
  connectedAt: string
  consentBy: string
}

/** Paused by the tenant (resumable by the tenant) vs paused by Abluo (app suspended). */
export const PAUSED_BY_TENANT = 'tenant'
export const PAUSED_BY_APP_SUSPENSION = 'app_suspended'

export async function listProjectConnections(
  subject: Subject,
  projectId: string,
  deps: { store: ConnectionsStore },
): Promise<{ ok: true; connections: ConnectionSummary[] } | { ok: false; error: 'forbidden' }> {
  if (!subject || !can(subject, 'connections.manage', { kind: 'project', projectId })) return { ok: false, error: 'forbidden' }
  const rows = await deps.store.listConnectionsForProject(projectId)
  const out: ConnectionSummary[] = []
  for (const r of rows) {
    // Defence in depth: a store bug returning another project's row is dropped.
    if (r.project_id !== projectId) continue
    const app = await deps.store.getAppById(r.app_id)
    out.push({
      id: r.id,
      appName: app?.name ?? '—',
      status: r.status,
      statusReason: r.status_reason,
      resources: r.resources,
      sandbox: r.sandbox,
      connectedAt: r.created_at,
      consentBy: r.consent.by,
    })
  }
  return { ok: true, connections: out }
}

async function loadForChange(subject: Subject, connectionId: string, store: ConnectionsStore): Promise<ConnectionRow | ManageError> {
  if (!subject) return 'forbidden'
  const row = await store.getConnection(connectionId)
  if (!row) return 'not_found'
  if (!can(subject, 'connections.manage', { kind: 'project', projectId: row.project_id })) return 'not_found' // never confirm another project's ids
  if (subject.support) return 'support_mode'
  return row
}

export async function pauseConnection(
  subject: Subject,
  connectionId: string,
  deps: { store: ConnectionsStore; clock?: Clock },
): Promise<ManageResult> {
  const row = await loadForChange(subject, connectionId, deps.store)
  if (typeof row === 'string') return { ok: false, error: row }
  if (row.status !== 'active') return { ok: false, error: 'invalid_state' }
  const now = (deps.clock ?? systemClock)()
  const updated = await deps.store.updateConnection(row.id, { status: 'paused', status_reason: PAUSED_BY_TENANT }, ['active'])
  if (!updated) return { ok: false, error: 'invalid_state' }
  // Tokens stay (resume needs no reconnect) but every check refuses while
  // paused; pending codes are burned.
  await deps.store.consumeCodesForConnection(row.id, now.toISOString())
  await deps.store.audit({ action: 'connection.pause', actorId: subject!.userId, projectId: row.project_id, detail: { connectionId: row.id } })
  return { ok: true, status: 'paused' }
}

export async function resumeConnection(
  subject: Subject,
  connectionId: string,
  deps: { store: ConnectionsStore },
): Promise<ManageResult> {
  const row = await loadForChange(subject, connectionId, deps.store)
  if (typeof row === 'string') return { ok: false, error: row }
  // Only a pause the tenant made; an Abluo suspension is lifted by Abluo.
  if (row.status !== 'paused' || row.status_reason !== PAUSED_BY_TENANT) return { ok: false, error: 'invalid_state' }
  const app = await deps.store.getAppById(row.app_id)
  if (!app || app.status !== 'approved') return { ok: false, error: 'invalid_state' }
  const updated = await deps.store.updateConnection(row.id, { status: 'active', status_reason: null }, ['paused'])
  if (!updated) return { ok: false, error: 'invalid_state' }
  await deps.store.audit({ action: 'connection.resume', actorId: subject!.userId, projectId: row.project_id, detail: { connectionId: row.id } })
  return { ok: true, status: 'active' }
}

export async function revokeConnection(
  subject: Subject,
  connectionId: string,
  deps: { store: ConnectionsStore; clock?: Clock },
): Promise<ManageResult> {
  const row = await loadForChange(subject, connectionId, deps.store)
  if (typeof row === 'string') return { ok: false, error: row }
  if (row.status === 'revoked') return { ok: false, error: 'invalid_state' }
  const now = (deps.clock ?? systemClock)()
  const updated = await revokeConnectionNow(deps.store, row, 'revoked_by_tenant', now)
  if (!updated) {
    // Lost a race with another change: still make sure nothing stays usable.
    await endAllCredentials(deps.store, row.id, now)
    return { ok: false, error: 'invalid_state' }
  }
  await deps.store.audit({ action: 'connection.revoke', actorId: subject!.userId, projectId: row.project_id, detail: { connectionId: row.id } })
  return { ok: true, status: 'revoked' }
}
