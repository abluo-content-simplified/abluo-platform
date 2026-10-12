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
import { SHAREABLE_RESOURCES } from './resources'

type Subject = (AuthzSubject & { userId: string }) | null | undefined
export type ManageError = 'forbidden' | 'support_mode' | 'not_found' | 'invalid_state'
export type ManageResult = { ok: true; status: ConnectionStatus } | { ok: false; error: ManageError }

export interface ConnectionSummary {
  id: string
  appId: string
  appName: string
  status: ConnectionStatus
  statusReason: string | null
  resources: SharedResources
  sandbox: boolean
  connectedAt: string
  /** When what is shared was last approved (consent). */
  consentAt: string
  consentBy: string
  /** Last API call by this app for this site; null = not used yet. */
  lastUsedAt: string | null
  /** Allowed by the person, but the app has not finished connecting (no token yet). */
  awaitingApp: boolean
  /** What it reads, in plain terms: per resource, all public details or a selection, and whether people's names are included. */
  reads: ReadsSummary[]
}

export interface ReadsSummary {
  resource: string
  scope: 'all' | 'some'
  personal: boolean
}

/** Plain-language summary of a grant (no field counts on screen). */
export function summarizeReads(resources: SharedResources): ReadsSummary[] {
  const out: ReadsSummary[] = []
  for (const [name, spec] of Object.entries(resources)) {
    const def = (SHAREABLE_RESOURCES as Record<string, { public: readonly string[]; personal: readonly string[] } | undefined>)[name]
    if (!def) continue
    const fields = new Set(spec.fields)
    out.push({
      resource: name,
      scope: def.public.every((f) => fields.has(f)) ? 'all' : 'some',
      personal: def.personal.some((f) => fields.has(f)),
    })
  }
  return out
}

import { PAUSED_BY_TENANT } from './manage-constants'
export { PAUSED_BY_APP_SUSPENSION, PAUSED_BY_TENANT } from './manage-constants'

export async function listProjectConnections(
  subject: Subject,
  projectId: string,
  deps: { store: ConnectionsStore },
): Promise<{ ok: true; connections: ConnectionSummary[] } | { ok: false; error: 'forbidden' }> {
  if (!subject || !can(subject, 'connections.manage', { kind: 'project', projectId })) return { ok: false, error: 'forbidden' }
  const rows = (await deps.store.listConnectionsForProject(projectId)).filter(
    // Defence in depth: a store bug returning another project's row is dropped.
    // Disconnected ones are history (audit log); connecting again starts fresh.
    (r) => r.project_id === projectId && r.status !== 'revoked',
  )
  const out = await Promise.all(rows.map(async (r): Promise<ConnectionSummary> => {
    const [app, lastUsedAt, issued] = await Promise.all([
      deps.store.getAppById(r.app_id),
      deps.store.lastUsedAt(r.id),
      r.status === 'active' ? deps.store.hasIssuedTokens(r.id) : Promise.resolve(true),
    ])
    return {
      id: r.id,
      appId: r.app_id,
      appName: app?.name ?? '—',
      status: r.status,
      statusReason: r.status_reason,
      resources: r.resources,
      sandbox: r.sandbox,
      connectedAt: r.created_at,
      consentAt: typeof r.consent.at === 'string' ? r.consent.at : r.created_at,
      consentBy: r.consent.by,
      lastUsedAt,
      awaitingApp: !issued,
      reads: summarizeReads(r.resources),
    }
  }))
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
