/**
 * ADR-040 B2.3 — ROUTE-LEVEL tests of the visitor routes. The REAL route
 * modules (src/app/[locale]/(website)/[tenant]/site-access/…/route.ts) are
 * invoked with real Request objects; only the true I/O boundaries are faked:
 * the service-role store (the contract-tested fake store), the environment /
 * salt readers and the Sanity module-config read. Host and project resolution
 * use the REAL generated route table, so the shared preview host, a project's
 * own domain and the dev alias behave exactly as in production.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { hashPassword } from '../password'
import { resolveVisitor } from '../visitor'
import { sessionCookieName } from '../session-token'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { createFakeStore, type FakeStore } from './fake-store'
import type { AccessEnvironment } from '../environment'

// ── Boundaries ───────────────────────────────────────────────────────────────

let store: FakeStore
let env: AccessEnvironment | null = 'production'
let salt: string | undefined = 'route-test-salt-0123456789'
let enabledModules: Record<string, string[] | null | 'throw'> = {}
let storeThrows = false

vi.mock('@/lib/access/server', () => ({
  accessEnvironment: () => env,
  accessIpSalt: () => salt,
  withSiteAccessStore: async (_reason: string, fn: (s: unknown) => Promise<unknown>) => {
    if (storeThrows) throw new Error('supabase unreachable')
    return fn(store)
  },
}))
vi.mock('@/lib/sanity/client', () => ({
  tenantClient: (segment: string) => ({
    fetchForTenant: async () => {
      const m = enabledModules[segment]
      if (m === 'throw') throw new Error('sanity down')
      return m === null || m === undefined ? null : m.map((moduleId) => ({ moduleId, config: {} }))
    },
  }),
}))

const unlockRoute = await import('@/app/[locale]/(website)/[tenant]/site-access/unlock/route')
const signOutRoute = await import('@/app/[locale]/(website)/[tenant]/site-access/sign-out/route')

// ── Fixtures: two real projects of the generated route table ────────────────

const HOFF = resolveScopeFromProjectSegment('hoffmann')!.projectId
const CYCE = resolveScopeFromProjectSegment('cyce')!.projectId
const PREVIEW = 'preview.abluo.app' // shared, path-routed
const OWN = 'www.ch-psicoterapeuta.com' // hoffmann's own domain

let gHoff: string, gCyce: string

beforeEach(async () => {
  store = createFakeStore()
  env = 'production'
  salt = 'route-test-salt-0123456789'
  storeThrows = false
  enabledModules = { hoffmann: ['blog', 'members'], cyce: ['members'] }
  const add = (projectId: string) => {
    const id = randomUUID()
    store.groups.push({ id, projectId, name: { en: 'Members' }, description: null, sortOrder: 0, archivedAt: null })
    return id
  }
  gHoff = add(HOFF); gCyce = add(CYCE)
  await store.createCredential(HOFF, { label: 'h', passwordHash: await hashPassword('hoffmann-pass-1'), groupIds: [gHoff], expiresAt: null }, 'actor')
  await store.createCredential(CYCE, { label: 'c', passwordHash: await hashPassword('cyce-pass-12345'), groupIds: [gCyce], expiresAt: null }, 'actor')
})

type Post = {
  host?: string
  proto?: 'https' | 'http'
  origin?: string | null
  site?: string | null
  tenant?: string
  locale?: string
  fields?: Record<string, string>
  cookie?: string
  contentType?: string
  body?: string
  ip?: string
}

function request(path: string, o: Post): Request {
  const host = o.host ?? PREVIEW
  const proto = o.proto ?? 'https'
  const headers = new Headers({
    host,
    'x-forwarded-proto': proto,
    'content-type': o.contentType ?? 'application/x-www-form-urlencoded',
    'x-vercel-forwarded-for': o.ip ?? '203.0.113.50',
  })
  if (o.origin !== null) headers.set('origin', o.origin ?? `${proto}://${host}`)
  if (o.site !== null) headers.set('sec-fetch-site', o.site ?? 'same-origin')
  if (o.cookie) headers.set('cookie', o.cookie)
  const body = o.body ?? new URLSearchParams(o.fields ?? {}).toString()
  return new Request(`${proto}://${host}${path}`, { method: 'POST', headers, body })
}

async function unlock(o: Post = {}) {
  const tenant = o.tenant ?? 'hoffmann'
  const locale = o.locale ?? 'en'
  const req = request(`/${locale}/${tenant}/site-access/unlock`, o)
  return unlockRoute.POST(req as never, { params: Promise.resolve({ locale, tenant }) })
}
async function signOut(o: Post = {}) {
  const tenant = o.tenant ?? 'hoffmann'
  const locale = o.locale ?? 'en'
  const req = request(`/${locale}/${tenant}/site-access/sign-out`, o)
  return signOutRoute.POST(req as never, { params: Promise.resolve({ locale, tenant }) })
}

const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? ''
const tokenFrom = (res: Response, name: string) => new RegExp(`${name}=([^;]*)`).exec(cookieOf(res))?.[1] ?? ''
const location = (res: Response) => res.headers.get('location')
const HOFF_COOKIE = sessionCookieName(HOFF, true)
const CYCE_COOKIE = sessionCookieName(CYCE, true)
const pw = (password: string, returnTo = '/en/hoffmann/members') => ({ password, returnTo })

// ── CSRF / origin ────────────────────────────────────────────────────────────

describe('strict origin validation (CSRF)', () => {
  it.each([
    ['no Origin header', { origin: null }],
    ['Origin "null"', { origin: 'null' }],
    ['another site', { origin: 'https://evil.example' }],
    ['another project on the same platform', { origin: 'https://cyce.preview.abluo.app' }],
    ['http on an https host (downgrade)', { origin: 'http://preview.abluo.app' }],
    ['Sec-Fetch-Site cross-site', { site: 'cross-site' }],
    ['Sec-Fetch-Site same-site', { site: 'same-site' }],
  ])('%s → 403, nothing reserved, no cookie', async (_n, o) => {
    for (const res of [await unlock({ ...o, fields: pw('hoffmann-pass-1') }), await signOut(o as Post)]) {
      expect(res.status).toBe(403)
      expect(cookieOf(res)).toBe('')
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(store.attempts).toHaveLength(0)
    expect(store.sessions).toHaveLength(0)
  })
  it('a same-origin form post without Sec-Fetch-Site (older browsers) is accepted', async () => {
    expect((await unlock({ site: null, fields: pw('hoffmann-pass-1') })).status).toBe(303)
  })
})

// ── Project from the website address ────────────────────────────────────────

describe('project resolution from the website address', () => {
  it('an unknown host cannot act for any project', async () => {
    const res = await unlock({ host: 'evil.example', fields: pw('hoffmann-pass-1') })
    expect(res.status).toBe(404)
    expect(store.attempts).toHaveLength(0)
  })
  it('a project\'s own domain cannot act for another project (segment mismatch)', async () => {
    const res = await unlock({ host: OWN, tenant: 'cyce', fields: pw('cyce-pass-12345', '/en/x') })
    expect(res.status).toBe(404)
    expect(store.sessions).toHaveLength(0)
  })
  it('an unknown project segment or locale → 404', async () => {
    expect((await unlock({ tenant: 'no-such-project', fields: pw('x') })).status).toBe(404)
    expect((await unlock({ locale: 'xx', fields: pw('x') })).status).toBe(404)
  })
  it('only url-encoded bodies of bounded size', async () => {
    expect((await unlock({ contentType: 'application/json', body: '{"password":"hoffmann-pass-1"}' })).status).toBe(415)
    expect((await unlock({ body: `password=${'a'.repeat(9000)}` })).status).toBe(413)
    expect(store.attempts).toHaveLength(0)
  })
})

// ── Sign-in ─────────────────────────────────────────────────────────────────

describe('unlock', () => {
  it('right password on the shared preview host: session for THIS project, secure cookie, back to the page', async () => {
    const res = await unlock({ fields: pw('hoffmann-pass-1') })
    expect(res.status).toBe(303)
    expect(location(res)).toBe('https://preview.abluo.app/en/hoffmann/members')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const c = cookieOf(res)
    expect(c).toMatch(new RegExp(`^${HOFF_COOKIE}=[A-Za-z0-9_-]{43};`))
    expect(c).toMatch(/Path=\//)
    expect(c).toMatch(/Max-Age=2592000/)
    expect(c).toMatch(/Secure/)
    expect(c).toMatch(/HttpOnly/)
    expect(c).toMatch(/SameSite=lax/i)
    expect(c).not.toMatch(/Domain=/i)
    expect(HOFF_COOKIE.startsWith('__Host-')).toBe(true)
    const token = tokenFrom(res, HOFF_COOKIE)
    expect((await resolveVisitor({ store, projectId: HOFF, environment: 'production', token }))?.groupIds.has(gHoff)).toBe(true)
    // the token is never stored, only its hash
    expect(JSON.stringify(store.sessions)).not.toContain(token)
  })

  it('on the project\'s own domain: same rules, public path without the project segment', async () => {
    const res = await unlock({ host: OWN, fields: pw('hoffmann-pass-1', '/en/members') })
    expect(location(res)).toBe('https://www.ch-psicoterapeuta.com/en/members')
    expect(tokenFrom(res, HOFF_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('on the dev alias, by path, for a project that is not the alias\'s own', async () => {
    const res = await unlock({ host: 'dev.abluo.app', tenant: 'cyce', fields: pw('cyce-pass-12345', '/en/cyce/members') })
    expect(location(res)).toBe('https://dev.abluo.app/en/cyce/members')
    expect(tokenFrom(res, CYCE_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('local development over http: no __Host- prefix, no Secure flag', async () => {
    const res = await unlock({ host: 'localhost:3000', proto: 'http', fields: pw('hoffmann-pass-1') })
    const c = cookieOf(res)
    expect(c.startsWith(`${sessionCookieName(HOFF, false)}=`)).toBe(true)
    expect(c).not.toMatch(/Secure/)
    expect(location(res)).toBe('http://localhost:3000/en/hoffmann/members')
  })

  it('wrong password: back with ?access=wrong, no cookie, the attempt counted as a failure', async () => {
    const res = await unlock({ fields: pw('not-it') })
    expect(location(res)).toBe('https://preview.abluo.app/en/hoffmann/members?access=wrong')
    expect(cookieOf(res)).toBe('')
    expect(store.attempts.map((a) => a.succeeded)).toEqual([false])
  })

  it('rate limit: the sixth wrong try from one address waits, with minutes but nothing else', async () => {
    for (let i = 0; i < 5; i++) await unlock({ fields: pw(`wrong-${i}`) })
    const res = await unlock({ fields: pw('hoffmann-pass-1') }) // even the right one, while limited
    expect(location(res)).toMatch(/\?access=wait&wait=\d+$/)
    expect(cookieOf(res)).toBe('')
    // another address is not affected
    expect(cookieOf(await unlock({ ip: '198.51.100.7', fields: pw('hoffmann-pass-1') }))).toContain(HOFF_COOKIE)
  })

  it.each([
    ['ACCESS_IP_SALT missing', () => { salt = undefined }],
    ['environment undeterminable', () => { env = null }],
    ['the store is unreachable', () => { storeThrows = true }],
    ['the Access module is not enabled', () => { enabledModules.hoffmann = ['blog'] }],
    ['the module list cannot be read', () => { enabledModules.hoffmann = null }],
    ['Sanity is down', () => { enabledModules.hoffmann = 'throw' }],
  ])('%s → ?access=unavailable, no session (fail closed)', async (_n, arrange) => {
    arrange()
    const res = await unlock({ fields: pw('hoffmann-pass-1') })
    expect(location(res)).toBe('https://preview.abluo.app/en/hoffmann/members?access=unavailable')
    expect(cookieOf(res)).toBe('')
    expect(store.sessions).toHaveLength(0)
  })

  it('module off: not even an attempt is reserved', async () => {
    enabledModules.hoffmann = ['blog']
    await unlock({ fields: pw('hoffmann-pass-1') })
    expect(store.attempts).toHaveLength(0)
  })

  it('an existing token is rotated, never reused (fixation)', async () => {
    const first = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    const second = tokenFrom(await unlock({ cookie: `${HOFF_COOKIE}=${first}`, fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    expect(second).not.toBe(first)
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: first })).toBeNull()
  })
})

// ── Return paths ────────────────────────────────────────────────────────────

describe('return paths stay on this site', () => {
  it.each([
    ['https://evil.example/x'],
    ['//evil.example/x'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    ['/en/cyce/members'], // another project on the same shared host
    ['/en/hoffmann/../cyce/members'],
    ['en/hoffmann/members'],
    [''],
  ])('%j → the site home', async (returnTo) => {
    const res = await unlock({ fields: { password: 'nope', returnTo } })
    expect(location(res)).toBe('https://preview.abluo.app/en/hoffmann?access=wrong')
  })
  it('keeps the query and fragment, drops a stale access notice', async () => {
    const res = await unlock({ fields: pw('hoffmann-pass-1', '/en/hoffmann/members/timetable?week=2&access=wrong&wait=9#today') })
    expect(location(res)).toBe('https://preview.abluo.app/en/hoffmann/members/timetable?week=2#today')
  })
})

// ── Cross-tenant on the shared preview host ─────────────────────────────────

describe('cross-tenant attempts on the shared preview host', () => {
  it('one project\'s password does not open another project, even at the same host', async () => {
    const res = await unlock({ tenant: 'hoffmann', fields: pw('cyce-pass-12345') })
    expect(location(res)).toMatch(/access=wrong/)
    expect(store.sessions).toHaveLength(0)
  })
  it('sessions of two projects coexist under different cookie names and never cross', async () => {
    const h = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    const c = tokenFrom(await unlock({ tenant: 'cyce', fields: pw('cyce-pass-12345', '/en/cyce/members') }), CYCE_COOKIE)
    expect(HOFF_COOKIE).not.toBe(CYCE_COOKIE)
    expect(await resolveVisitor({ store, projectId: CYCE, environment: 'production', token: h })).toBeNull()
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: c })).toBeNull()
  })
  it('a session made on preview is nothing in production', async () => {
    env = 'preview'
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'preview', token: t })).not.toBeNull()
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: t })).toBeNull()
  })
})

// ── Sign-out and revocation ─────────────────────────────────────────────────

describe('sign-out and revocation', () => {
  it('revokes the session server-side and clears the cookie with matching attributes', async () => {
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    const res = await signOut({ cookie: `${HOFF_COOKIE}=${t}`, fields: { returnTo: '/en/hoffmann/members' } })
    expect(res.status).toBe(303)
    expect(location(res)).toBe('https://preview.abluo.app/en/hoffmann/members?access=signed_out')
    const c = cookieOf(res)
    expect(c).toMatch(new RegExp(`^${HOFF_COOKIE}=;`))
    expect(c).toMatch(/Max-Age=0/)
    expect(c).toMatch(/Path=\//)
    expect(c).toMatch(/Secure/)
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: t })).toBeNull()
  })
  it('a forged (cross-origin) sign-out leaves the session alive', async () => {
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    expect((await signOut({ origin: 'https://evil.example', cookie: `${HOFF_COOKIE}=${t}` })).status).toBe(403)
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: t })).not.toBeNull()
  })
  it('signing out of one project does not touch another project\'s session', async () => {
    const h = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    const c = tokenFrom(await unlock({ tenant: 'cyce', fields: pw('cyce-pass-12345', '/en/cyce/members') }), CYCE_COOKIE)
    await signOut({ tenant: 'cyce', cookie: `${HOFF_COOKIE}=${h}; ${CYCE_COOKIE}=${c}`, fields: { returnTo: '/en/cyce/members' } })
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: h })).not.toBeNull()
    expect(await resolveVisitor({ store, projectId: CYCE, environment: 'production', token: c })).toBeNull()
  })
  it('the store failing during sign-out still clears the cookie', async () => {
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    storeThrows = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await signOut({ cookie: `${HOFF_COOKIE}=${t}` })
    expect(cookieOf(res)).toMatch(/Max-Age=0/)
    // …but does not claim the session was ended server-side
    expect(location(res)).toMatch(/access=signed_out_browser$/)
  })
  it('revocation that cannot be confirmed (store error inside, environment unknown) → "signed out in this browser"', async () => {
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.failNext = { method: 'revokeSessions', error: new Error('timeout') }
    const a = await signOut({ cookie: `${HOFF_COOKIE}=${t}` })
    expect(location(a)).toMatch(/access=signed_out_browser$/)
    expect(cookieOf(a)).toMatch(/Max-Age=0/)
    env = null
    expect(location(await signOut({ cookie: `${HOFF_COOKIE}=${t}` }))).toMatch(/access=signed_out_browser$/)
  })
  it('nothing to revoke (no cookie, dead cookie) → plain "signed out"', async () => {
    expect(location(await signOut({}))).toMatch(/access=signed_out$/)
    expect(location(await signOut({ cookie: `${HOFF_COOKIE}=${'x'.repeat(43)}` }))).toMatch(/access=signed_out$/)
  })
  it('"sign out everyone" from the dashboard ends a visitor\'s session on the next request', async () => {
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    await store.revokeSessions(HOFF, null, 'revoked_all', 'owner')
    expect(await resolveVisitor({ store, projectId: HOFF, environment: 'production', token: t })).toBeNull()
  })
})

// ── R9: the members bar's status check ──────────────────────────────────────

describe('GET status (members bar, R9)', () => {
  const statusRoute = () => import('@/app/[locale]/(website)/[tenant]/site-access/status/route')
  async function status(o: { host?: string; tenant?: string; locale?: string; cookie?: string } = {}) {
    const host = o.host ?? PREVIEW
    const tenant = o.tenant ?? 'hoffmann'
    const locale = o.locale ?? 'en'
    const headers = new Headers({ host, 'x-forwarded-proto': 'https' })
    if (o.cookie) headers.set('cookie', o.cookie)
    const res = await (await statusRoute()).GET(new Request(`https://${host}/${locale}/${tenant}/site-access/status`, { headers }) as never, { params: Promise.resolve({ locale, tenant }) })
    return { res, body: (await res.json()) as unknown }
  }
  it('signed in → { signedIn: true } and nothing else; never cached', async () => {
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    const { res, body } = await status({ cookie: `${HOFF_COOKIE}=${t}` })
    expect(body).toEqual({ signedIn: true })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })
  it('no cookie → false without touching the store', async () => {
    storeThrows = true
    expect((await status()).body).toEqual({ signedIn: false })
  })
  it('another project\'s session, a signed-out session, another environment or the store failing → false', async () => {
    const tc = tokenFrom(await unlock({ tenant: 'cyce', fields: pw('cyce-pass-12345', '/en/cyce/x') }), CYCE_COOKIE)
    expect((await status({ cookie: `${HOFF_COOKIE}=${tc}` })).body).toEqual({ signedIn: false })
    const t = tokenFrom(await unlock({ fields: pw('hoffmann-pass-1') }), HOFF_COOKIE)
    env = 'preview'
    expect((await status({ cookie: `${HOFF_COOKIE}=${t}` })).body).toEqual({ signedIn: false })
    env = 'production'
    storeThrows = true
    expect((await status({ cookie: `${HOFF_COOKIE}=${t}` })).body).toEqual({ signedIn: false })
    storeThrows = false
    await store.revokeSessions(HOFF, null, 'revoked_all', 'o')
    expect((await status({ cookie: `${HOFF_COOKIE}=${t}` })).body).toEqual({ signedIn: false })
  })
  it('an unknown host or language → false', async () => {
    expect((await status({ host: 'evil.example' })).body).toEqual({ signedIn: false })
    expect((await status({ locale: 'xx' })).body).toEqual({ signedIn: false })
  })
})
