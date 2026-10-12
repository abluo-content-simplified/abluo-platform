import { describe, expect, it } from 'vitest'
import type { AuthzSubject } from '@/lib/authz/check'
import { listPartnerApps, rotateAppSecret } from '../admin'
import { buildConsentView } from '../consent-view'
import { listProjectConnections, revokeConnection } from '../manage'
import { LOCAL_REDIRECT, P1A, P1B, P2, SANDBOX, abluoAdmin, editor, owner, setup } from './fixture'

// ADR-031 V1 step 4c — the data behind the three screens. The screens only
// display; every decision stays in the tested engine.

type Person = AuthzSubject & { userId: string }
const withSlugs = (s: Person) => ({
  ...s,
  projects: s.projects.map((p) => ({ ...p, projectSlug: `slug-${p.projectId.slice(0, 4)}` })),
})

describe('consent screen view', () => {
  it('offers only the sites the person manages, named, sorted; one site is pre-selected', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const person = withSlugs({ ...owner('u1', P1A, P1B), projects: [...owner('u1', P1A, P1B).projects, ...editor('u1', P2).projects] })
    const v = await buildConsentView(person, params, { ...f.deps, projectNames: { [P1A]: 'Da Mario Cervia', [P1B]: 'Da Mario Milano', [P2]: 'Livener' } })
    expect(v.state).toBe('ready')
    if (v.state !== 'ready') return
    expect(v.projects.map((p) => p.name)).toEqual(['Da Mario Cervia', 'Da Mario Milano']) // not the editor site
    expect(v.preselectedProjectId).toBeNull() // two choices: the person picks
    const single = await buildConsentView(withSlugs(owner('u1', P1A)), params, f.deps)
    expect(single.state === 'ready' && single.preselectedProjectId).toBe(P1A)
  })

  it('started from Abluo: the site named in the link is pre-selected (only if the person manages it)', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const person = withSlugs(owner('u1', P1A, P1B))
    const hinted = await buildConsentView(person, { ...params, project: person.projects[1].projectSlug }, f.deps)
    expect(hinted.state === 'ready' && hinted.preselectedProjectId).toBe(P1B)
    const foreign = await buildConsentView(person, { ...params, project: 'slug-cccc' }, f.deps)
    expect(foreign.state === 'ready' && foreign.preselectedProjectId).toBeNull()
  })

  it('public fields are ticked, personal data is not; an existing connection starts from what it shares', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const v = await buildConsentView(withSlugs(owner('u1', P1A)), params, f.deps)
    if (v.state !== 'ready') throw new Error(v.state)
    const performers = v.resources.find((r) => r.name === 'event')!.fields.find((x) => x.name === 'performers')!
    expect(performers).toEqual({ name: 'performers', personal: true, checked: false })
    expect(v.projects[0].existing).toBeNull()

    await f.connect(app, owner('u1', P1A), P1A, { event: { fields: ['name'] } })
    const again = await buildConsentView(withSlugs(owner('u1', P1A)), params, f.deps)
    if (again.state !== 'ready') throw new Error(again.state)
    expect(again.projects[0].existing).toBe('active')
    expect(again.projects[0].shared?.event.fields).toContain('name')
    expect(again.projects[0].shared?.eventVenue).toBeUndefined()
  })

  it('editors see "ask your Owner", support mode sees "not available", never a form', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    expect((await buildConsentView(withSlugs(editor('u3', P1A)), params, f.deps)).state).toBe('no_site')
    const support = withSlugs({ ...owner('admin-1', P1A), support: { purpose: 'mutation' as const, writesAllowed: true } })
    expect((await buildConsentView(support, params, f.deps)).state).toBe('support_mode')
  })

  it('an unknown app or untrusted return address shows an error here; a bad request goes back to the partner', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const person = withSlugs(owner('u1', P1A))
    expect(await buildConsentView(person, { ...params, redirect_uri: 'https://evil.example/cb' }, f.deps)).toEqual({ state: 'invalid', error: 'invalid_redirect_uri' })
    const bad = await buildConsentView(person, { ...params, scope: 'members:read' }, f.deps)
    expect(bad.state).toBe('redirect')
    if (bad.state === 'redirect') expect(bad.redirectTo).toContain('error=invalid_scope')
  })

  it('a test build (localhost) is offered sandbox sites only', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app, { redirect_uri: LOCAL_REDIRECT })
    const v = await buildConsentView(withSlugs(owner('u1', P1A, SANDBOX)), params, f.deps)
    expect(v.state === 'ready' && v.projects.map((p) => p.projectId)).toEqual([SANDBOX])
    expect(v.state === 'ready' && v.sandboxOnly).toBe(true)
    expect((await buildConsentView(withSlugs(owner('u1', P1A)), params, f.deps)).state).toBe('no_site')
  })

  it('cancel always returns access_denied to the registered address, with the state', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const { params } = f.authorizeParams(app)
    const v = await buildConsentView(withSlugs(owner('u1', P1A)), params, f.deps)
    expect(v.state === 'ready' && v.cancelTo).toBe('https://tableres.example/oauth/callback?error=access_denied&state=xyz')
  })
})

describe('Connected apps screen data', () => {
  it('lists live connections with last use; disconnected ones disappear', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const u = owner('u1', P1A)
    const c = await f.connect(app, u, P1A)
    let list = await listProjectConnections(u, P1A, f.deps)
    expect(list.ok && list.connections[0]).toMatchObject({ appName: 'TableRes', status: 'active', lastUsedAt: null })
    await f.access(c.accessToken)
    list = await listProjectConnections(u, P1A, f.deps)
    expect(list.ok && list.connections[0].lastUsedAt).toBeTruthy()
    await revokeConnection(u, c.connectionId, f.deps)
    list = await listProjectConnections(u, P1A, f.deps)
    expect(list.ok && list.connections).toEqual([])
  })

  it('editors cannot list', async () => {
    const f = await setup()
    expect(await listProjectConnections(editor('u3', P1A), P1A, f.deps)).toEqual({ ok: false, error: 'forbidden' })
  })
})

describe('Partner apps screen data', () => {
  it('lists apps and their live connections — never a secret or a hash', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    await f.connect(app, owner('u1', P1A), P1A)
    const r = await listPartnerApps(abluoAdmin, f.deps)
    if (!r.ok) throw new Error(r.error)
    expect(r.apps[0]).toMatchObject({ name: 'TableRes', status: 'approved', connections: [{ projectName: 'Da Mario Cervia', status: 'active' }] })
    const dump = JSON.stringify(r)
    expect(dump).not.toContain(app.clientSecret)
    expect(dump).not.toMatch(/[0-9a-f]{64}/)
    expect(await listPartnerApps(owner('u1', P1A), f.deps)).toEqual({ ok: false, error: 'forbidden' })
  })

  it('a new secret replaces the old one at once', async () => {
    const f = await setup()
    const app = await f.newApp('TableRes')
    const c = await f.connect(app, owner('u1', P1A), P1A)
    expect(await rotateAppSecret(owner('u1', P1A), app.id, f.deps)).toEqual({ ok: false, error: 'forbidden' })
    const r = await rotateAppSecret(abluoAdmin, app.id, f.deps)
    if (!r.ok) throw new Error(r.error)
    expect((await f.refresh(app, c.refreshToken)).status).toBe(401) // old secret
    const next = await f.refresh({ ...app, clientSecret: r.clientSecret }, c.refreshToken)
    expect(next.status).toBe(200)
    expect(f.store.audits.map((a) => a.action)).toContain('connection.app.secret_rotate')
  })
})
