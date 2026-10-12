// ── ADR-031 D8.7 — cross-tenant API suite against the REAL services ──────────
//
// The in-memory suites prove the logic; this one proves the wiring: the real
// Supabase store (service role, migration-040 tables), the real token and
// events handlers, and real GROQ against a real (private) Sanity dataset.
//
// A Connection must never read another project (sibling site or another
// tenant), a draft, an unlisted or website-only event, a field or a resource
// it was not granted — and pause, revoke and lifecycle changes apply on the
// very next request.
//
// Fixtures only: tenants/projects `zz-cnv-<run>-…` + a throwaway user in
// Supabase, documents in the Sanity `staging` dataset. Everything is deleted
// at the end and swept at the start. Run: `npm run verify:connections`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient as createSanity, type SanityClient } from '@sanity/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { SANITY_DATASET, SANITY_PROJECT_ID } from '@/lib/sanity/config'
import { approveApp, registerApp } from '../../admin'
import { approveConnect } from '../../consent'
import { randomBase62, s256Challenge } from '../../crypto'
import { pauseConnection, resumeConnection, revokeConnection } from '../../manage'
import { handleTokenRequest } from '../../token-endpoint'
import { handleRevokeRequest } from '../../revoke-endpoint'
import { createSupabaseConnectionsStore } from '../../supabase-store'
import { createRateLimiter } from '../../rate-limit'
import { handleEventsRequest, SETTLE_MS } from '../../api/events-endpoint'
import { createSanityEventsSource } from '../../api/events-source'
import { recordRemoval } from '../../api/removals'
import { PARTNER_EVENTS_PAGE_QUERY } from '../../api/event-queries'
import { SHAREABLE_RESOURCES } from '../../resources'

if (process.env.CONNECTIONS_LIVE_VERIFY !== '1') throw new Error('Run with `npm run verify:connections`.')
if (SANITY_DATASET === 'production') throw new Error('Refusing to run: the live suite never touches the production dataset.')

const RUN = `${Date.now().toString(36)}${randomBase62(4).toLowerCase()}`
const PREFIX = 'zz-cnv-'
const slug = (k: string) => `${PREFIX}${RUN}-${k}`
const REDIRECT = 'https://partner.example/oauth/callback'
const uuid = () => crypto.randomUUID()

const store = createSupabaseConnectionsStore()
const limiter = createRateLimiter(10_000)
const source = createSanityEventsSource()
let db: SupabaseClient
let sanity: SanityClient

// Every document a connection must NOT see carries a LEAK marker in its text.
const LEAK = 'LEAK-MARKER'

const ids = {
  user: '',
  tA: '', tB: '',
  A1: '', A2: '', B1: '',
  app: { id: '', clientId: '', clientSecret: '' },
  ev: {
    a1Public: uuid(), a1Unlisted: uuid(), a1WebsiteOnly: uuid(), a1DraftOnly: uuid(), a1WithDraft: uuid(),
    a1Venue: uuid(), a2Public: uuid(), b1Public: uuid(), b1Venue: uuid(), a1Gone: uuid(), b1Gone: uuid(),
  },
}
const sanityIds: string[] = []

type Subject = { userId: string; platformRole: 'abluo_admin' | 'tenant_user'; projects: { projectId: string; permissions: string[] }[] }
const admin = (): Subject => ({ userId: ids.user, platformRole: 'abluo_admin', projects: [] })
const ownerOf = (...projectIds: string[]): Subject => ({
  userId: ids.user,
  platformRole: 'tenant_user',
  projects: projectIds.map((projectId) => ({ projectId, permissions: ['connections.manage'] })),
})

// ── helpers ──────────────────────────────────────────────────────────────────
const form = (body: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  rawBody: new URLSearchParams(body).toString(),
})
const token = (body: Record<string, string>) => handleTokenRequest(form(body), { store })
const appCreds = () => ({ client_id: ids.app.clientId, client_secret: ids.app.clientSecret })

