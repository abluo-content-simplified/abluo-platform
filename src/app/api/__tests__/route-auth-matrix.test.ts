/**
 * ROUTE-LEVEL authorization matrix — every write path and every admin read.
 *
 * Imports and invokes the REAL route handlers / server action with real
 * `Request` objects, for four personas:
 *
 *   anon        — no session
 *   tenantA     — an authenticated tenant user (owner of tenant A only)
 *   adminAal1   — `abluo_admin` who signed in with a password but has NOT
 *                 completed two-factor in this session
 *   adminAal2   — `abluo_admin` at AAL2
 *
 * and asserts both the HTTP outcome AND the absence of side effects: on every
 * refusal, nothing reaches the Sanity write client, the Sanity read client, or
 * the service-role Supabase client. Only the true I/O boundaries are faked
 * (Supabase server/admin clients, the Sanity server clients, the notification
 * consumer); `requireAbluoAdmin`, `resolveAdminAccess`, the AAL decision and
 * the routes' own checks are the real code.
 *
 * The public, anonymous form-submission endpoints are covered route-level by
 * `forms-routes-cross-tenant.test.ts` (tenant derived server-side from the
 * URL's projectSlug, body tenant ids ignored, cross-tenant step completion
 * refused). This file asserts they are the ONLY unauthenticated write
 * surfaces, via the route inventory at the bottom.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { NextRequest } from 'next/server'

// ── Personas ────────────────────────────────────────────────────────────────

type Persona = 'anon' | 'tenantA' | 'adminAal1' | 'adminAal2'

const USERS: Record<Persona, null | { id: string; app_metadata: Record<string, unknown>; aal: string }> = {
  anon: null,
  tenantA: { id: 'user-tenant-a', app_metadata: {}, aal: 'aal1' },
  adminAal1: { id: 'user-admin', app_metadata: { platform_role: 'abluo_admin' }, aal: 'aal1' },
  adminAal2: { id: 'user-admin', app_metadata: { platform_role: 'abluo_admin' }, aal: 'aal2' },
}

let persona: Persona = 'anon'

// ── Fake Supabase (RLS-scoped server client) ────────────────────────────────

type Row = Record<string, unknown>
/** Rows visible per table to the CURRENT session (i.e. what RLS would return). */
let visible: Record<string, Row[]> = {}
const userWrites: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = []

function builder(table: string) {
  const filters: Array<[string, unknown]> = []
  let op = 'select'
  let payload: unknown
  const rows = () =>
    (visible[table] ?? []).filter((r) =>
      filters.every(([k, v]) => (k.startsWith('!') ? r[k.slice(1)] !== v : r[k] === v))
    )
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (k: string, v: unknown) => (filters.push([k, v]), b),
    neq: (k: string, v: unknown) => (filters.push(['!' + k, v]), b),
    order: () => b,
    limit: () => b,
    update: (p: unknown) => ((op = 'update'), (payload = p), b),
    insert: (p: unknown) => ((op = 'insert'), (payload = p), b),
    delete: () => ((op = 'delete'), b),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } }),
    then: (resolve: (v: unknown) => unknown) => {
      if (op !== 'select') userWrites.push({ table, op, payload, filters: [...filters] })
      return Promise.resolve({ data: op === 'select' ? rows() : null, error: null }).then(resolve)
    },
  }
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: USERS[persona] }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: USERS[persona]?.aal ?? null },
          error: null,
        }),
      },
    },
    from: (table: string) => builder(table),
  }),
}))

// ── Fake service-role Supabase ──────────────────────────────────────────────

const serviceRoleCalls: string[] = []
const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: 'invited' } }, error: null }))
const serviceRoleClient = {
  from: (table: string) => (serviceRoleCalls.push(`from:${table}`), builder(table)),
  auth: { admin: { inviteUserByEmail } },
  rpc: async () => (serviceRoleCalls.push('rpc'), { data: 0, error: null }),
}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => (serviceRoleCalls.push('createAdminClient'), serviceRoleClient),
  runAsTrustedSystemOperation: async (reason: string, fn: (c: unknown) => unknown) => {
    serviceRoleCalls.push(`trusted:${reason.slice(0, 30)}`)
    return fn(serviceRoleClient)
  },
}))

// ── Fake Sanity server clients ──────────────────────────────────────────────

