// ── Connections — the model the OAuth library calls (ADR-031 Amendment B) ─────
//
// `@node-oauth/oauth2-server` runs the PROTOCOL; this model is OUR storage and
// policy behind it. Who does what is listed in
// docs/engineering/connections/oauth-security-responsibilities.md — in short:
//
//   LIBRARY (5.3.0): grant-type dispatch, request shape (POST, form encoding),
//     client_id/secret extraction, code ↔ client match, expiry checks, PKCE
//     S256 verification (timing-safe, after consuming the code), redirect URI
//     equality, refresh token ↔ client match, error responses (RFC 6749 §5.2),
//     `Cache-Control: no-store`.
//   OURS (this file + token-endpoint.ts): what a client, code and token ARE —
//     secret hashing and comparison, approved-apps-only, codes consumed
//     atomically on the first attempt, the Connection status on every
//     exchange and refresh, rotation, the grace window, reuse detection,
//     superseding old tokens on reconnect, audit.
//
// A per-request model: `prechecked` carries the authorization code that
// token-endpoint.ts already consumed and verified, so the library's own checks
// run as a SECOND layer on the same row.

import OAuth2Server from '@node-oauth/oauth2-server'
import { authenticateClient } from './clients'
import { generateSecret, isSecretOfKind, sha256Hex, tokenPrefix } from './crypto'
import { forceReconnect } from './lifecycle'
import { ALLOWED_GRANTS, REFRESH_GRACE_MS, type Clock } from './policy'
import type { ConnectionsStore } from './store'
import type { ConnectionRow, OAuthCodeRow, PartnerAppRow } from './types'

const { InvalidGrantError } = OAuth2Server

/** The library's "user": for us, always the Connection — never a person. */
export interface ConnectionPrincipal {
  connectionId: string
  projectId: string
  tenantId: string
  /** Set on a refresh: the refresh token being rotated. */
  rotation?: { fromTokenId: string; grace: boolean; retiredAt: string | null; replacedBy: string | null }
}

export interface PartnerClient extends OAuth2Server.Client {
  id: string
  appId: string
  grants: string[]
}

export interface PrecheckedCode {
  /** The code exactly as presented (hash already matched). */
  code: string
  row: OAuthCodeRow
  connection: ConnectionRow
}

export interface ModelContext {
  store: ConnectionsStore
  clock: Clock
  prechecked?: PrecheckedCode
}

function toClient(app: PartnerAppRow): PartnerClient {
  return { id: app.client_id, appId: app.id, grants: [...ALLOWED_GRANTS], redirectUris: app.redirect_uris }
}

function principal(c: ConnectionRow): ConnectionPrincipal {
  return { connectionId: c.id, projectId: c.project_id, tenantId: c.tenant_id }
}

