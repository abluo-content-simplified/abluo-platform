// ── Connections — POST /api/oauth/token (framework-free core) ─────────────────
//
// Order of work for every request:
//   1. OUR pre-checks (independent of the library):
//      form encoding, no repeated parameters, client authenticated with its
//      secret (approved apps only), and for `authorization_code`: the code is
//      consumed ATOMICALLY first, then checked — client, expiry, PKCE verifier
//      shape + S256 match, exact redirect URI, Connection active. Any failure
//      after consumption leaves the code burned (no second attempt).
//      A code presented twice ends every token of its Connection (RFC 6749
//      §4.1.2) and marks it "needs reconnect".
//   2. The LIBRARY runs the grant with our model, repeating its own checks.
//   3. Errors are normalised; server errors never leak internals.
//
// The route handler (src/app/api/oauth/token/route.ts) only adapts HTTP.

import OAuth2Server from '@node-oauth/oauth2-server'
import { authenticateClient, readClientCredentials } from './clients'
import { isSecretOfKind, sha256Hex, verifierMatchesChallenge } from './crypto'
import { forceReconnect } from './lifecycle'
import { createOAuthModel, type PrecheckedCode } from './model'
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, systemClock, type Clock } from './policy'
import type { ConnectionsStore } from './store'

export interface OAuthHttpRequest {
  method: string
  headers: Record<string, string | undefined>
  rawBody: string
}

export interface OAuthHttpResponse {
  status: number
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface EndpointDeps {
  store: ConnectionsStore
  clock?: Clock
}

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache', 'content-type': 'application/json' }

export function oauthError(status: number, error: string, description?: string, extra: Record<string, string> = {}): OAuthHttpResponse {
  return {
    status,
    headers: { ...NO_STORE, ...extra },
    body: description ? { error, error_description: description } : { error },
  }
}

const invalidClient = (viaBasic: boolean) =>
  oauthError(401, 'invalid_client', 'Client authentication failed', viaBasic ? { 'www-authenticate': 'Basic realm="abluo"' } : {})
const invalidGrant = () => oauthError(400, 'invalid_grant', 'The grant is invalid, expired or already used')

/** Parse an x-www-form-urlencoded body; null when any parameter repeats (RFC 6749 §3.2). */
export function parseForm(contentType: string | undefined, rawBody: string): URLSearchParams | null {
  if (!contentType || !/^application\/x-www-form-urlencoded(\s*;.*)?$/i.test(contentType.trim())) return null
  const form = new URLSearchParams(rawBody)
  const seen = new Set<string>()
  for (const k of form.keys()) {
    if (seen.has(k)) return null
    seen.add(k)
  }
  return form
}

export async function handleTokenRequest(req: OAuthHttpRequest, deps: EndpointDeps): Promise<OAuthHttpResponse> {
  const { store } = deps
  const clock = deps.clock ?? systemClock
  if (req.method !== 'POST') return oauthError(405, 'invalid_request', 'POST only', { allow: 'POST' })

  const form = parseForm(req.headers['content-type'], req.rawBody)
  if (!form) return oauthError(400, 'invalid_request', 'Form-encoded body with unique parameters required')

  // ── OURS: client authentication (secret always required) ──────────────────
  const authz = req.headers['authorization']
  const creds = readClientCredentials(authz, form)
  if ('error' in creds) return creds.error === 'invalid_request' ? oauthError(400, 'invalid_request', 'Use one client authentication method') : invalidClient(Boolean(authz))
  const app = await authenticateClient(store, creds.clientId, creds.clientSecret)
  if (!app) return invalidClient(Boolean(authz))

  const grantType = form.get('grant_type')
  let prechecked: PrecheckedCode | undefined

  if (grantType === 'authorization_code') {
    // ── OURS: consume first, then check ───────────────────────────────────
    const code = form.get('code')
    if (!isSecretOfKind(code, 'authorizationCode')) return invalidGrant()
    const now = clock()
    const consumed = await store.consumeCode(sha256Hex(code), now.toISOString())
    if (consumed.state === 'missing') return invalidGrant()
    if (consumed.state === 'replayed') {
      const connection = await store.getConnection(consumed.row.connection_id)
      if (connection && connection.status !== 'revoked') {
        await forceReconnect(store, connection, 'authorization_code_replay', now)
        await store.audit({
          action: 'connection.code.replay',
          actorId: null,
          projectId: connection.project_id,
          detail: { connectionId: connection.id, appId: consumed.row.app_id },
        })
      }
      return invalidGrant()
    }
    const row = consumed.row
    if (row.app_id !== app.id) return invalidGrant() // a code stolen by another app is burned, not usable
    if (new Date(row.expires_at) <= now) return invalidGrant()
    const verifier = form.get('code_verifier')
    if (!verifierMatchesChallenge(verifier ?? '', row.code_challenge)) return invalidGrant()
    const redirectUri = form.get('redirect_uri')
    if (!redirectUri || redirectUri !== row.redirect_uri || !app.redirect_uris.includes(redirectUri)) return invalidGrant()
    const connection = await store.getConnection(row.connection_id)
    if (!connection || connection.status !== 'active' || connection.app_id !== app.id) return invalidGrant()
    prechecked = { code, row, connection }
  } else if (grantType === 'refresh_token') {
    if (!isSecretOfKind(form.get('refresh_token'), 'refreshToken')) return invalidGrant()
  } else {
    return oauthError(400, 'unsupported_grant_type')
  }

  // ── LIBRARY: run the grant with our model ───────────────────────────────
  const server = new OAuth2Server({
    model: createOAuthModel({ store, clock, prechecked }),
    accessTokenLifetime: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenLifetime: REFRESH_TOKEN_TTL_SECONDS,
    alwaysIssueNewRefreshToken: true,
    allowExtendedTokenAttributes: false,
  })
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v
  headers['content-length'] = String(Buffer.byteLength(req.rawBody))
  const body: Record<string, string> = {}
  for (const [k, v] of form) body[k] = v
  const request = new OAuth2Server.Request({ method: 'POST', headers, query: {}, body })
  const response = new OAuth2Server.Response({ headers: {} })

  try {
    await server.token(request, response)
    const out = response.body as Record<string, unknown>
    // Never echo anything but the RFC 6749 §5.1 fields.
    const safe: Record<string, unknown> = {
      access_token: out.access_token,
      token_type: 'Bearer',
      expires_in: out.expires_in,
      refresh_token: out.refresh_token,
    }
    return { status: 200, headers: { ...NO_STORE }, body: safe }
  } catch (err) {
    if (err instanceof OAuth2Server.OAuthError && err.code < 500) {
      const status = err.code === 401 ? 401 : 400
      return oauthError(status, err.name, err.message, err.code === 401 ? { 'www-authenticate': 'Basic realm="abluo"' } : {})
    }
    console.error('oauth token: server error', err instanceof Error ? err.message : String(err))
    return oauthError(500, 'server_error')
  }
}
