// ── Connections — POST /api/oauth/revoke (RFC 7009), entirely ours ────────────
//
// The library has no revocation endpoint. Rules:
//   - the client authenticates with its secret (approved apps only);
//   - a token is revoked only when it belongs to a Connection of THAT app;
//     anything else (unknown, other app's, already revoked) still answers 200
//     with no body, so the endpoint reveals nothing (RFC 7009 §2.2);
//   - an access token ends alone; a refresh token ends the whole credential
//     chain and the Connection shows "needs reconnect" to the tenant.

import { authenticateClient, readClientCredentials } from './clients'
import { isSecretOfKind, sha256Hex } from './crypto'
import { forceReconnect } from './lifecycle'
import { systemClock } from './policy'
import { oauthError, parseForm, type EndpointDeps, type OAuthHttpRequest, type OAuthHttpResponse } from './token-endpoint'

const OK: OAuthHttpResponse = { status: 200, headers: { 'cache-control': 'no-store', pragma: 'no-cache' }, body: {} }

export async function handleRevokeRequest(req: OAuthHttpRequest, deps: EndpointDeps): Promise<OAuthHttpResponse> {
  const { store } = deps
  const clock = deps.clock ?? systemClock
  if (req.method !== 'POST') return oauthError(405, 'invalid_request', 'POST only', { allow: 'POST' })
  const form = parseForm(req.headers['content-type'], req.rawBody)
  if (!form) return oauthError(400, 'invalid_request', 'Form-encoded body with unique parameters required')

  const authz = req.headers['authorization']
  const creds = readClientCredentials(authz, form)
  if ('error' in creds) return oauthError(creds.error === 'invalid_request' ? 400 : 401, creds.error)
  const app = await authenticateClient(store, creds.clientId, creds.clientSecret)
  if (!app) return oauthError(401, 'invalid_client', undefined, authz ? { 'www-authenticate': 'Basic realm="abluo"' } : {})

  const token = form.get('token')
  if (!isSecretOfKind(token, 'accessToken') && !isSecretOfKind(token, 'refreshToken')) return OK
  const row = await store.getTokenByHash(sha256Hex(token))
  if (!row || row.revoked_at) return OK
  const connection = await store.getConnection(row.connection_id)
  if (!connection || connection.app_id !== app.id) return OK // never touch another app's token

  const now = clock()
  if (row.kind === 'access') {
    await store.revokeTokens({ connectionId: connection.id, ids: [row.id] }, now.toISOString())
  } else if (connection.status !== 'revoked') {
    await forceReconnect(store, connection, 'revoked_by_partner', now)
  }
  await store.audit({
    action: 'connection.token.revoke',
    actorId: null,
    projectId: connection.project_id,
    detail: { connectionId: connection.id, kind: row.kind, tokenPrefix: row.token_prefix, by: 'partner' },
  })
  return OK
}
