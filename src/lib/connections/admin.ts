// ── Connections — Abluo side: register, approve, suspend partner apps (ours) ──
//
// Abluo admins only (`partners.manage`, platform scope). The client secret is
// generated here, returned ONCE to the admin screen for the partner to copy
// into its own server configuration, and only its SHA-256 is stored. It is
// never emailed (ADR-031 D2) and cannot be shown again (secret rotation for a
// lost secret arrives with the admin screen, step 4c).

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
