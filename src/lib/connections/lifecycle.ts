// ── Connections — state changes shared by every path (ours) ───────────────────
//
// One place that ends things, so "revoke" means the same everywhere: the
// tenant's Revoke button, the partner's /api/oauth/revoke, reuse detection
// and code replay all call these.

import type { ConnectionsStore } from './store'
import type { ConnectionRow, ConnectionStatus } from './types'

/** Revoke every token and burn every unused code of a connection. Returns tokens revoked. */
export async function endAllCredentials(store: ConnectionsStore, connectionId: string, at: Date): Promise<number> {
  const iso = at.toISOString()
  // Independent writes: run together (disconnect should feel instant).
  const [n] = await Promise.all([store.revokeTokens({ connectionId }, iso), store.consumeCodesForConnection(connectionId, iso)])
  return n
}

/**
 * Theft response (refresh reuse, code replay, partner revoked its refresh
 * token): every token ends and the tenant sees "needs reconnect". A revoked
 * connection stays revoked (migration 040 refuses to bring it back anyway).
 */
export async function forceReconnect(
  store: ConnectionsStore,
  connection: ConnectionRow,
  reason: string,
  at: Date,
): Promise<void> {
  await endAllCredentials(store, connection.id, at)
  const movable: ConnectionStatus[] = ['active', 'paused']
  await store.updateConnection(connection.id, { status: 'needs_reconnect', status_reason: reason.slice(0, 200) }, movable)
}

/** Final: status revoked, every token and code ended. */
export async function revokeConnectionNow(
  store: ConnectionsStore,
  connection: ConnectionRow,
  reason: string,
  at: Date,
): Promise<ConnectionRow | null> {
  // Status first: from this instant every access check refuses, even before
  // the token rows are updated.
  const updated = await store.updateConnection(
    connection.id,
    { status: 'revoked', status_reason: reason.slice(0, 200), revoked_at: at.toISOString() },
    ['active', 'paused', 'needs_reconnect'],
  )
  await endAllCredentials(store, connection.id, at)
  return updated
}