async function connect(subject: Subject, projectId: string, resources: unknown) {
  const verifier = randomBase62(64)
  const res = await approveConnect(
    subject,
    {
      params: {
        response_type: 'code',
        client_id: ids.app.clientId,
        redirect_uri: REDIRECT,
        code_challenge: s256Challenge(verifier),
        code_challenge_method: 'S256',
        state: 's',
        scope: 'event:read eventVenue:read',
      },
      projectId,
      resources,
    },
    { store },
  )
  if (!res.ok) return { ok: false as const, error: res.error }
  const code = new URL(res.redirectTo).searchParams.get('code')!
  const t = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, ...appCreds() })
  expect(t.status, JSON.stringify(t.body)).toBe(200)
  return {
    ok: true as const,
    connectionId: res.connectionId,
    access: t.body.access_token as string,
    refresh: t.body.refresh_token as string,
  }
}

async function events(accessToken: string, query = '') {
  const r = await handleEventsRequest(
    { method: 'GET', url: `https://abluo.app/api/v1/events${query}`, headers: { authorization: `Bearer ${accessToken}` } },
    { store, source, limiter },
  )
  return { status: r.status, text: r.body ?? '', json: r.body ? JSON.parse(r.body) : null }
}

/** Every item until has_more is false. */
async function syncAll(accessToken: string) {
  const items: Record<string, unknown>[] = []
  let cursor = ''
  let raw = ''
  for (let i = 0; i < 20; i++) {
    const r = await events(accessToken, cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=2` : '?limit=2')
    expect(r.status, r.text).toBe(200)
    raw += r.text
    items.push(...r.json.data)
    cursor = r.json.next_cursor
    if (!r.json.has_more) break
  }
  return { items, raw }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── fixtures ─────────────────────────────────────────────────────────────────
async function sweep() {
  // Leftovers of an earlier run that crashed before its cleanup.
  const { data: oldTenants } = await db.from('tenants').select('id').like('slug', `${PREFIX}%`)
  const tenantIds = (oldTenants ?? []).map((t) => t.id as string)
  if (tenantIds.length) {
    const { data: conns } = await db.from('connections').select('id, app_id').in('tenant_id', tenantIds)
    const appIds = [...new Set((conns ?? []).map((c) => c.app_id as string))]
    await db.from('connections').delete().in('tenant_id', tenantIds)
    if (appIds.length) await db.from('partner_apps').delete().in('id', appIds).like('name', 'zz-cnv%')
    await db.from('projects').delete().in('tenant_id', tenantIds)
    await db.from('tenants').delete().in('id', tenantIds)
  }
  const { data: apps } = await db.from('partner_apps').select('id').like('name', 'zz-cnv%')
  for (const a of apps ?? []) {
    await db.from('connections').delete().eq('app_id', a.id)
    await db.from('partner_apps').delete().eq('id', a.id)
  }
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 })
  for (const u of users?.users ?? []) {
    if (u.email?.startsWith('connections-verify+')) await db.auth.admin.deleteUser(u.id)
  }
  const docs = await sanity.fetch<string[]>(`*[string::startsWith(projectSlug, $p)]._id`, { p: PREFIX }, { perspective: 'raw' })
  if (docs.length) {
    const tx = sanity.transaction()
    for (const id of docs) tx.delete(id)
    await tx.commit({ visibility: 'sync' })
  }
}

async function insertId(table: string, row: Record<string, unknown>) {
  const { data, error } = await db.from(table).insert(row).select('id').single()
  if (error || !data) throw new Error(`fixture ${table}: ${error?.message}`)
  return data.id as string
}

function sanityDocs(): ({ _id: string; _type: string } & Record<string, unknown>)[] {
  const loc = (it: string) => ({ _type: 'localizedString', it, en: it })
  const slugs = (s: string) => ({ it: { _type: 'slug', current: s }, en: { _type: 'slug', current: s } })
  const ev = (projectSlug: string, publicId: string, title: string, extra: Record<string, unknown> = {}) => ({
    _id: `cnv-${RUN}-${publicId}`,
    _type: 'event',
    projectSlug,
    publicId,
    title: loc(title),
    slug: slugs(publicId.slice(0, 8)),
    shortDescription: loc(`Description of ${title}`),
    startDate: '2026-12-01T19:00:00Z',
    eventStatus: 'scheduled',
    attendanceMode: 'inPerson',
    hosts: [{ _key: 'h1', name: `Host of ${title}`, role: loc('Host') }],
    visibility: 'public',
    ...extra,
  })
  const site = (projectSlug: string) => ({ _id: `cnv-${RUN}-site-${projectSlug}`, _type: 'siteConfig', projectSlug, defaultLocale: 'it', supportedLocales: ['it', 'en'], timeZone: 'Europe/Rome' })
  const project = (projectSlug: string) => ({
    _id: `cnv-${RUN}-project-${projectSlug}`,
    _type: 'project',
    projectSlug,
    moduleInstallations: [{ _key: 'events', moduleId: 'events', enabled: true }],
  })
  const [a1, a2, b1] = [slug('a1'), slug('a2'), slug('b1')]
  const e = ids.ev
  const withDraftId = `cnv-${RUN}-${e.a1WithDraft}`
  return [
    project(a1), project(a2), project(b1), site(a1), site(a2), site(b1),
    { _id: `cnv-${RUN}-venue-b1`, _type: 'eventVenue', projectSlug: b1, publicId: e.b1Venue, name: loc(`${LEAK} venue of tenant B`) },
    { _id: `cnv-${RUN}-venue-a1`, _type: 'eventVenue', projectSlug: a1, publicId: e.a1Venue, name: loc('Sala grande A1') },
    ev(a1, e.a1Public, 'A1 public event', { place: { kind: 'venue', venue: { _type: 'reference', _ref: `cnv-${RUN}-venue-a1`, _weak: true } } }),
    ev(a1, e.a1Unlisted, `${LEAK} unlisted`, { visibility: 'unlisted' }),
    ev(a1, e.a1WebsiteOnly, `${LEAK} website only`, { visibility: 'websiteOnly' }),
    { ...ev(a1, e.a1DraftOnly, `${LEAK} never published`), _id: `drafts.cnv-${RUN}-${e.a1DraftOnly}` },
    ev(a1, e.a1WithDraft, 'A1 published title', {
      // A1's own event pointing at tenant B's venue: the venue must not resolve.
      place: { kind: 'venue', venue: { _type: 'reference', _ref: `cnv-${RUN}-venue-b1`, _weak: true } },
    }),
    { ...ev(a1, e.a1WithDraft, `${LEAK} unpublished draft edit`), _id: `drafts.${withDraftId}` },
    ev(a2, e.a2Public, `${LEAK} sibling site A2`),
    ev(b1, e.b1Public, `${LEAK} other tenant B1`),
  ]
}

beforeAll(async () => {
  db = createAdminClient()
  sanity = createSanity({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: '2025-02-19',
    token: process.env.SANITY_API_WRITE_TOKEN,
    useCdn: false,
  })
  expect(sanity.config().dataset).not.toBe('production')
  await sweep()

  const { data: u, error: ue } = await db.auth.admin.createUser({ email: `connections-verify+${RUN}@abluo.app`, email_confirm: true })
  if (ue || !u.user) throw new Error(`fixture user: ${ue?.message}`)
  ids.user = u.user.id

  ids.tA = await insertId('tenants', { slug: slug('ta'), display_name: 'zz Connections verify A', status: 'active' })
  ids.tB = await insertId('tenants', { slug: slug('tb'), display_name: 'zz Connections verify B', status: 'active' })
  ids.A1 = await insertId('projects', { slug: slug('a1'), tenant_id: ids.tA, name: 'zz A1', status: 'active' })
  ids.A2 = await insertId('projects', { slug: slug('a2'), tenant_id: ids.tA, name: 'zz A2', status: 'active' })
  ids.B1 = await insertId('projects', { slug: slug('b1'), tenant_id: ids.tB, name: 'zz B1', status: 'active' })

  const reg = await registerApp(admin(), { name: `zz-cnv ${RUN}`, redirectUris: [REDIRECT] }, { store })
  if (!reg.ok) throw new Error(`register: ${reg.error}`)
  const ok = await approveApp(admin(), reg.app.id, { store })
  if (!ok.ok) throw new Error(`approve: ${ok.error}`)
  ids.app = { id: reg.app.id, clientId: reg.app.client_id, clientSecret: reg.clientSecret }

  const tx = sanity.transaction()
  for (const d of sanityDocs()) {
    sanityIds.push(d._id)
    tx.createOrReplace(d)
  }
  await tx.commit({ visibility: 'sync' })

  // Deletions arrive through the removals webhook → tombstones per project.
  expect(await recordRemoval({ type: 'event', publicId: ids.ev.a1Gone, projectSlug: slug('a1') }, { store })).toEqual({ ok: true, recorded: true })
  expect(await recordRemoval({ type: 'event', publicId: ids.ev.b1Gone, projectSlug: slug('b1') }, { store })).toEqual({ ok: true, recorded: true })

  await sleep(SETTLE_MS + 1500) // past the settle window
})

afterAll(async () => {
  const problems: string[] = []
  const step = async (name: string, fn: () => PromiseLike<{ error: { message: string } | null } | unknown>) => {
    try {
      const r = (await fn()) as { error?: { message: string } | null } | undefined
      if (r && typeof r === 'object' && 'error' in r && r.error) problems.push(`${name}: ${r.error.message}`)
    } catch (e) {
      problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (sanity && sanityIds.length) {
    await step('sanity', () => {
      const tx = sanity.transaction()
      for (const id of sanityIds) tx.delete(id).delete(`drafts.${id}`)
      return tx.commit({ visibility: 'sync' })
    })
  }
  if (db) {
    if (ids.app.id) await step('connections', () => db.from('connections').delete().eq('app_id', ids.app.id))
    if (ids.app.id) await step('partner_apps', () => db.from('partner_apps').delete().eq('id', ids.app.id))
    for (const p of [ids.A1, ids.A2, ids.B1].filter(Boolean)) await step('audit', () => db.from('admin_audit_log').delete().eq('project_id', p))
    if (ids.user) await step('audit', () => db.from('admin_audit_log').delete().eq('actor_id', ids.user))
    for (const t of [ids.tA, ids.tB].filter(Boolean)) {
      await step('projects', () => db.from('projects').delete().eq('tenant_id', t))
      await step('tenants', () => db.from('tenants').delete().eq('id', t))
    }
    if (ids.user) await step('user', () => db.auth.admin.deleteUser(ids.user))
    const { count } = await db.from('tenants').select('id', { count: 'exact', head: true }).like('slug', `${PREFIX}%`)
    if (count) problems.push(`${count} fixture tenant(s) left`)
  }
  if (problems.length) console.warn(`cleanup: ${problems.join(' · ')}`)
  expect(problems).toEqual([])
})

// ── the suite ────────────────────────────────────────────────────────────────
const GRANT = { event: { fields: ['name', 'startDate', 'location'] } }
const CORE = SHAREABLE_RESOURCES.event.core as readonly string[]

describe('D8.7 cross-tenant API suite (real Supabase, real GROQ)', () => {
  let a1: Extract<Awaited<ReturnType<typeof connect>>, { ok: true }>
  let b1: Extract<Awaited<ReturnType<typeof connect>>, { ok: true }>

  it('consent: a person connects only the sites they manage', async () => {
    expect(await connect(ownerOf(ids.A1), ids.B1, GRANT)).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await connect(ownerOf(ids.A1), ids.A2, GRANT)).toMatchObject({ ok: false, error: 'forbidden' })
    const ra = await connect(ownerOf(ids.A1), ids.A1, GRANT)
    const rb = await connect(ownerOf(ids.B1), ids.B1, GRANT)
    if (!ra.ok || !rb.ok) throw new Error('connect failed')
    a1 = ra
    b1 = rb
  })

  it('a connection reads exactly its own published, listed events — never a sibling site, another tenant or a draft', async () => {
    const { items, raw } = await syncAll(a1.access)
    const live = items.filter((i) => !i.deleted).map((i) => i.id).sort()
    expect(live).toEqual([ids.ev.a1Public, ids.ev.a1WithDraft].sort())
    expect(raw).not.toContain(LEAK) // no other site, no draft text, no foreign venue
    expect(raw).not.toContain(ids.ev.a2Public)
    expect(raw).not.toContain(ids.ev.b1Public)
    expect(raw).not.toContain(ids.ev.a1DraftOnly)
    expect(raw).not.toContain(ids.ev.b1Gone)
    expect(raw).not.toMatch(/"_id"|cnv-/) // never a Sanity document id
    const withDraft = items.find((i) => i.id === ids.ev.a1WithDraft) as { name: Record<string, string> }
    expect(withDraft.name.it).toBe('A1 published title')

    const { items: bItems, raw: bRaw } = await syncAll(b1.access)
    expect(bItems.filter((i) => !i.deleted).map((i) => i.id)).toEqual([ids.ev.b1Public])
    expect(bRaw).not.toContain(ids.ev.a1Public)
    expect(bRaw).not.toContain(ids.ev.a1Gone)
  })

  it('the query alone excludes drafts and other projects, even with a raw (drafts-visible) client', async () => {
    // The app's client already reads the published perspective; this proves
    // the GROQ layer holds by itself (defence in depth).
    const rows = await sanity.fetch<{ publicId: string; title: { it: string } }[]>(
      PARTNER_EVENTS_PAGE_QUERY,
      { projectSlug: slug('a1'), afterT: '1970-01-01T00:00:00Z', afterId: '', upTo: new Date().toISOString() },
      { perspective: 'raw' },
    )
    expect(rows.map((r) => r.publicId).sort()).toEqual([ids.ev.a1Public, ids.ev.a1Unlisted, ids.ev.a1WebsiteOnly, ids.ev.a1WithDraft].sort())
    expect(JSON.stringify(rows)).not.toMatch(/never published|unpublished draft edit|sibling site|other tenant/)
  })

  it('unlisted and website-only events, and deletions, arrive as removals of its own project only', async () => {
    const { items } = await syncAll(a1.access)
    const removed = Object.fromEntries(items.filter((i) => i.deleted).map((i) => [i.id, i.reason]))
    expect(removed).toEqual({
      [ids.ev.a1Unlisted]: 'unlisted',
      [ids.ev.a1WebsiteOnly]: 'websiteOnly',
      [ids.ev.a1Gone]: 'deleted',
    })
    for (const r of items.filter((i) => i.deleted)) expect(Object.keys(r).sort()).toEqual(['deleted', 'id', 'reason', 'updatedAt'])
  })

  it('only granted fields leave Abluo; personal data (hosts) only when ticked', async () => {
    const { items } = await syncAll(a1.access)
    for (const e of items.filter((i) => !i.deleted)) {
      for (const k of Object.keys(e)) expect([...CORE, 'name', 'startDate', 'location'], k).toContain(k)
      expect(e).not.toHaveProperty('description')
      expect(e).not.toHaveProperty('performers')
    }
    const pub = items.find((i) => i.id === ids.ev.a1Public)
    expect(JSON.stringify(pub)).toContain('Sala grande A1') // own venue resolves
  })

  it('a resource that was not granted is refused; the request cannot name another project', async () => {
    expect((await events(a1.access, `?project=${slug('b1')}`)).status).toBe(400)
    expect((await events(a1.access, `?projectSlug=${slug('b1')}`)).status).toBe(400)
    const venuesOnly = await connect(ownerOf(ids.A2), ids.A2, { eventVenue: { fields: ['name'] } })
    if (!venuesOnly.ok) throw new Error(venuesOnly.error)
    const r = await events(venuesOnly.access)
    expect(r.status).toBe(403)
    expect(r.text).not.toContain(LEAK)
  })

  it("one app's credentials never act on another tenant's connection", async () => {
    // Tenant A's controls cannot reach B's connection (and do not confirm it exists).
    expect(await pauseConnection(ownerOf(ids.A1), b1.connectionId, { store })).toEqual({ ok: false, error: 'not_found' })
    expect(await revokeConnection(ownerOf(ids.A1), b1.connectionId, { store })).toEqual({ ok: false, error: 'not_found' })
    expect((await events(b1.access, '?limit=1')).status).toBe(200)
    // A wrong client secret cannot refresh.
    const bad = await token({ grant_type: 'refresh_token', refresh_token: b1.refresh, client_id: ids.app.clientId, client_secret: 'abluo_cs_' + 'x'.repeat(43) })
    expect(bad.status).toBe(401)
  })

  it('website not live, or Events module removed: nothing is read', async () => {
    await db.from('projects').update({ status: 'inactive' }).eq('id', ids.A1)
    const off = await events(a1.access)
    expect(off.status).toBe(403)
    expect(off.text).not.toContain(ids.ev.a1Public)
    // An archived site cannot be connected either.
    expect(await connect(ownerOf(ids.A1), ids.A1, GRANT)).toMatchObject({ ok: false, error: 'project_not_found' })
    await db.from('projects').update({ status: 'active' }).eq('id', ids.A1)

    const projectDoc = `cnv-${RUN}-project-${slug('a1')}`
    await sanity.patch(projectDoc).set({ moduleInstallations: [{ _key: 'events', moduleId: 'events', enabled: false }] }).commit({ visibility: 'sync' })
    const noModule = await events(a1.access)
    expect(noModule.status).toBe(403)
    await sanity.patch(projectDoc).set({ moduleInstallations: [{ _key: 'events', moduleId: 'events', enabled: true }] }).commit({ visibility: 'sync' })
    expect((await events(a1.access, '?limit=1')).status).toBe(200)
  })

  it('pause, resume, revoke: applied on the very next request', async () => {
    expect(await pauseConnection(ownerOf(ids.A1), a1.connectionId, { store })).toEqual({ ok: true, status: 'paused' })
    expect((await events(a1.access)).status).toBe(401)
    expect((await token({ grant_type: 'refresh_token', refresh_token: a1.refresh, ...appCreds() })).status).toBe(400)
    expect(await resumeConnection(ownerOf(ids.A1), a1.connectionId, { store })).toEqual({ ok: true, status: 'active' })
    expect((await events(a1.access, '?limit=1')).status).toBe(200)

    expect(await revokeConnection(ownerOf(ids.A1), a1.connectionId, { store })).toEqual({ ok: true, status: 'revoked' })
    expect((await events(a1.access)).status).toBe(401)
    expect((await token({ grant_type: 'refresh_token', refresh_token: a1.refresh, ...appCreds() })).status).toBe(400)
    // B is untouched by A's revocation.
    expect((await events(b1.access, '?limit=1')).status).toBe(200)
  })

  it('the partner revoking its own refresh token ends its access immediately', async () => {
    const r = await handleRevokeRequest(form({ token: b1.refresh, token_type_hint: 'refresh_token', ...appCreds() }), { store })
    expect(r.status).toBe(200)
    expect((await events(b1.access)).status).toBe(401)
  })

  it('every call was metered against its own connection', async () => {
    const { data } = await db.from('api_usage').select('connection_id').in('connection_id', [a1.connectionId, b1.connectionId])
    const by = (id: string) => (data ?? []).filter((r) => r.connection_id === id).length
    expect(by(a1.connectionId)).toBeGreaterThan(0)
    expect(by(b1.connectionId)).toBeGreaterThan(0)
  })
})
