// Shared fixture for the Connections security suites. The REAL OAuth library
// runs inside handleTokenRequest; only the database is replaced by the
// in-memory store (same contract, same atomic guards).
import { approveApp, registerApp } from '../admin'
import { approveConnect, type AuthorizeParams } from '../consent'
import { randomBase62, s256Challenge } from '../crypto'
import { handleRevokeRequest } from '../revoke-endpoint'
import { handleTokenRequest } from '../token-endpoint'
import { authenticateConnectionRequest } from '../access'
import type { AuthzSubject } from '@/lib/authz/check'
import { MemoryConnectionsStore } from '../testing/memory-store'

export const T1 = '11111111-1111-4111-8111-111111111111'
export const T2 = '22222222-2222-4222-8222-222222222222'
export const P1A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' // tenant 1, site A
export const P1B = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb' // tenant 1, site B
export const P2 = 'cccccccc-2222-4222-8222-cccccccccccc' // tenant 2
export const SANDBOX = 'dddddddd-9999-4999-8999-dddddddddddd' // demo project

export const REDIRECT = 'https://tableres.example/oauth/callback'
export const LOCAL_REDIRECT = 'http://localhost:3000/callback'

type Subject = AuthzSubject & { userId: string }

export const abluoAdmin: Subject = { userId: 'admin-1', platformRole: 'abluo_admin', projects: [] }
export const owner = (userId: string, ...projectIds: string[]): Subject => ({
  userId,
  platformRole: 'tenant_user',
  projects: projectIds.map((projectId) => ({ projectId, permissions: ['connections.manage', 'blog.post.write'] })),
})
export const editor = (userId: string, projectId: string): Subject => ({
  userId,
  platformRole: 'tenant_user',
  projects: [{ projectId, permissions: ['blog.post.write'] }],
})

export async function setup() {
  let offsetMs = 0
  const clock = () => new Date(Date.now() + offsetMs)
  const store = new MemoryConnectionsStore(clock)
  store.addProject({ id: P1A, tenantId: T1, name: 'Da Mario Cervia', status: 'active' })
  store.addProject({ id: P1B, tenantId: T1, name: 'Da Mario Milano', status: 'active' })
  store.addProject({ id: P2, tenantId: T2, name: 'Livener', status: 'active' })
  store.addProject({ id: SANDBOX, tenantId: T2, name: 'Demo', status: 'active' })
  const deps = { store, clock, sandboxProjectIds: [SANDBOX] }

  async function newApp(name: string, redirectUris = [REDIRECT, LOCAL_REDIRECT]) {
    const r = await registerApp(abluoAdmin, { name, redirectUris }, deps)
    if (!r.ok) throw new Error(r.error)
    const a = await approveApp(abluoAdmin, r.app.id, deps)
    if (!a.ok) throw new Error(a.error)
    return { id: r.app.id, clientId: r.app.client_id, clientSecret: r.clientSecret }
  }
  type App = Awaited<ReturnType<typeof newApp>>

  function authorizeParams(app: App, over: Partial<AuthorizeParams> = {}) {
    const verifier = randomBase62(64)
    const params: AuthorizeParams = {
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: REDIRECT,
      code_challenge: s256Challenge(verifier),
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'event:read eventVenue:read',
      ...over,
    }
    return { params, verifier }
  }

  async function issueCode(app: App, subject: Subject, projectId: string, resources?: unknown, over: Partial<AuthorizeParams> = {}) {
    const { params, verifier } = authorizeParams(app, over)
    const res = await approveConnect(subject, { params, projectId, resources: resources ?? { event: { fields: ['name', 'startDate'] }, eventVenue: { fields: ['name'] } } }, deps)
    if (!res.ok) return { ok: false as const, error: res.error, verifier, params }
    const code = new URL(res.redirectTo).searchParams.get('code')!
    return { ok: true as const, code, verifier, params, connectionId: res.connectionId, redirectTo: res.redirectTo }
  }

  const post = (body: Record<string, string>, headers: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    rawBody: new URLSearchParams(body).toString(),
  })

  const token = (body: Record<string, string>, headers?: Record<string, string>) => handleTokenRequest(post(body, headers), deps)
  const revoke = (body: Record<string, string>) => handleRevokeRequest(post(body), deps)

  async function exchange(app: App, code: string, verifier: string, over: Record<string, string> = {}) {
    return token({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...over,
    })
  }

  /** Full Connect: consent → code → tokens. */
  async function connect(app: App, subject: Subject, projectId: string, resources?: unknown) {
    const c = await issueCode(app, subject, projectId, resources)
    if (!c.ok) throw new Error(`consent failed: ${c.error}`)
    const res = await exchange(app, c.code, c.verifier)
    if (res.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(res.body)}`)
    return { connectionId: c.connectionId, accessToken: res.body.access_token as string, refreshToken: res.body.refresh_token as string }
  }

  const refresh = (app: App, refreshToken: string) =>
    token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret })

  const access = (accessToken: string) => authenticateConnectionRequest(`Bearer ${accessToken}`, deps)

  return {
    store,
    deps,
    clock,
    advance: (ms: number) => {
      offsetMs += ms
    },
    newApp,
    authorizeParams,
    issueCode,
    exchange,
    connect,
    refresh,
    access,
    token,
    revoke,
  }
}
