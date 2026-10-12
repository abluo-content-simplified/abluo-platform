// ── Connections — partner client authentication (ours) ────────────────────────
//
// Every partner is a CONFIDENTIAL client: it authenticates with its client id
// AND secret on every token / revoke call — including PKCE exchanges, where
// the OAuth library would otherwise accept a client id alone (it treats PKCE
// as a public-client flow). Only approved apps authenticate.

import { isSecretOfKind, secretMatchesHash, sha256Hex } from './crypto'
import type { ConnectionsStore } from './store'
import type { PartnerAppRow } from './types'

// A fixed digest compared when the client id is unknown, so "unknown app" and
// "wrong secret" take the same time.
const DUMMY_HASH = sha256Hex('abluo-connections-no-such-client')

export async function authenticateClient(
  store: ConnectionsStore,
  clientId: unknown,
  clientSecret: unknown,
): Promise<PartnerAppRow | null> {
  if (!isSecretOfKind(clientId, 'clientId')) return null
  if (!isSecretOfKind(clientSecret, 'clientSecret')) return null
  const app = await store.getAppByClientId(clientId)
  const ok = secretMatchesHash(clientSecret, app?.client_secret_hash ?? DUMMY_HASH)
  if (!app || !ok) return null
  if (app.status !== 'approved') return null
  return app
}

export type ClientCredentials = { clientId: string; clientSecret: string } | { error: 'invalid_request' | 'invalid_client' }

/**
 * Credentials from HTTP Basic or the form body — exactly one method
 * (RFC 6749 §2.3: a client MUST NOT use more than one).
 */
export function readClientCredentials(authorization: string | null | undefined, form: URLSearchParams): ClientCredentials {
  const bodyId = form.get('client_id')
  const bodySecret = form.get('client_secret')
  if (authorization) {
    if (bodySecret) return { error: 'invalid_request' }
    const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec(authorization.trim())
    if (!m) return { error: 'invalid_client' }
    const decoded = Buffer.from(m[1], 'base64').toString('utf8')
    const i = decoded.indexOf(':')
    if (i < 0) return { error: 'invalid_client' }
    // RFC 6749 §2.3.1: id and secret are form-urlencoded inside Basic.
    let id: string
    let secret: string
    try {
      id = decodeURIComponent(decoded.slice(0, i).replace(/\+/g, ' '))
      secret = decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, ' '))
    } catch {
      return { error: 'invalid_client' }
    }
    if (bodyId && bodyId !== id) return { error: 'invalid_request' }
    return { clientId: id, clientSecret: secret }
  }
  if (bodyId && bodySecret) return { clientId: bodyId, clientSecret: bodySecret }
  return { error: 'invalid_client' }
}
