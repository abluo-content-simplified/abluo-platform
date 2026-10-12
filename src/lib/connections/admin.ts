// ── Connections — Abluo side: register, approve, suspend partner apps (ours) ──
//
// Abluo admins only (`partners.manage`, platform scope). The client secret is
// generated here, returned ONCE to the admin screen for the partner to copy
// into its own server configuration, and only its SHA-256 is stored. It is
// never emailed (ADR-031 D2) and cannot be shown again — a lost secret is
// replaced with `rotateAppSecret` (the new one is again shown once).

import { can, type AuthzSubject } from '@/lib/authz/check'
import { generateSecret, sha256Hex } from './crypto'
import { PAUSED_BY_APP_SUSPENSION } from './manage'
import { systemClock, type Clock } from './policy'
import type { ConnectionsStore } from './store'
import type { PartnerAppRow } from './types'

type Subject = (AuthzSubject & { userId: string }) | null | undefined
const isPartnerAdmin = (s: Subject) => Boolean(s && !s.support && can(s, 'partners.manage', { kind: 'platform' }))

const REDIRECT_RE = [/^https:\/\/[a-z0-9.-]+(:[0-9]{2,5})?(\/[^\s#*]*)?$/, /^http:\/\/localhost(:[0-9]{2,5})?(\/[^\s#*]*)?$/]
/** Same rule as migration 040's trigger: exact https, or http://localhost for sandbox. No wildcards, no fragments. */
export function isAllowedRedirectUri(uri: string): boolean {
  return REDIRECT_RE.some((re) => re.test(uri))
}

export async function registerApp(
  subject: Subject,
  input: { name: string; redirectUris: string[]; contactEmail?: string | null; termsVersion?: string | null },
  deps: { store: ConnectionsStore },
): Promise<{ ok: true; app: PartnerAppRow; clientSecret: string } | { ok: false; error: 'forbidden' | 'invalid_input' }> {
  if (!isPartnerAdmin(subject)) return { ok: false, error: 'forbidden' }
  const name = input.name?.trim() ?? ''
  const uris = [...new Set(input.redirectUris ?? [])]
  if (!name || name.length > 120 || uris.length < 1 || uris.length > 10 || !uris.every(isAllowedRedirectUri)) {
    return { ok: false, error: 'invalid_input' }
  }
  const clientSecret = generateSecret('clientSecret')
  const app = await deps.store.insertApp({
    name,
    client_id: generateSecret('clientId'),
    client_secret_hash: sha256Hex(clientSecret),
    redirect_uris: uris,
    status: 'pending',
    terms_version: input.termsVersion ?? null,
    contact_email: input.contactEmail ?? null,
    created_by: subject!.userId,
  })
  await deps.store.audit({ action: 'connection.app.register', actorId: subject!.userId, projectId: null, detail: { appId: app.id, name } })
  return { ok: true, app, clientSecret }
}

export async function approveApp(
  subject: Subject,
  appId: string,
  deps: { store: ConnectionsStore; clock?: Clock },
): Promise<{ ok: true; resumed: number } | { ok: false; error: 'forbidden' | 'not_found' | 'invalid_state' }> {
  if (!isPartnerAdmin(subject)) return { ok: false, error: 'forbidden' }
  const app = await deps.store.getAppById(appId)
  if (!app) return { ok: false, error: 'not_found' }
  if (app.status === 'approved') return { ok: false, error: 'invalid_state' }
  const now = (deps.clock ?? systemClock)().toISOString()
  await deps.store.updateApp(app.id, { status: 'approved', approved_by: subject!.userId, approved_at: now })
  // Lifting a suspension resumes exactly the Connections the suspension paused.
  let resumed = 0
  for (const c of await deps.store.listConnectionsForApp(app.id)) {
    if (c.status === 'paused' && c.status_reason === PAUSED_BY_APP_SUSPENSION) {
      if (await deps.store.updateConnection(c.id, { status: 'active', status_reason: null }, ['paused'])) resumed++
    }
  }
  await deps.store.audit({ action: 'connection.app.approve', actorId: subject!.userId, projectId: null, detail: { appId: app.id, resumed } })
  return { ok: true, resumed }
}

/**
 * Replace a lost or leaked client secret. The old secret stops working at
 * once (every token exchange and revoke authenticates with it); tokens already
 * issued are not affected — suspend the app to stop those too.
 */
export async function rotateAppSecret(
  subject: Subject,
  appId: string,
  deps: { store: ConnectionsStore },
): Promise<{ ok: true; clientSecret: string } | { ok: false; error: 'forbidden' | 'not_found' }> {
  if (!isPartnerAdmin(subject)) return { ok: false, error: 'forbidden' }
  const app = await deps.store.getAppById(appId)
  if (!app) return { ok: false, error: 'not_found' }
  const clientSecret = generateSecret('clientSecret')
  await deps.store.updateApp(app.id, { client_secret_hash: sha256Hex(clientSecret) })
  await deps.store.audit({ action: 'connection.app.secret_rotate', actorId: subject!.userId, projectId: null, detail: { appId: app.id } })
  return { ok: true, clientSecret }
}

export interface PartnerAppOverview {
  id: string
  name: string
  clientId: string
  status: PartnerAppRow['status']
  redirectUris: string[]
  contactEmail: string | null
  createdAt: string
  approvedAt: string | null
  connections: { id: string; projectId: string; projectName: string; status: string; statusReason: string | null; sandbox: boolean; createdAt: string }[]
}

/** Every app and every live Connection across all clients (ADR-031 D8.2). Never a secret or hash. */
export async function listPartnerApps(
  subject: Subject,
  deps: { store: ConnectionsStore },
): Promise<{ ok: true; apps: PartnerAppOverview[] } | { ok: false; error: 'forbidden' }> {
  if (!isPartnerAdmin(subject)) return { ok: false, error: 'forbidden' }
  const apps = await deps.store.listApps()
  const names = new Map<string, string>()
  const out: PartnerAppOverview[] = []
  for (const a of apps) {
    const rows = (await deps.store.listConnectionsForApp(a.id)).filter((c) => c.status !== 'revoked')
    const connections: PartnerAppOverview['connections'] = []
    for (const c of rows) {
      if (!names.has(c.project_id)) names.set(c.project_id, (await deps.store.getProject(c.project_id))?.name ?? c.project_id)
      connections.push({
        id: c.id,
        projectId: c.project_id,
        projectName: names.get(c.project_id)!,
        status: c.status,
        statusReason: c.status_reason,
        sandbox: c.sandbox,
        createdAt: c.created_at,
      })
    }
    out.push({
      id: a.id,
      name: a.name,
      clientId: a.client_id,
      status: a.status,
      redirectUris: [...a.redirect_uris],
      contactEmail: a.contact_email,
      createdAt: a.created_at,
      approvedAt: a.approved_at,
      connections,
    })
  }
  return { ok: true, apps: out }
}

/** Suspend globally: every active Connection of the app pauses at once (D8.2). */
export async function suspendApp(
  subject: Subject,
  appId: string,
  deps: { store: ConnectionsStore },
): Promise<{ ok: true; paused: number } | { ok: false; error: 'forbidden' | 'not_found' | 'invalid_state' }> {
  if (!isPartnerAdmin(subject)) return { ok: false, error: 'forbidden' }
  const app = await deps.store.getAppById(appId)
  if (!app) return { ok: false, error: 'not_found' }
  if (app.status !== 'approved') return { ok: false, error: 'invalid_state' }
  // App status first: from this instant every token check and token exchange refuses.
  await deps.store.updateApp(app.id, { status: 'suspended' })
  let paused = 0
  for (const c of await deps.store.listConnectionsForApp(app.id)) {
    if (c.status === 'active' && (await deps.store.updateConnection(c.id, { status: 'paused', status_reason: PAUSED_BY_APP_SUSPENSION }, ['active']))) paused++
  }
  await deps.store.audit({ action: 'connection.app.suspend', actorId: subject!.userId, projectId: null, detail: { appId: app.id, paused } })
  return { ok: true, paused }
}