const sanityCalls: string[] = []
function fakeSanity(name: string) {
  const patch = () => ({ set: () => ({ commit: async () => (sanityCalls.push(`${name}:patch`), {}) }) })
  return {
    fetch: vi.fn(async () => (sanityCalls.push(`${name}:fetch`), { _id: 'doc', _type: 'mediaAsset' })),
    create: vi.fn(async () => (sanityCalls.push(`${name}:create`), { _id: 'new' })),
    delete: vi.fn(async () => (sanityCalls.push(`${name}:delete`), {})),
    patch: vi.fn(() => (sanityCalls.push(`${name}:patch-start`), patch())),
    assets: { upload: vi.fn(async () => (sanityCalls.push(`${name}:upload`), { _id: 'image-1' })) },
  }
}
vi.mock('@/lib/sanity/server-clients', () => ({
  sanityWriteClient: fakeSanity('write'),
  sanityServerReadClient: fakeSanity('read'),
}))
vi.mock('@/lib/sanity/client', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { ...real, sanityClient: fakeSanity('website') }
})

// ── Other I/O ───────────────────────────────────────────────────────────────

const deliverEvent = vi.fn(async () => ({ delivered: 0 }))
const sweepFormEvents = vi.fn(async () => ({ swept: 0 }))
vi.mock('@/lib/notifications/consumer', () => ({ deliverEvent, sweepFormEvents }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let tenantCtx: unknown = null
vi.mock('@/lib/api/tenant-context', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { ...real, getTenantAuthorizationContext: async () => tenantCtx }
})

beforeEach(() => {
  persona = 'anon'
  visible = {}
  tenantCtx = null
  userWrites.length = 0
  serviceRoleCalls.length = 0
  sanityCalls.length = 0
  inviteUserByEmail.mockClear()
  deliverEvent.mockClear()
  sweepFormEvents.mockClear()
  process.env.CRON_SECRET = 'cron-secret'
  process.env.FORM_EVENTS_WEBHOOK_SECRET = 'hook-secret'
  process.env.MIGRATION_SECRET = 'migrate-secret'
})

// ── Helpers ─────────────────────────────────────────────────────────────────

const BASE = 'https://admin.abluo.app'
const req = (path: string, init: RequestInit = {}) => new NextRequest(new URL(path, BASE), init as never)
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

function noSideEffects() {
  expect(sanityCalls, 'Sanity was touched').toEqual([])
  expect(serviceRoleCalls, 'service role was used').toEqual([])
  expect(userWrites, 'a Supabase write was issued').toEqual([])
}

// ── The admin-only routes ───────────────────────────────────────────────────

type Call = { name: string; run: () => Promise<Response> }

function multipart(fields: Record<string, string | Blob>): RequestInit {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return { method: 'POST', body: fd }
}

const ADMIN_ONLY: Call[] = [
  { name: 'GET /api/sanity/document', run: async () => (await import('@/app/api/sanity/document/route')).GET(req('/api/sanity/document?id=x')) },
  { name: 'GET /api/sanity/projects', run: async () => (await import('@/app/api/sanity/projects/route')).GET(req('/api/sanity/projects?tenantId=t')) },
  { name: 'GET /api/sanity/tenant', run: async () => (await import('@/app/api/sanity/tenant/route')).GET(req('/api/sanity/tenant?id=t')) },
  { name: 'GET /api/sanity/tenants', run: async () => (await import('@/app/api/sanity/tenants/route')).GET(req('/api/sanity/tenants')) },
  { name: 'GET /api/media', run: async () => (await import('@/app/api/media/route')).GET(req('/api/media')) },
  {
    name: 'POST /api/media',
    run: async () =>
      (await import('@/app/api/media/route')).POST(
        req('/api/media', multipart({ file: new Blob(['x'], { type: 'image/png' }), tenant: 'client-b', altText: 'a' }))
      ),
  },
  { name: 'PATCH /api/media/[id]', run: async () => (await import('@/app/api/media/[id]/route')).PATCH(req('/api/media/m1', { ...json({ tags: ['x'] }), method: 'PATCH' }), ctx({ id: 'm1' })) },
  { name: 'DELETE /api/media/[id]', run: async () => (await import('@/app/api/media/[id]/route')).DELETE(req('/api/media/m1', { method: 'DELETE' }), ctx({ id: 'm1' })) },
  { name: 'GET /api/media/tags', run: async () => (await import('@/app/api/media/tags/route')).GET(req('/api/media/tags')) },
  { name: 'GET /api/media/scopes', run: async () => (await import('@/app/api/media/scopes/route')).GET(req('/api/media/scopes')) },
  {
    name: 'POST /api/media/migrate (WITH the correct secret)',
    run: async () => (await import('@/app/api/media/migrate/route')).POST(req('/api/media/migrate', { method: 'POST', headers: { authorization: 'Bearer migrate-secret' } })),
  },
  { name: 'POST /api/translate', run: async () => (await import('@/app/api/translate/route')).POST(req('/api/translate', json({ projectSlug: 'b', text: 'x' }))) },
  { name: 'GET /api/translate/status', run: async () => (await import('@/app/api/translate/status/route')).GET(req('/api/translate/status?projectSlug=b')) },
  { name: 'POST /api/tenants/[tenantId]/invite', run: async () => (await import('@/app/api/tenants/[tenantId]/invite/route')).POST(req('/api/tenants/t/invite', json({ email: 'x@y.z' })), ctx({ tenantId: 't' })) },
]

describe('admin-only routes refuse everyone but a two-factor admin', () => {
  for (const p of ['anon', 'tenantA', 'adminAal1'] as const) {
    for (const call of ADMIN_ONLY) {
      it(`${p} → ${call.name} is refused with no side effects`, async () => {
        persona = p
        const res = await call.run()
        expect([401, 403]).toContain(res.status)
        noSideEffects()
      })
    }
  }

  it('adminAal2 passes the gate (GET /api/sanity/document reaches Sanity with the server read client)', async () => {
    persona = 'adminAal2'
    const res = await (await import('@/app/api/sanity/document/route')).GET(req('/api/sanity/document?id=x'))
    expect(res.status).toBe(200)
    expect(sanityCalls).toEqual(['read:fetch'])
  })

  it('a leaked MIGRATION_SECRET alone is not enough: wrong/absent secret is 401 even for adminAal2', async () => {
    persona = 'adminAal2'
    const { POST } = await import('@/app/api/media/migrate/route')
    expect((await POST(req('/api/media/migrate', { method: 'POST' }))).status).toBe(401)
    expect((await POST(req('/api/media/migrate', { method: 'POST', headers: { authorization: 'Bearer nope' } }))).status).toBe(401)
    noSideEffects()
  })
})

// ── Media: cross-tenant reference on upload (adminAal2) ─────────────────────

describe('POST /api/media refuses a project that belongs to another tenant', () => {
  it('rejects before uploading anything', async () => {
    persona = 'adminAal2'
    const { sanityWriteClient } = await import('@/lib/sanity/server-clients')
    ;(sanityWriteClient.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      sanityCalls.push('write:fetch')
      return { tenantExists: true, project: { projectSlug: 'hoffmann', clientId: 'client-b' } }
    })
    const { POST } = await import('@/app/api/media/route')
    const res = await POST(
      req('/api/media', multipart({ file: new Blob(['x'], { type: 'image/png' }), tenant: 'client-a', project: 'project-hoffmann', altText: 'a' }))
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'project_not_owned_by_tenant' })
    expect(sanityCalls).toEqual(['write:fetch']) // the ownership lookup only — no upload, no create
  })
})

