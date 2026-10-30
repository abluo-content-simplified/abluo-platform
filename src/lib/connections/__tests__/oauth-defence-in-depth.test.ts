import OAuth2Server from '@node-oauth/oauth2-server'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticateClient } from '../clients'
import { verifierMatchesChallenge, s256Challenge } from '../crypto'
import { approveConnect, denyConnect, validateAuthorizeRequest } from '../consent'
import { createOAuthModel } from '../model'
import { P1A, REDIRECT, owner, setup } from './fixture'

// ADR-031 Amendment B — our checks hold even where the library would accept,
// and the library version we depend on is the patched one.

describe('library boundary', () => {
  it('runs @node-oauth/oauth2-server ≥ 5.3.0 (CVE-2026-41213 fixed)', async () => {
    const { version } = createRequire(import.meta.url)('@node-oauth/oauth2-server/package.json') as { version: string }
    const [maj, min] = version.split('.').map(Number)
    expect(maj > 5 || (maj === 5 && min >= 3), version).toBe(true)
  })

  it('the model never serves the library paths we do not use', async () => {
    const f = await setup()
    const model = createOAuthModel({ store: f.store, clock: f.clock })
    expect(await model.getAccessToken('abluo_at_' + 'A'.repeat(43))).toBeNull() // API auth is access.ts
    // @ts-expect-error — called with no arguments on purpose
    expect(await model.saveAuthorizationCode()).toBeNull() // codes come from our consent screen
    expect(await model.getAuthorizationCode('abluo_ac_' + 'A'.repeat(43))).toBeNull() // only a pre-consumed code
  })

  it('confidential clients only: a PKCE exchange without the secret is refused (the library alone would allow it)', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    const res = await f.token({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT, client_id: app.clientId })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('invalid_client')
  })

  it('CVE-2026-41213 regression: a malformed verifier fails AND burns the code', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    for (const bad of ['short', c.verifier + '!', '']) {
      const res = await f.exchange(app, c.code, c.verifier, { code_verifier: bad })
      expect(res.status).toBe(400)
    }
    expect((await f.exchange(app, c.code, c.verifier)).status).toBe(400) // the right verifier is too late
  })

  it('wrong verifier, wrong redirect URI or an expired code: refused, code burned', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const u = owner('u1', P1A)
    const wrongVerifier = await f.issueCode(app, u, P1A)
    if (!wrongVerifier.ok) throw new Error('consent')
    expect((await f.exchange(app, wrongVerifier.code, 'A'.repeat(64))).status).toBe(400)
    expect((await f.exchange(app, wrongVerifier.code, wrongVerifier.verifier)).status).toBe(400)

    const wrongRedirect = await f.issueCode(app, u, P1A)
    if (!wrongRedirect.ok) throw new Error('consent')
    expect((await f.exchange(app, wrongRedirect.code, wrongRedirect.verifier, { redirect_uri: REDIRECT + '/x' })).status).toBe(400)
    expect((await f.exchange(app, wrongRedirect.code, wrongRedirect.verifier)).status).toBe(400)

    const late = await f.issueCode(app, u, P1A)
    if (!late.ok) throw new Error('consent')
    f.advance(6 * 60 * 1000)
    expect((await f.exchange(app, late.code, late.verifier)).status).toBe(400)
  })

  it('only authorization_code and refresh_token; repeated parameters refused; POST + form only', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    for (const grant_type of ['password', 'client_credentials', 'implicit']) {
      const r = await f.token({ grant_type, client_id: app.clientId, client_secret: app.clientSecret, username: 'a', password: 'b' })
      expect(r.body.error, grant_type).toBe('unsupported_grant_type')
    }
    const { handleTokenRequest } = await import('../token-endpoint')
    const dup = await handleTokenRequest(
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, rawBody: `grant_type=refresh_token&client_id=${app.clientId}&client_id=x&client_secret=${app.clientSecret}` },
      f.deps,
    )
    expect(dup.body.error).toBe('invalid_request')
    const json = await handleTokenRequest({ method: 'POST', headers: { 'content-type': 'application/json' }, rawBody: '{}' }, f.deps)
    expect(json.body.error).toBe('invalid_request')
    expect((await handleTokenRequest({ method: 'GET', headers: {}, rawBody: '' }, f.deps)).status).toBe(405)
  })

  it('HTTP Basic client authentication works; mixing Basic with a body secret is refused', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    const basic = 'Basic ' + Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')
    const mixed = await f.token({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT, client_secret: app.clientSecret }, { authorization: basic })
    expect(mixed.body.error).toBe('invalid_request')
    const c2 = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c2.ok) throw new Error('consent')
    const ok = await f.token({ grant_type: 'authorization_code', code: c2.code, code_verifier: c2.verifier, redirect_uri: REDIRECT }, { authorization: basic })
    expect(ok.status).toBe(200)
  })

  it('the token response carries the RFC 6749 fields only, never cached', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    const res = await f.exchange(app, c.code, c.verifier)
    expect(Object.keys(res.body).sort()).toEqual(['access_token', 'expires_in', 'refresh_token', 'token_type'])
    expect(res.body.token_type).toBe('Bearer')
    expect(res.body.access_token).toMatch(/^abluo_at_[A-Za-z0-9]{43}$/)
    expect(res.body.refresh_token).toMatch(/^abluo_rt_[A-Za-z0-9]{43}$/)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('library errors pass through as OAuth errors; internal failures never leak', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    f.store.getTokenByHash = async () => {
      throw new Error('relation "connection_tokens" secret detail')
    }
    const res = await f.refresh(app, c.refreshToken)
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('secret detail')
    expect(OAuth2Server.OAuthError).toBeDefined()
  })
})

