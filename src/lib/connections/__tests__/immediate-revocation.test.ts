import { describe, expect, it } from 'vitest'
import { approveApp, suspendApp } from '../admin'
import { pauseConnection, resumeConnection, revokeConnection } from '../manage'
import { ACCESS_TOKEN_TTL_SECONDS } from '../policy'
import { P1A, P2, abluoAdmin, owner, setup } from './fixture'

// ADR-031 D2 — "Access tokens are checked against Connection status on every
// request — revoke/pause is immediate." No cache, no JWT grace.

describe('immediate revocation', () => {
  it('tenant revoke: the very next request, refresh and pending code all fail; it never comes back', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const u = owner('u1', P1A)
    const c = await f.connect(app, u, P1A)
    const pending = await f.issueCode(app, u, P1A) // a code issued, not yet exchanged
    if (!pending.ok) throw new Error('consent')
    expect((await f.access(c.accessToken)).ok).toBe(true)

    expect(await revokeConnection(u, c.connectionId, f.deps)).toEqual({ ok: true, status: 'revoked' })
    expect((await f.access(c.accessToken)).ok).toBe(false)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(400)
    expect((await f.exchange(app, pending.code, pending.verifier)).status).toBe(400)
    expect(await resumeConnection(u, c.connectionId, f.deps)).toMatchObject({ ok: false })
    expect(f.store.audits.map((a) => a.action)).toContain('connection.revoke')

    // Connecting again creates a NEW Connection; old tokens stay dead.
    const again = await f.connect(app, u, P1A)
    expect(again.connectionId).not.toBe(c.connectionId)
    expect((await f.access(c.accessToken)).ok).toBe(false)
  })

  it('tenant pause stops everything at once; resume restores the same tokens', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const u = owner('u1', P1A)
    const c = await f.connect(app, u, P1A)
    expect(await pauseConnection(u, c.connectionId, f.deps)).toEqual({ ok: true, status: 'paused' })
    expect((await f.access(c.accessToken)).ok).toBe(false)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(400)
    expect(await resumeConnection(u, c.connectionId, f.deps)).toEqual({ ok: true, status: 'active' })
    expect((await f.access(c.accessToken)).ok).toBe(true)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(200) // not retired while paused
  })

  it('support mode can never pause, resume or revoke', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const support = { ...owner('admin-1', P1A), support: { purpose: 'mutation' as const, writesAllowed: true } }
    expect(await revokeConnection(support, c.connectionId, f.deps)).toEqual({ ok: false, error: 'support_mode' })
    expect(await pauseConnection(support, c.connectionId, f.deps)).toEqual({ ok: false, error: 'support_mode' })
    expect((await f.access(c.accessToken)).ok).toBe(true)
  })

  it('Abluo suspends an app: every Connection of it stops at once; approving again resumes only those', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const a = await f.connect(app, owner('u1', P1A), P1A)
    const b = await f.connect(app, owner('u2', P2), P2)
    await pauseConnection(owner('u2', P2), b.connectionId, f.deps) // the tenant's own pause

    expect(await suspendApp(owner('u1', P1A), app.id, f.deps)).toEqual({ ok: false, error: 'forbidden' })
    expect(await suspendApp(abluoAdmin, app.id, f.deps)).toEqual({ ok: true, paused: 1 })
    expect((await f.access(a.accessToken)).ok).toBe(false)
    expect((await f.refresh(app, a.refreshToken)).status).toBe(401) // the app itself cannot authenticate
    expect(await resumeConnection(owner('u1', P1A), a.connectionId, f.deps)).toEqual({ ok: false, error: 'invalid_state' })

    expect(await approveApp(abluoAdmin, app.id, f.deps)).toEqual({ ok: true, resumed: 1 })
    expect((await f.access(a.accessToken)).ok).toBe(true)
    expect(f.store.connections.get(b.connectionId)?.status).toBe('paused') // the tenant's pause stands
  })

  it('partner revokes an access token: that token only', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const res = await f.revoke({ token: c.accessToken, client_id: app.clientId, client_secret: app.clientSecret })
    expect(res.status).toBe(200)
    expect((await f.access(c.accessToken)).ok).toBe(false)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(200)
  })

  it('partner revokes its refresh token: everything ends, the tenant sees "needs reconnect"', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    await f.revoke({ token: c.refreshToken, client_id: app.clientId, client_secret: app.clientSecret })
    expect((await f.access(c.accessToken)).ok).toBe(false)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(400)
    expect(f.store.connections.get(c.connectionId)?.status).toBe('needs_reconnect')
  })

  it('revoke endpoint requires client authentication and reveals nothing about unknown tokens', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    expect((await f.revoke({ token: c.accessToken, client_id: app.clientId })).status).toBe(401)
    expect((await f.access(c.accessToken)).ok).toBe(true)
    const unknown = await f.revoke({ token: 'abluo_at_' + 'A'.repeat(43), client_id: app.clientId, client_secret: app.clientSecret })
    expect(unknown).toMatchObject({ status: 200, body: {} })
  })

  it('an access token stops at its expiry (1 h), even with the Connection active', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    f.advance(ACCESS_TOKEN_TTL_SECONDS * 1000 + 1000)
    expect((await f.access(c.accessToken)).ok).toBe(false)
  })

  it('a replayed authorization code ends every token of its Connection (RFC 6749 §4.1.2)', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const u = owner('u1', P1A)
    const c = await f.issueCode(app, u, P1A)
    if (!c.ok) throw new Error('consent')
    const first = await f.exchange(app, c.code, c.verifier)
    expect(first.status).toBe(200)
    const replay = await f.exchange(app, c.code, c.verifier)
    expect(replay.status).toBe(400)
    expect((await f.access(first.body.access_token as string)).ok).toBe(false)
    expect(f.store.connections.get(c.connectionId)?.status).toBe('needs_reconnect')
    expect(f.store.audits.map((a) => a.action)).toContain('connection.code.replay')
  })

  it('malformed or foreign bearer values never reach a lookup', async () => {
    const f = await setup()
    for (const h of ['', 'Bearer', 'Basic abc', 'Bearer abluo_rt_' + 'A'.repeat(43), 'Bearer ' + 'x'.repeat(52), 'Bearer abluo_at_' + 'A'.repeat(42), 'Bearer abluo_at_' + 'A'.repeat(43) + ' extra']) {
      const r = await (await import('../access')).authenticateConnectionRequest(h, f.deps)
      expect(r.ok, h).toBe(false)
    }
  })
})