// ── Tenant-facing writes ────────────────────────────────────────────────────

describe('POST /api/projects/[projectId]/invite — tenant derived from the authenticated grant', () => {
  const call = async (projectId: string) =>
    (await import('@/app/api/projects/[projectId]/invite/route')).POST(
      req(`/api/projects/${projectId}/invite`, json({ email: 'new@x.y', role: 'editor', tenant_id: 'tenant-a' })),
      ctx({ projectId })
    )

  it('anon is refused with no side effects', async () => {
    expect((await call('project-b')).status).toBe(403)
    noSideEffects()
  })

  it("tenant A's owner cannot invite into tenant B's project (body tenant_id is ignored)", async () => {
    persona = 'tenantA'
    visible = {
      projects: [{ id: 'project-b', tenant_id: 'tenant-b' }],
      tenant_members: [{ id: 'm1', tenant_id: 'tenant-a', user_id: 'user-tenant-a', role: 'owner' }],
    }
    const res = await call('project-b')
    expect(res.status).toBe(403)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    noSideEffects()
  })

  it("tenant A's owner CAN invite into tenant A's project", async () => {
    persona = 'tenantA'
    visible = {
      projects: [{ id: 'project-a', tenant_id: 'tenant-a' }],
      tenant_members: [{ id: 'm1', tenant_id: 'tenant-a', user_id: 'user-tenant-a', role: 'owner' }],
    }
    const res = await call('project-a')
    expect(res.status).toBe(200)
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1)
    expect((inviteUserByEmail.mock.calls[0] as unknown[])[1]).toMatchObject({ data: { project_id: 'project-a' } })
  })
})