export function createOAuthModel(ctx: ModelContext): OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel {
  const { store, clock } = ctx

  return {
    async getClient(clientId: string, clientSecret: string) {
      // Secret ALWAYS required (confidential clients), even on PKCE exchanges.
      const app = await authenticateClient(store, clientId, clientSecret)
      return app ? toClient(app) : null
    },

    async generateAccessToken() {
      return generateSecret('accessToken')
    },

    async generateRefreshToken() {
      return generateSecret('refreshToken')
    },

    // ── authorization_code ────────────────────────────────────────────────
    async getAuthorizationCode(code: string) {
      // Only the code token-endpoint.ts consumed for THIS request is known
      // here; anything else is invalid. The database row is already marked used.
      const p = ctx.prechecked
      if (!p || !isSecretOfKind(code, 'authorizationCode') || sha256Hex(code) !== p.row.code_hash) return null
      const app = await store.getAppById(p.row.app_id)
      if (!app || app.status !== 'approved') return null
      return {
        authorizationCode: code,
        expiresAt: new Date(p.row.expires_at),
        redirectUri: p.row.redirect_uri,
        codeChallenge: p.row.code_challenge,
        codeChallengeMethod: 'S256',
        client: toClient(app),
        user: principal(p.connection),
      }
    },

    async revokeAuthorizationCode(code: OAuth2Server.AuthorizationCode) {
      // Consumed atomically before the library ran (first attempt burns it).
      const p = ctx.prechecked
      return Boolean(p && sha256Hex(code.authorizationCode) === p.row.code_hash)
    },

    async saveAuthorizationCode() {
      // Codes are issued by OUR consent screen (consent.ts), never by the library.
      return null
    },

    // ── refresh_token ─────────────────────────────────────────────────────
    async getRefreshToken(refreshToken: string) {
      if (!isSecretOfKind(refreshToken, 'refreshToken')) return null
      const row = await store.getTokenByHash(sha256Hex(refreshToken))
      if (!row || row.kind !== 'refresh' || row.revoked_at) return null
      const connection = await store.getConnection(row.connection_id)
      if (!connection) return null
      const app = await store.getAppById(connection.app_id)
      if (!app || app.status !== 'approved') return null
      const now = clock()

      let grace = false
      if (row.retired_at) {
        const successor = row.replaced_by ? await store.getTokenById(row.replaced_by) : null
        const withinGrace = now.getTime() - new Date(row.retired_at).getTime() <= REFRESH_GRACE_MS
        // Retired but no successor yet = a concurrent refresh is mid-flight:
        // refuse this one (invalid_grant), but it is not theft.
        if (withinGrace && !row.replaced_by) return null
        // A lost-response retry: recent, and the new token has not been used yet.
        grace = withinGrace && connection.status === 'active' && !!successor && !successor.retired_at && !successor.revoked_at
        if (!grace) {
          // Reuse of a retired refresh token = presumed theft (ADR-031 D2).
          await forceReconnect(store, connection, 'refresh_token_reuse', now)
          await store.audit({
            action: 'connection.token.reuse',
            actorId: null,
            projectId: connection.project_id,
            detail: { connectionId: connection.id, tokenPrefix: row.token_prefix },
          })
          return null
        }
      }

      if (connection.status !== 'active') return null
      if (new Date(row.expires_at) <= now) return null

      const user: ConnectionPrincipal = {
        ...principal(connection),
        rotation: { fromTokenId: row.id, grace, retiredAt: row.retired_at, replacedBy: row.replaced_by },
      }
      return { refreshToken, refreshTokenExpiresAt: new Date(row.expires_at), client: toClient(app), user }
    },

    async revokeToken(token: OAuth2Server.RefreshToken | OAuth2Server.Token) {
      const rot = (token.user as ConnectionPrincipal).rotation
      if (!rot) return false
      const now = clock()
      if (rot.grace) {
        // Retry within the grace window: the successor issued for the lost
        // response (and its access token) is ended; a fresh pair follows.
        const ids: string[] = []
        let next = rot.replacedBy
        while (next && ids.length < 50) {
          ids.push(next)
          next = (await store.getTokenById(next))?.replaced_by ?? null
        }
        const { connectionId } = token.user as ConnectionPrincipal
        if (ids.length) await store.revokeTokens({ connectionId, ids }, now.toISOString())
        // Access tokens issued since the retirement (5 s margin for app ↔ DB
        // clock skew; anything that old is being replaced by this refresh anyway).
        if (rot.retiredAt) {
          const since = new Date(new Date(rot.retiredAt).getTime() - 5000).toISOString()
          await store.revokeTokens({ connectionId, kind: 'access', createdAtOrAfter: since }, now.toISOString())
        }
        return true
      }
      // Normal rotation: retire atomically. A concurrent refresh with the same
      // token loses the race and gets invalid_grant (it can retry → grace).
      return store.retireToken(rot.fromTokenId, now.toISOString())
    },

    // ── both grants ───────────────────────────────────────────────────────
    async saveToken(token: OAuth2Server.Token, client: OAuth2Server.Client, user: OAuth2Server.User) {
      const p = user as ConnectionPrincipal
      const c = client as PartnerClient
      const connection = await store.getConnection(p.connectionId)
      // Re-read now: a revoke/pause between consent (or the last refresh) and
      // this exchange must win.
      if (!connection || connection.status !== 'active' || connection.app_id !== c.appId) {
        throw new InvalidGrantError('Invalid grant: connection is not active')
      }
      if (!token.refreshToken || !token.accessTokenExpiresAt || !token.refreshTokenExpiresAt) {
        throw new InvalidGrantError('Invalid grant: token could not be issued')
      }
      const now = clock().toISOString()

      if (!p.rotation) {
        // A new authorization supersedes everything issued before for this
        // Connection (reconnect, consent change): one live credential chain.
        await store.revokeTokens({ connectionId: connection.id }, now)
      }

      const [access, refresh] = await store.insertTokens([
        {
          connection_id: connection.id,
          kind: 'access',
          token_hash: sha256Hex(token.accessToken),
          token_prefix: tokenPrefix(token.accessToken),
          expires_at: token.accessTokenExpiresAt.toISOString(),
        },
        {
          connection_id: connection.id,
          kind: 'refresh',
          token_hash: sha256Hex(token.refreshToken),
          token_prefix: tokenPrefix(token.refreshToken),
          expires_at: token.refreshTokenExpiresAt.toISOString(),
        },
      ])
      if (!access || !refresh) throw new InvalidGrantError('Invalid grant: token could not be issued')
      if (p.rotation) await store.setReplacedBy(p.rotation.fromTokenId, refresh.id)

      return {
        accessToken: token.accessToken,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshToken: token.refreshToken,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        client,
        user: { connectionId: connection.id },
      }
    },

    async getAccessToken() {
      // Never used: partner API requests are authenticated by access.ts, which
      // also checks the Connection and the app. Returning nothing fails closed
      // if anyone ever wires `server.authenticate()` by mistake.
      return null
    },
  }
}