// Each of our checks must hold ON ITS OWN: here the library's equivalent check
// is switched off, and ours still refuses. (Mutation-tested: removing our
// check makes these fail.)
describe('our layer holds without the library', () => {
  const Grant = createRequire(import.meta.url)('@node-oauth/oauth2-server/lib/grant-types/authorization-code-grant-type')
  afterEach(() => vi.restoreAllMocks())

  it('PKCE: a wrong verifier is refused even if the library skipped its check', async () => {
    vi.spyOn(Grant.prototype, 'verifyPKCE').mockImplementation(() => undefined)
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    expect((await f.exchange(app, c.code, 'B'.repeat(64))).status).toBe(400)
  })

  it('redirect URI: a different one is refused even if the library skipped its check', async () => {
    vi.spyOn(Grant.prototype, 'validateRedirectUri').mockImplementation(() => undefined)
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.issueCode(app, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    expect((await f.exchange(app, c.code, c.verifier, { redirect_uri: 'https://tableres.example/other' })).status).toBe(400)
  })

  it('client authentication: no secret, wrong secret, or an unapproved app never authenticates', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    expect(await authenticateClient(f.store, app.clientId, undefined)).toBeNull()
    expect(await authenticateClient(f.store, app.clientId, '')).toBeNull()
    expect(await authenticateClient(f.store, app.clientId, app.clientSecret.slice(0, -1) + (app.clientSecret.endsWith('x') ? 'y' : 'x'))).toBeNull()
    expect(await authenticateClient(f.store, app.clientId, app.clientSecret)).not.toBeNull()
    const model = createOAuthModel({ store: f.store, clock: f.clock })
    // The library passes undefined for a PKCE request without a secret. Typed as
    // string before @node-oauth/oauth2-server 5.3.1, optional since — the cast
    // compiles on both (an @ts-expect-error broke the build once the types caught up).
    expect(await model.getClient(app.clientId, undefined as unknown as string)).toBeNull()
    f.store.apps.get(app.id)!.status = 'pending'
    expect(await authenticateClient(f.store, app.clientId, app.clientSecret)).toBeNull()
  })

  it('verifier check: RFC 7636 shape and S256 match, constant time', () => {
    const v = 'a'.repeat(43)
    expect(verifierMatchesChallenge(v, s256Challenge(v))).toBe(true)
    expect(verifierMatchesChallenge('a'.repeat(42), s256Challenge('a'.repeat(42)))).toBe(false) // too short
    expect(verifierMatchesChallenge('a'.repeat(129), s256Challenge('a'.repeat(129)))).toBe(false) // too long
    expect(verifierMatchesChallenge(v + '!', s256Challenge(v + '!'))).toBe(false) // outside the alphabet
    expect(verifierMatchesChallenge(v, v)).toBe(false) // plain is never accepted
  })
})

describe('authorization request (consent screen input)', () => {
  it('never redirects to an unregistered URI or for an unknown / unapproved app', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    expect(await validateAuthorizeRequest({ ...params, redirect_uri: 'https://evil.example/cb' }, f.deps)).toMatchObject({ ok: false, redirect: false })
    expect(await validateAuthorizeRequest({ ...params, redirect_uri: REDIRECT + '?x=1' }, f.deps)).toMatchObject({ ok: false, redirect: false })
    expect(await validateAuthorizeRequest({ ...params, client_id: 'abluo_app_' + 'Z'.repeat(24) }, f.deps)).toMatchObject({ ok: false, redirect: false })

    const { registerApp } = await import('../admin')
    const { abluoAdmin } = await import('./fixture')
    const pending = await registerApp(abluoAdmin, { name: 'Pending', redirectUris: [REDIRECT] }, f.deps)
    if (!pending.ok) throw new Error('register')
    expect(await validateAuthorizeRequest({ ...params, client_id: pending.app.client_id }, f.deps)).toMatchObject({ ok: false, redirect: false })
  })

  it('PKCE S256 is mandatory', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    for (const over of [{ code_challenge_method: 'plain' }, { code_challenge_method: null }, { code_challenge: null }, { code_challenge: 'short' }]) {
      const v = await validateAuthorizeRequest({ ...params, ...over }, f.deps)
      expect(v.ok).toBe(false)
      if (!v.ok && v.redirect) expect(v.redirectTo).toContain('error=invalid_request')
    }
  })

  it('declining sends access_denied with the state, and creates nothing', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const r = await denyConnect(params, f.deps)
    expect(r.redirectTo).toBe(`${REDIRECT}?error=access_denied&state=xyz`)
    expect(f.store.connections.size).toBe(0)
  })

  it('the code is returned on the registered redirect with the state', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const r = await approveConnect(owner('u1', P1A), { params, projectId: P1A, resources: { event: { fields: ['name'] } } }, f.deps)
    expect(r.ok && r.redirectTo).toMatch(/^https:\/\/tableres\.example\/oauth\/callback\?code=abluo_ac_[A-Za-z0-9]{43}&state=xyz$/)
  })
})
