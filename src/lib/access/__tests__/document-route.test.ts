/**
 * ADR-040 B2.4 — ROUTE-LEVEL tests of protected document delivery. The REAL
 * route module is invoked with real Requests; only the I/O boundaries are
 * faked (store, private bucket + its HTTP endpoint, Sanity module config, the
 * environment). Hosts and projects come from the REAL generated route table.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { hashPassword } from '../password'
import { unlockWithPassword } from '../visitor'
import { sessionCookieName } from '../session-token'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { createFakeStore, type FakeStore } from './fake-store'
import { createFakeFiles, pdfBytes, type FakeFiles } from './fake-files'
import type { AccessEnvironment } from '../environment'

let store: FakeStore
let files: FakeFiles
let env: AccessEnvironment | null = 'production'
let enabledModules: Record<string, string[] | null> = {}

vi.mock('@/lib/access/server', () => ({
  accessEnvironment: () => env,
  accessIpSalt: () => 'route-test-salt-0123456789',
  withSiteAccessStore: async (_r: string, fn: (s: unknown, f: unknown) => Promise<unknown>) => fn(store, files),
}))
vi.mock('@/lib/sanity/client', () => ({
  tenantClient: (segment: string) => ({
    fetchForTenant: async () => (enabledModules[segment] ?? null)?.map((moduleId) => ({ moduleId, config: {} })) ?? null,
  }),
}))

const route = await import('@/app/[locale]/(website)/[tenant]/site-access/documents/[documentId]/route')

const HOFF = resolveScopeFromProjectSegment('hoffmann')!.projectId
const CYCE = resolveScopeFromProjectSegment('cyce')!.projectId
const PREVIEW = 'preview.abluo.app'
let gHoff: string, gHoff2: string, gCyce: string, credHoff: string
let docHoff: string, docCyce: string, docHoffNobody: string
let token: string, tokenCyce: string

async function session(projectId: string, password: string) {
  const r = await unlockWithPassword({ store, projectId, environment: 'production', password, currentToken: null, ip: '203.0.113.1', ipSalt: 'route-test-salt-0123456789', forGroupIds: null })
  if (!r.ok) throw new Error('unlock failed')
  return r.token
}
async function upload(projectId: string, documentId: string, locale: string, size: number) {
  const bytes = pdfBytes(size)
  const { createHash } = await import('crypto')
  const sha = createHash('sha256').update(bytes).digest('hex')
  const r = await store.beginUpload(projectId, { documentId, locale, sizeBytes: size, sha256: sha, filename: null, ttlSeconds: 3600 }, 'owner')
  files.objects.set(r.storagePath, bytes)
  await store.finishUpload(projectId, r.uploadId, { sizeBytes: size, sha256: sha }, 'owner')
  return r.storagePath
}

beforeEach(async () => {
  store = createFakeStore()
  files = createFakeFiles()
  vi.stubGlobal('fetch', files.fetch)
  env = 'production'
  enabledModules = { hoffmann: ['members'], cyce: ['members'] }
  const add = (p: string) => { const id = randomUUID(); store.groups.push({ id, projectId: p, name: { en: 'G' }, description: null, sortOrder: 0, archivedAt: null }); return id }
  gHoff = add(HOFF); gHoff2 = add(HOFF); gCyce = add(CYCE)
  credHoff = await store.createCredential(HOFF, { label: 'h', passwordHash: await hashPassword('hoffmann-pass-1'), groupIds: [gHoff], expiresAt: null }, 'o')
  await store.createCredential(CYCE, { label: 'c', passwordHash: await hashPassword('cyce-pass-12345'), groupIds: [gCyce], expiresAt: null }, 'o')
  docHoff = await store.createDocument(HOFF, { title: { en: 'Timetable', it: 'Orario' }, groupIds: [gHoff] }, 'o')
  docHoffNobody = await store.createDocument(HOFF, { title: { en: 'Staff' }, groupIds: [] }, 'o')
  docCyce = await store.createDocument(CYCE, { title: { en: 'Cyce doc' }, groupIds: [gCyce] }, 'o')
  await upload(HOFF, docHoff, 'it', 8192)
  await upload(HOFF, docHoffNobody, 'it', 1024)
  await upload(CYCE, docCyce, 'en', 1024)
  token = await session(HOFF, 'hoffmann-pass-1')
  tokenCyce = await session(CYCE, 'cyce-pass-12345')
})

type Get = { host?: string; tenant?: string; locale?: string; id?: string; cookie?: string | null; headers?: Record<string, string>; query?: string; method?: 'GET' | 'HEAD' }
async function get(o: Get = {}) {
  const host = o.host ?? PREVIEW
  const tenant = o.tenant ?? 'hoffmann'
  const locale = o.locale ?? 'it'
  const id = o.id ?? docHoff
  const headers = new Headers({ host, 'x-forwarded-proto': 'https', ...(o.headers ?? {}) })
  const c = o.cookie === undefined ? `${sessionCookieName(HOFF, true)}=${token}` : o.cookie
  if (c) headers.set('cookie', c)
  const req = new Request(`https://${host}/${locale}/${tenant}/site-access/documents/${encodeURIComponent(id)}${o.query ?? ''}`, { method: o.method ?? 'GET', headers })
  const handler = o.method === 'HEAD' ? route.HEAD : route.GET
  return handler(req as never, { params: Promise.resolve({ locale, tenant, documentId: id }) })
}
/** Status + the headers a stranger could compare. */
const shape = async (r: Response) => ({ status: r.status, location: r.headers.get('location'), body: r.status === 303 ? '' : await r.text(), cc: r.headers.get('cache-control'), www: r.headers.get('www-authenticate') })