describe('setSubmissionStatusAction — the dashboard lead-status server action', () => {
  const grantA = {
    projectId: 'project-a',
    projectSlug: 'tenant-a-site',
    membershipId: 'tenant-owner:tenant-a',
    role: 'owner',
    permissions: ['forms.submission.read', 'forms.submission.update'],
    enabledModuleIds: ['forms'],
  }

  // The first import of the server action pulls in next-intl, Supabase and Sanity
  // clients. Under full-suite load that cold import alone can exceed the 5s
  // per-test limit, so load it once here instead of charging it to the first case.
  beforeAll(async () => {
    await import('@/app/[locale]/(client)/[tenant]/submissions/actions')
  }, 30_000)

  it('unauthenticated → refused, nothing written', async () => {
    const { setSubmissionStatusAction } = await import('@/app/[locale]/(client)/[tenant]/submissions/actions')
    const r = await setSubmissionStatusAction({ projectSlug: 'tenant-b-site', submissionId: 's1', status: 'archived', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'unauthenticated' })
    noSideEffects()
  })

  it("tenant A cannot change a lead on tenant B's project", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const { setSubmissionStatusAction } = await import('@/app/[locale]/(client)/[tenant]/submissions/actions')
    const r = await setSubmissionStatusAction({ projectSlug: 'tenant-b-site', submissionId: 's1', status: 'archived', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it("tenant A's update is scoped to tenant A's project id from the GRANT, not the client", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const { setSubmissionStatusAction } = await import('@/app/[locale]/(client)/[tenant]/submissions/actions')
    const r = await setSubmissionStatusAction({ projectSlug: 'tenant-a-site', submissionId: 's1', status: 'processed', locale: 'en' })
    expect(r).toEqual({ ok: true })
    expect(userWrites).toHaveLength(1)
    expect(userWrites[0].table).toBe('form_submissions')
    expect(userWrites[0].filters).toContainEqual(['project_id', 'project-a'])
    expect(userWrites[0].filters).toContainEqual(['id', 's1'])
  })
})

describe('post draft server actions — the dashboard\'s only Sanity write path (S2b)', () => {
  const grantA = {
    projectId: 'project-a',
    projectSlug: 'tenant-a-site',
    membershipId: 'tenant-owner:tenant-a',
    role: 'owner',
    permissions: ['blog.post.read', 'blog.post.write'],
    enabledModuleIds: ['blog'],
  }
  const viewerA = { ...grantA, role: 'viewer', permissions: ['blog.post.read'] }
  const ID = '11111111-2222-4333-8444-555555555555'
  const load = () => import('@/app/[locale]/(client)/[tenant]/posts/actions')

  beforeAll(async () => {
    await load()
  }, 30_000)

  it('unauthenticated → refused, nothing touched', async () => {
    const a = await load()
    expect(await a.createPostDraftAction({ projectSlug: 'tenant-a-site' })).toEqual({ ok: false, error: 'unauthenticated' })
    expect(await a.patchPostDraftAction({ projectSlug: 'tenant-a-site', id: ID, rev: 'r', set: { 'title.it': 'x' } })).toEqual({
      ok: false,
      error: 'unauthenticated',
    })
    noSideEffects()
  })

  it("tenant A cannot create or patch in tenant B's project", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    expect(await a.createPostDraftAction({ projectSlug: 'tenant-b-site' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await a.patchPostDraftAction({ projectSlug: 'tenant-b-site', id: ID, rev: 'r', set: { 'title.it': 'x' } })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    noSideEffects()
  })

  it('a viewer cannot create or patch', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    const a = await load()
    expect(await a.createPostDraftAction({ projectSlug: 'tenant-a-site' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await a.patchPostDraftAction({ projectSlug: 'tenant-a-site', id: ID, rev: 'r', set: { 'title.it': 'x' } })).toEqual({
      ok: false,
      error: 'forbidden',
    })
    noSideEffects()
  })

  it('a forbidden field is refused before anything is read or written', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    const r = await a.patchPostDraftAction({ projectSlug: 'tenant-a-site', id: 'not-a-uuid', rev: 'r', set: { projectSlug: 'tenant-b-site' } })
    expect(r).toEqual({ ok: false, error: 'not_found' })
    noSideEffects()
  })

  it("an owner's new draft gets its id, type and projectSlug from the SERVER", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    const r = await a.createPostDraftAction({ projectSlug: 'tenant-a-site', projectId: 'project-b', _type: 'page' } as never)
    expect(r.ok).toBe(true)
    const { sanityWriteClient } = await import('@/lib/sanity/server-clients')
    const doc = (sanityWriteClient.create as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(doc._id).toMatch(/^drafts\.[0-9a-f-]{36}$/)
    expect(doc._type).toBe('post')
    expect(doc.projectSlug).toBe('tenant-a-site')
    expect(sanityCalls).toEqual(['write:create'])
  })
})

// ── Machine-to-machine routes ───────────────────────────────────────────────

describe('cron / webhook routes require their shared secret', () => {
  const cases: Array<{ name: string; run: (h?: Record<string, string>) => Promise<Response> }> = [
    { name: 'GET /api/cron/keep-alive', run: async (h = {}) => (await import('@/app/api/cron/keep-alive/route')).GET(req('/api/cron/keep-alive', { headers: h })) },
    { name: 'GET /api/cron/form-events-sweep', run: async (h = {}) => (await import('@/app/api/cron/form-events-sweep/route')).GET(req('/api/cron/form-events-sweep', { headers: h })) },
  ]
  for (const c of cases) {
    it(`${c.name}: no / wrong secret → 401, nothing runs; even for an admin session`, async () => {
      persona = 'adminAal2'
      expect((await c.run()).status).toBe(401)
      expect((await c.run({ authorization: 'Bearer wrong' })).status).toBe(401)
      expect(sweepFormEvents).not.toHaveBeenCalled()
      noSideEffects()
    })
  }

  it('POST /api/webhooks/form-events: no / wrong secret → 401, nothing delivered', async () => {
    const { POST } = await import('@/app/api/webhooks/form-events/route')
    expect((await POST(new Request(`${BASE}/api/webhooks/form-events`, json({ record: { event_id: 'e' } })))).status).toBe(401)
    expect(
      (await POST(new Request(`${BASE}/api/webhooks/form-events`, json({ record: { event_id: 'e' } }, { 'x-webhook-secret': 'nope' })))).status
    ).toBe(401)
    expect(deliverEvent).not.toHaveBeenCalled()
  })

  it('POST /api/webhooks/form-events: correct secret delivers', async () => {
    const { POST } = await import('@/app/api/webhooks/form-events/route')
    const res = await POST(new Request(`${BASE}/api/webhooks/form-events`, json({ record: { event_id: 'e' } }, { 'x-webhook-secret': 'hook-secret' })))
    expect(res.status).toBe(200)
    expect(deliverEvent).toHaveBeenCalledWith('e')
  })
})

// ── Inventory: every API route is classified ────────────────────────────────

/**
 * Adding a route under src/app/api without deciding which class it is in
 * fails here. PUBLIC_WRITES is the complete list of endpoints an anonymous
 * caller may write through; each derives its tenant from the URL's
 * projectSlug server-side (forms-routes-cross-tenant.test.ts).
 */
const CLASSIFIED: Record<string, 'admin' | 'tenant' | 'machine' | 'public-read' | 'public-write'> = {
  'sanity/document': 'admin',
  'sanity/projects': 'admin',
  'sanity/tenant': 'admin',
  'sanity/tenants': 'admin',
  media: 'admin',
  'media/[id]': 'admin',
  'media/tags': 'admin',
  'media/scopes': 'admin',
  'media/migrate': 'admin',
  translate: 'admin',
  'translate/status': 'admin',
  'tenants/[tenantId]/invite': 'admin',
  'projects/[projectId]/invite': 'tenant',
  'cron/keep-alive': 'machine',
  'cron/form-events-sweep': 'machine',
  'webhooks/form-events': 'machine',
  'auth/me': 'public-read', // returns only the caller's own role, or null
  version: 'public-read',
  'fonts/css': 'public-read',
  'fonts/file/[...path]': 'public-read',
  'forms/[projectSlug]/[formId]/submissions': 'public-write',
  'forms/[projectSlug]/[formId]/submissions/[id]/steps': 'public-write',
}

describe('API route inventory', () => {
  it('every route under src/app/api is classified', () => {
    const apiDir = resolve(__dirname, '..')
    const found: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) {
          if (n !== '__tests__') walk(p)
        } else if (n === 'route.ts') found.push(relative(apiDir, d))
      }
    }
    walk(apiDir)
    expect(found.sort()).toEqual(Object.keys(CLASSIFIED).sort())
    expect(Object.entries(CLASSIFIED).filter(([, c]) => c === 'admin').map(([k]) => k).sort()).toEqual(
      [
        'media', 'media/[id]', 'media/migrate', 'media/scopes', 'media/tags',
        'sanity/document', 'sanity/projects', 'sanity/tenant', 'sanity/tenants',
        'tenants/[tenantId]/invite', 'translate', 'translate/status',
      ].sort()
    )
  })
})
