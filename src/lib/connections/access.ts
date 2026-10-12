// ── Connections — authenticate a partner API request (ours) ───────────────────
//
// Every `/api/v1/*` call (step 5) starts here. Opaque token → SHA-256 → row →
// checks, on EVERY request, so a pause or revoke takes effect on the very next
// call (no JWT that stays valid until it expires):
//   token is an access token, not revoked, not expired
//   → its Connection is `active`
//   → its partner app is `approved`
// The result is a ConnectionGrant: one project, the granted resources/fields.
// Nothing about people, members, billing or other projects is reachable from it.

import { isSecretOfKind, sha256Hex } from './crypto'
import { TOUCH_INTERVAL_MS, systemClock, type Clock } from './policy'
import type { ConnectionsStore } from './store'
import type { ConnectionGrant } from './types'

export type AccessResult =
  | { ok: true; grant: ConnectionGrant; tokenId: string }
  | { ok: false; status: 401; error: 'invalid_token'; wwwAuthenticate: string }

const deny = (description: string): AccessResult => ({
  ok: false,
  status: 401,
  error: 'invalid_token',
  // RFC 6750 §3. One generic description: the caller learns nothing about why.
  wwwAuthenticate: `Bearer realm="abluo", error="invalid_token", error_description="${description}"`,
})

export async function authenticateConnectionRequest(
  authorization: string | null | undefined,
  deps: { store: ConnectionsStore; clock?: Clock },
): Promise<AccessResult> {
  const clock = deps.clock ?? systemClock
  const m = /^Bearer ([^\s]+)$/i.exec((authorization ?? '').trim()) // scheme is case-insensitive (RFC 7235)
  const token = m?.[1]
  if (!isSecretOfKind(token, 'accessToken')) return deny('The access token is missing or malformed')

  const { store } = deps
  const row = await store.getTokenByHash(sha256Hex(token))
  const now = clock()
  if (!row || row.kind !== 'access' || row.revoked_at || new Date(row.expires_at) <= now) {
    return deny('The access token is invalid, expired or revoked')
  }
  const connection = await store.getConnection(row.connection_id)
  if (!connection || connection.status !== 'active' || connection.revoked_at) {
    return deny('The access token is invalid, expired or revoked')
  }
  const app = await store.getAppById(connection.app_id)
  if (!app || app.status !== 'approved') return deny('The access token is invalid, expired or revoked')

  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > TOUCH_INTERVAL_MS) {
    // Best effort: a failed touch never fails the request.
    await store.touchToken(row.id, now.toISOString()).catch(() => undefined)
  }

  return {
    ok: true,
    tokenId: row.id,
    grant: {
      connectionId: connection.id,
      appId: app.id,
      tenantId: connection.tenant_id,
      projectId: connection.project_id,
      locationKeys: [...connection.location_keys],
      resources: structuredClone(connection.resources),
      sandbox: connection.sandbox,
    },
  }
}
