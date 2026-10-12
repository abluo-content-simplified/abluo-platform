import { describe, expect, it } from 'vitest'
import { listProjectConnections, pauseConnection, revokeConnection } from '../manage'
import { connectionCan } from '../resources'
import { LOCAL_REDIRECT, P1A, P1B, P2, SANDBOX, editor, owner, setup } from './fixture'

// ADR-031 D1/D8.7 — one Connection = one project. Nothing a Connection holds
// reaches another project, another tenant, or another app's Connection.

describe('strict project isolation', () => {
  it("a token's grant names exactly its own project — never a sibling site or another tenant", async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const r = await f.access(c.accessToken)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.grant.projectId).toBe(P1A)
    expect(connectionCan(r.grant, 'event', 'read', P1A)).toBe(true)
    expect(connectionCan(r.grant, 'event', 'read', P1B)).toBe(false) // same tenant, other site
    expect(connectionCan(r.grant, 'event', 'read', P2)).toBe(false) // other tenant
  })

  it('two Connections of the same app (two tenants) each see only their own project', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const a = await f.connect(app, owner('u1', P1A), P1A)
    const b = await f.connect(app, owner('u2', P2), P2)
    const ga = await f.access(a.accessToken)
    const gb = await f.access(b.accessToken)
    if (!ga.ok || !gb.ok) throw new Error('expected both to authenticate')
    expect(ga.grant.connectionId).not.toBe(gb.grant.connectionId)
    expect(connectionCan(ga.grant, 'event', 'read', P2)).toBe(false)
    expect(connectionCan(gb.grant, 'event', 'read', P1A)).toBe(false)
  })

  it("a person cannot connect a project they do not manage: other tenant, editor, support mode", async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    expect((await f.issueCode(app, owner('u1', P1A), P2)).ok).toBe(false) // owner of T1 → T2 project
    const asEditor = await f.issueCode(app, editor('u3', P1A), P1A)
    expect(asEditor).toMatchObject({ ok: false, error: 'forbidden' })
    const support = { ...owner('admin-1', P1A), support: { purpose: 'mutation' as const, writesAllowed: true } }
    expect(await f.issueCode(app, support, P1A)).toMatchObject({ ok: false, error: 'support_mode' })
    expect(f.store.connections.size).toBe(0)
    expect(f.store.codes.size).toBe(0)
  })

  it("a code issued to app A is useless to app B — and is burned by B's attempt", async () => {
    const f = await setup()
    const a = await f.newApp('TableRes')
    const b = await f.newApp('Other partner')
    const c = await f.issueCode(a, owner('u1', P1A), P1A)
    if (!c.ok) throw new Error('consent')
    const stolen = await f.exchange(b, c.code, c.verifier)
    expect(stolen.status).toBe(400)
    expect(stolen.body.error).toBe('invalid_grant')
    // A presenting it afterwards = replay: refused.
    expect((await f.exchange(a, c.code, c.verifier)).status).toBe(400)
  })

  it("app B cannot refresh or revoke app A's tokens", async () => {
    const f = await setup()
    const a = await f.newApp('TableRes')
    const b = await f.newApp('Other partner')
    const c = await f.connect(a, owner('u1', P1A), P1A)
    const bRefresh = await f.refresh(b, c.refreshToken)
    expect(bRefresh.status).toBe(400)
    await f.revoke({ token: c.accessToken, client_id: b.clientId, client_secret: b.clientSecret })
    await f.revoke({ token: c.refreshToken, client_id: b.clientId, client_secret: b.clientSecret })
    expect((await f.access(c.accessToken)).ok).toBe(true)
    expect((await f.refresh(a, c.refreshToken)).status).toBe(200)
  })

  it("tenant controls never reach another project's Connection (and do not confirm it exists)", async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const stranger = owner('u2', P2)
    expect(await pauseConnection(stranger, c.connectionId, f.deps)).toEqual({ ok: false, error: 'not_found' })
    expect(await revokeConnection(stranger, c.connectionId, f.deps)).toEqual({ ok: false, error: 'not_found' })
    expect(await listProjectConnections(stranger, P1A, f.deps)).toEqual({ ok: false, error: 'forbidden' })
    const mine = await listProjectConnections(stranger, P2, f.deps)
    expect(mine.ok && mine.connections).toEqual([])
    expect((await f.access(c.accessToken)).ok).toBe(true)
  })

  it("a partner's development build (localhost redirect) can only connect a sandbox project", async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const real = await f.issueCode(app, owner('u1', P1A), P1A, undefined, { redirect_uri: LOCAL_REDIRECT })
    expect(real).toMatchObject({ ok: false, error: 'sandbox_only' })
    const demo = await f.issueCode(app, owner('u2', SANDBOX), SANDBOX, undefined, { redirect_uri: LOCAL_REDIRECT })
    expect(demo.ok).toBe(true)
    if (demo.ok) expect(f.store.connections.get(demo.connectionId)?.sandbox).toBe(true)
  })

  it('consent records who approved what, for which project and tenant', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    const row = f.store.connections.get(c.connectionId)!
    expect(row).toMatchObject({ project_id: P1A, tenant_id: expect.any(String), app_id: app.id, status: 'active' })
    expect(row.consent).toMatchObject({ by: 'u1', resources: row.resources })
    expect(f.store.audits.map((a) => a.action)).toContain('connection.connect')
  })
})