describe('authorised viewing', () => {
  it('a member gets the PDF inline, in the URL\'s language', async () => {
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(r.headers.get('content-language')).toBe('it')
    expect(r.headers.get('content-disposition')).toContain('Orario.pdf')
    expect((await r.arrayBuffer()).byteLength).toBe(8192)
  })
  it('language fallback: a German URL serves the site\'s default language (Italian here) and says so', async () => {
    expect(resolveScopeFromProjectSegment('hoffmann')!.defaultLocale).toBe('it') // fixture assumption, from the route table
    const r = await get({ locale: 'de' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-language')).toBe('it')
  })
  it('no file in the URL\'s language nor the default → the same refusal as unknown', async () => {
    const enOnly = await store.createDocument(HOFF, { title: { en: 'EN only' }, groupIds: [gHoff] }, 'o')
    await upload(HOFF, enOnly, 'en', 1024)
    expect((await get({ id: enOnly, locale: 'de', headers: { 'sec-fetch-mode': 'no-cors' } })).status).toBe(401)
  })
  it('a document whose PDF never finished uploading is never served — not even with the object already in storage', async () => {
    const empty = await store.createDocument(HOFF, { title: { en: 'No PDF yet' }, groupIds: [gHoff] }, 'o')
    // no upload at all
    for (const d of ['navigate', 'no-cors'] as const) {
      const r = await get({ id: empty, locale: 'it', headers: { 'sec-fetch-mode': d } })
      expect([303, 401]).toContain(r.status)
      expect(r.headers.get('content-type') ?? '').not.toContain('application/pdf')
    }
    // the browser PUT the bytes, but the server never finished (checked) the upload
    const bytes = pdfBytes(2048)
    const { createHash } = await import('crypto')
    const r0 = await store.beginUpload(HOFF, { documentId: empty, locale: 'it', sizeBytes: 2048, sha256: createHash('sha256').update(bytes).digest('hex'), filename: null, ttlSeconds: 3600 }, 'o')
    files.objects.set(r0.storagePath, bytes)
    expect((await get({ id: empty, locale: 'it', headers: { 'sec-fetch-mode': 'no-cors' } })).status).toBe(401)
    expect((await get({ id: empty, locale: 'it', query: '?download=1', headers: { 'sec-fetch-mode': 'no-cors' } })).status).toBe(401)
    expect(files.signed).toHaveLength(0)
  })
  it('every range request is re-authorised and answered with exactly those bytes', async () => {
    const a = await get({ headers: { range: 'bytes=0-1023', 'sec-fetch-mode': 'no-cors' } })
    expect(a.status).toBe(206)
    expect(a.headers.get('content-range')).toBe('bytes 0-1023/8192')
    expect((await a.arrayBuffer()).byteLength).toBe(1024)
    // the session is signed out between two ranges → the next range is refused
    await store.revokeSessions(HOFF, null, 'revoked_all', 'o')
    const b = await get({ headers: { range: 'bytes=1024-2047', 'sec-fetch-mode': 'no-cors' } })
    expect(b.status).toBe(401)
  })
  it('HEAD is authorised the same way and never reads the object', async () => {
    expect((await get({ method: 'HEAD' })).status).toBe(200)
    expect((await get({ method: 'HEAD', cookie: null })).status).toBe(401)
    expect(files.fetchCalls).toHaveLength(0)
  })
  it('download → 303 to a signed link of at most 60 s', async () => {
    const r = await get({ query: '?download=1' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toMatch(/^https:\/\/storage\.test\//)
    expect(files.signed.at(-1)).toMatchObject({ seconds: 60, downloadName: 'Orario.pdf' })
  })
  it('on the project\'s own domain, without the project segment in the public path', async () => {
    expect((await get({ host: 'www.ch-psicoterapeuta.com' })).status).toBe(200)
  })
})

describe('refusals are indistinguishable', () => {
  const api = { 'sec-fetch-mode': 'no-cors' }
  it('unknown, another project\'s, archived, nobody, wrong group, malformed, no cookie: one response', async () => {
    const archived = await store.createDocument(HOFF, { title: { en: 'Old' }, groupIds: [gHoff] }, 'o')
    await upload(HOFF, archived, 'it', 1024)
    await store.setDocumentArchived(HOFF, archived, true, 'o')
    const otherGroup = await store.createDocument(HOFF, { title: { en: 'Teachers' }, groupIds: [gHoff2] }, 'o')
    await upload(HOFF, otherGroup, 'it', 1024)
    const cases = [
      await get({ id: randomUUID(), headers: api }),
      await get({ id: docCyce, headers: api }), // another tenant's document through this project
      await get({ id: archived, headers: api }),
      await get({ id: docHoffNobody, headers: api }),
      await get({ id: otherGroup, headers: api }),
      await get({ id: 'not-a-uuid', headers: api }),
      await get({ id: '..%2F..%2Fsecret', headers: api }),
      await get({ cookie: null, headers: api }),
    ]
    const shapes = await Promise.all(cases.map(shape))
    for (const s of shapes) expect(s).toEqual(shapes[0])
    expect(shapes[0]).toMatchObject({ status: 401, cc: 'private, no-store' })
    expect(files.fetchCalls).toHaveLength(0)
  })
  it('for a browser navigation: the same 303 to the sign-in page, returning to the document', async () => {
    const nav = { 'sec-fetch-mode': 'navigate' }
    const a = await get({ id: randomUUID(), headers: nav, cookie: null })
    const b = await get({ headers: nav, cookie: null })
    expect(a.status).toBe(303)
    const la = new URL(a.headers.get('location')!), lb = new URL(b.headers.get('location')!)
    expect(la.pathname).toBe('/it/hoffmann/site-access/sign-in')
    expect(lb.pathname).toBe(la.pathname)
    expect(lb.searchParams.get('returnTo')).toBe(`/it/hoffmann/site-access/documents/${docHoff}`)
  })
  it('a failed sign-in\'s outcome is passed on to the sign-in page', async () => {
    const r = await get({ headers: { 'sec-fetch-mode': 'navigate' }, cookie: null, query: '?access=wrong' })
    expect(new URL(r.headers.get('location')!).searchParams.get('access')).toBe('wrong')
  })
})

describe('cross-tenant, sessions, credentials, module', () => {
  const api = { 'sec-fetch-mode': 'no-cors' }
  it('another project\'s valid session opens nothing here, on the shared preview host', async () => {
    const r = await get({ cookie: `${sessionCookieName(CYCE, true)}=${tokenCyce}`, headers: api })
    expect(r.status).toBe(401)
    // and the cyce cookie under hoffmann's cookie name is still cyce's session
    expect((await get({ cookie: `${sessionCookieName(HOFF, true)}=${tokenCyce}`, headers: api })).status).toBe(401)
  })
  it('a project\'s own domain cannot serve another project\'s document', async () => {
    expect((await get({ host: 'www.ch-psicoterapeuta.com', tenant: 'cyce', id: docCyce, cookie: `${sessionCookieName(CYCE, true)}=${tokenCyce}`, headers: api })).status).toBe(401)
  })
  it('an unknown host serves nothing', async () => {
    expect((await get({ host: 'evil.example', headers: api })).status).toBe(401)
  })
  it('an expired session is refused', async () => {
    store.sessions.forEach((s) => { s.expiresAt = Date.now() - 1 })
    expect((await get({ headers: api })).status).toBe(401)
  })
  it('a rotated password ends access on the next request', async () => {
    await store.rotateCredential(HOFF, credHoff, 'scrypt$new', 'o')
    expect((await get({ headers: api })).status).toBe(401)
  })
  it('a disabled password ends access on the next request', async () => {
    await store.setCredentialDisabled(HOFF, credHoff, true, 'o')
    expect((await get({ headers: api })).status).toBe(401)
  })
  it('a session from another environment is refused', async () => {
    env = 'preview'
    expect((await get({ headers: api })).status).toBe(401)
    env = null
    expect((await get({ headers: api })).status).toBe(401)
  })
  it('the Access module switched off (or unreadable) closes every document', async () => {
    enabledModules.hoffmann = ['blog']
    expect((await get({ headers: api })).status).toBe(401)
    enabledModules.hoffmann = null
    expect((await get({ headers: api })).status).toBe(401)
  })
  it('the store failing → refused, not served', async () => {
    store.failNext = { method: 'documentForDelivery', error: new Error('db down') }
    expect((await get({ headers: api })).status).toBe(401)
  })
})

describe('range handling and storage failures (authorised)', () => {
  const api = { 'sec-fetch-mode': 'no-cors' }
  it('malformed or multiple ranges → the whole file; past the end → 416', async () => {
    expect((await get({ headers: { ...api, range: 'bytes=x-y' } })).status).toBe(200)
    expect((await get({ headers: { ...api, range: 'bytes=0-1,4-5' } })).status).toBe(200)
    const r = await get({ headers: { ...api, range: 'bytes=9000-' } })
    expect(r.status).toBe(416)
    expect(r.headers.get('content-range')).toBe('bytes */8192')
  })
  it('a 416 is never shown to someone who may not see the file', async () => {
    expect((await get({ cookie: null, headers: { ...api, range: 'bytes=9000-' } })).status).toBe(401)
  })
  it('storage down, object missing or a different size → 503, private', async () => {
    for (const mode of ['error', 'missing', 'wrong-length'] as const) {
      files.nextFetch = mode
      const r = await get({ headers: api })
      expect(r.status, mode).toBe(503)
      expect(r.headers.get('cache-control')).toBe('private, no-store')
    }
  })
})
