import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../crypto'
import { REFRESH_GRACE_MS } from '../policy'
import { P1A, owner, setup } from './fixture'

// ADR-031 D2 / Amendment B — refresh rotation, the 30-second grace window,
// and reuse detection (theft response).

describe('token rotation', () => {
  it('every refresh issues a new pair and retires the old refresh token', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const r = await f.refresh(app, c.refreshToken)
    expect(r.status).toBe(200)
    expect(r.body.refresh_token).not.toBe(c.refreshToken)
    expect(r.body.access_token).not.toBe(c.accessToken)
    expect((await f.access(r.body.access_token as string)).ok).toBe(true)
    const old = await f.store.getTokenByHash(sha256Hex(c.refreshToken))
    const next = await f.store.getTokenByHash(sha256Hex(r.body.refresh_token as string))
    expect(old?.retired_at).toBeTruthy()
    expect(old?.replaced_by).toBe(next?.id)
    // The chain keeps rotating.
    expect((await f.refresh(app, r.body.refresh_token as string)).status).toBe(200)
  })

  it('a lost-response retry within the grace window gets a fresh pair; the unseen successor is ended', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const lost = await f.refresh(app, c.refreshToken) // the partner never received this
    f.advance(REFRESH_GRACE_MS - 5000)
    const retry = await f.refresh(app, c.refreshToken)
    expect(retry.status).toBe(200)
    expect((await f.access(retry.body.access_token as string)).ok).toBe(true)
    expect((await f.access(lost.body.access_token as string)).ok).toBe(false)
    expect((await f.refresh(app, lost.body.refresh_token as string)).status).toBe(400)
    // Not treated as theft: still connected.
    expect(f.store.connections.get(c.connectionId)?.status).toBe('active')
    expect((await f.refresh(app, retry.body.refresh_token as string)).status).toBe(200)
  })

  it('reuse of a retired refresh token after the grace window revokes everything → needs reconnect', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const r1 = await f.refresh(app, c.refreshToken)
    f.advance(REFRESH_GRACE_MS + 1000)
    const replay = await f.refresh(app, c.refreshToken) // e.g. an attacker with the old token
    expect(replay.status).toBe(400)
    expect(replay.body.error).toBe('invalid_grant')
    expect(f.store.connections.get(c.connectionId)?.status).toBe('needs_reconnect')
    expect((await f.access(r1.body.access_token as string)).ok).toBe(false)
    expect((await f.refresh(app, r1.body.refresh_token as string)).status).toBe(400)
    expect([...f.store.tokens.values()].every((t) => t.revoked_at)).toBe(true)
    expect(f.store.audits.find((a) => a.action === 'connection.token.reuse')).toMatchObject({ actorId: null, projectId: P1A })
  })

  it('reuse inside the window is still theft once the successor has been used', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const r1 = await f.refresh(app, c.refreshToken)
    expect((await f.refresh(app, r1.body.refresh_token as string)).status).toBe(200) // successor used
    const replay = await f.refresh(app, c.refreshToken)
    expect(replay.status).toBe(400)
    expect(f.store.connections.get(c.connectionId)?.status).toBe('needs_reconnect')
  })

  it('two simultaneous refreshes with the same token: one live chain survives, no false theft alarm', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const results = await Promise.all([f.refresh(app, c.refreshToken), f.refresh(app, c.refreshToken)])
    expect(results.some((r) => r.status === 200)).toBe(true)
    expect(f.store.connections.get(c.connectionId)?.status).toBe('active')
    const live = [...f.store.tokens.values()].filter((t) => t.kind === 'refresh' && !t.retired_at && !t.revoked_at)
    expect(live).toHaveLength(1)
  })

  it('refresh requires the client secret', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const noSecret = await f.token({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: app.clientId })
    expect(noSecret.status).toBe(401)
    const wrong = await f.token({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: app.clientId, client_secret: 'abluo_cs_' + 'x'.repeat(43) })
    expect(wrong.status).toBe(401)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(200) // untouched by the failures
  })

  it('an expired refresh token cannot be used', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    f.advance(91 * 24 * 60 * 60 * 1000)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(400)
  })

  it('reconnecting supersedes every earlier token of the Connection', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const first = await f.connect(app, owner('u1', P1A), P1A)
    const second = await f.connect(app, owner('u1', P1A), P1A)
    expect(second.connectionId).toBe(first.connectionId) // one live Connection per app × project
    expect((await f.access(first.accessToken)).ok).toBe(false)
    expect((await f.refresh(app, first.refreshToken)).status).toBe(400)
    expect((await f.access(second.accessToken)).ok).toBe(true)
  })

  it('only hashes are stored — no token, code or secret in plaintext', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const dump = JSON.stringify({ t: [...f.store.tokens.values()], c: [...f.store.codes.values()], a: [...f.store.apps.values()] })
    for (const secret of [c.accessToken, c.refreshToken, app.clientSecret]) expect(dump).not.toContain(secret.slice(9))
    expect(dump).toContain(sha256Hex(c.accessToken))
  })
})
