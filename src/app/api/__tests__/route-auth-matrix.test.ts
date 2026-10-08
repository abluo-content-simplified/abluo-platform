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
    is: () => b,
    gt: () => b,
    in: () => b,
    neq: (k: string, v: unknown) => (filters.push(['!' + k, v]), b),
    order: () => b,
    limit: () => b,
    update: (p: unknown) => ((op = 'update'), (payload = p), b),
    insert: (p: unknown) => ((op = 'insert'), (payload = p), b),
    delete: () => ((op = 'delete'), b),
    maybeSingle: async () => {
      if (op !== 'select') userWrites.push({ table, op, payload, filters: [...filters] })
      return { data: rows()[0] ?? null, error: null }
    },
    single: async () => {
      if (op !== 'select') userWrites.push({ table, op, payload, filters: [...filters] })
      return { data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } }
    },
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
const getUserById = vi.fn(async (id: string) => ({ data: { user: { id, email: `${id}@x.y`, app_metadata: {} } }, error: null }))
const serviceRoleClient = {
  from: (table: string) => (serviceRoleCalls.push(`from:${table}`), builder(table)),
  auth: { admin: { inviteUserByEmail, getUserById } },
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
    // count(...) = the single-Sanity-project write guard (sanity-project-guard.ts).
    fetch: vi.fn(async (q?: string) =>
      (sanityCalls.push(`${name}:fetch`), typeof q === 'string' && q.startsWith('count(') ? 1 : { _id: 'doc', _type: 'mediaAsset' })
    ),
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
const sendInvite = vi.fn(async () => ({ ok: true, id: 'mail-1' }))
vi.mock('@/lib/notifications/resend', () => ({ sendEmail: sendInvite }))
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
  sendInvite.mockClear()
  deliverEvent.mockClear()
  sweepFormEvents.mockClear()
  process.env.CRON_SECRET = 'cron-secret'
  process.env.FORM_EVENTS_WEBHOOK_SECRET = 'hook-secret'
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

const ADMIN_ONLY: Call[] = [
  { name: 'GET /api/sanity/document', run: async () => (await import('@/app/api/sanity/document/route')).GET(req('/api/sanity/document?id=x')) },
  { name: 'GET /api/sanity/projects', run: async () => (await import('@/app/api/sanity/projects/route')).GET(req('/api/sanity/projects?tenantId=t')) },
  { name: 'GET /api/sanity/tenant', run: async () => (await import('@/app/api/sanity/tenant/route')).GET(req('/api/sanity/tenant?id=t')) },
  { name: 'GET /api/sanity/tenants', run: async () => (await import('@/app/api/sanity/tenants/route')).GET(req('/api/sanity/tenants')) },
  { name: 'POST /api/translate', run: async () => (await import('@/app/api/translate/route')).POST(req('/api/translate', json({ projectSlug: 'b', text: 'x' }))) },
  { name: 'GET /api/translate/status', run: async () => (await import('@/app/api/translate/status/route')).GET(req('/api/translate/status?projectSlug=b')) },
  { name: 'POST /api/tenants/[tenantId]/invite', run: async () => (await import('@/app/api/tenants/[tenantId]/invite/route')).POST(req('/api/tenants/t/invite', json({ email: 'x@y.z' })), ctx({ tenantId: 't' })) },
]

describe('admin-only routes refuse everyone but a two-factor admin', () => {
  // The tenant invite route pulls in the invitation service + resolver + module
  // registry; under full-suite load that cold import alone can exceed 5s.
  beforeAll(async () => {
    await import('@/app/api/tenants/[tenantId]/invite/route')
  }, 30_000)
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
})

// ── Tenant-facing writes ────────────────────────────────────────────────────

describe('POST /api/projects/[projectId]/invite — authorized from the resolved grant (ADR-028)', () => {
  const call = async (projectId: string, role = 'editor') =>
    (await import('@/app/api/projects/[projectId]/invite/route')).POST(
      req(`/api/projects/${projectId}/invite`, json({ email: 'new@x.y', role, tenant_id: 'tenant-a' })),
      ctx({ projectId })
    )
  const grantOn = async (projectId: string, role: 'owner' | 'admin' | 'editor' | 'viewer') => {
    const { grantPermissions } = await import('@/lib/api/tenant-context')
    return {
      projectId,
      projectSlug: `${projectId}-site`,
      membershipId: role === 'owner' ? 'tenant-owner:tenant-a' : 'pm-1',
      role,
      permissions: grantPermissions(role as 'owner', []),
      enabledModuleIds: [],
    }
  }
  // Cold import (route + resolver + module registry) can exceed 5s under full-suite load.
  beforeAll(async () => {
    await import('@/app/api/projects/[projectId]/invite/route')
  }, 30_000)
  const asUser = async (...grants: Awaited<ReturnType<typeof grantOn>>[]) => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: grants }
  }

  it('anon is refused with no side effects', async () => {
    expect((await call('project-b')).status).toBe(403)
    noSideEffects()
  })

  const invitationWrites = () => userWrites.filter((w) => w.table === 'invitations' && w.op === 'insert')
  const projectA = () => {
    visible = {
      projects: [{ id: 'project-a', name: 'Site A', slug: 'project-a-site', tenant_id: 'tenant-a' }],
      invitations: [{ id: 'inv-1', expires_at: '2026-10-21T00:00:00Z' }],
    }
  }

  it("tenant A's owner cannot invite into tenant B's project (body tenant_id is ignored)", async () => {
    await asUser(await grantOn('project-a', 'owner'))
    const res = await call('project-b')
    expect(res.status).toBe(403)
    expect(sendInvite).not.toHaveBeenCalled()
    expect(serviceRoleCalls.some((c) => c.includes('invitations'))).toBe(false) // refused before any service-role I/O
    noSideEffects()
  })

  it("tenant A's owner CAN invite an Editor into tenant A's project — a record + one email, never a membership", async () => {
    await asUser(await grantOn('project-a', 'owner'))
    projectA()
    const res = await call('project-a')
    expect(res.status).toBe(200)
    expect(sendInvite).toHaveBeenCalledTimes(1)
    const mail = (sendInvite.mock.calls[0] as unknown as [{ to: string[]; fromName: string; replyTo: string; html: string }])[0]
    expect(mail.to).toEqual(['new@x.y'])
    expect(mail.fromName).toMatch(/via Abluo$/)
    expect(mail.replyTo).toBe('user-tenant-a@x.y')
    const [w] = invitationWrites()
    expect(w.payload).toMatchObject({ email: 'new@x.y', scope_type: 'project', project_id: 'project-a', role: 'editor', invited_by: 'user-tenant-a' })
    const stored = (w.payload as { token_hash: string }).token_hash
    expect(stored).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // The link carries the token; the database only its hash.
    const link = mail.html.match(/token=([A-Za-z0-9_-]{43})/)![1]
    expect(link).not.toBe(stored)
    expect(userWrites.some((x) => x.table === 'project_members' || x.table === 'tenant_members')).toBe(false)
  })

  it('an Owner may invite a Site admin; a Site admin may invite an Editor but not a Site admin', async () => {
    await asUser(await grantOn('project-a', 'owner'))
    projectA()
    expect((await call('project-a', 'admin')).status).toBe(200)
    await asUser(await grantOn('project-a', 'admin'))
    expect((await call('project-a', 'editor')).status).toBe(200)
    sendInvite.mockClear()
    expect((await call('project-a', 'admin')).status).toBe(403)
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it('an Editor or Viewer cannot invite anyone', async () => {
    for (const role of ['editor', 'viewer'] as const) {
      sendInvite.mockClear()
      await asUser(await grantOn('project-a', role))
      projectA()
      expect((await call('project-a')).status).toBe(403)
      expect(sendInvite).not.toHaveBeenCalled()
    }
  })

  it('tenant-level and retired roles are not invitable on a site', async () => {
    await asUser(await grantOn('project-a', 'owner'))
    projectA()
    for (const role of ['viewer', 'owner', 'member', 'superuser']) {
      expect((await call('project-a', role)).status).toBe(400)
    }
    expect(sendInvite).not.toHaveBeenCalled()
  })

  it('a bad email is refused before anything is written', async () => {
    await asUser(await grantOn('project-a', 'owner'))
    projectA()
    const res = await (await import('@/app/api/projects/[projectId]/invite/route')).POST(
      req('/api/projects/project-a/invite', json({ email: 'not an email', role: 'editor' })),
      ctx({ projectId: 'project-a' })
    )
    expect(res.status).toBe(400)
    expect(invitationWrites()).toEqual([])
  })
})

describe('People server actions — Owner / Site admin only, nothing touched on refusal (ADR-028)', () => {
  const load = () => import('@/app/[locale]/(client)/[tenant]/people/actions')
  beforeAll(async () => {
    await load()
  }, 30_000)
  const grant = async (role: 'owner' | 'admin' | 'editor') => {
    const { grantPermissions } = await import('@/lib/api/tenant-context')
    return { projectId: 'project-a', projectSlug: 'tenant-a-site', membershipId: 'm', role, permissions: grantPermissions(role as 'owner', ['forms']), enabledModuleIds: ['forms'] }
  }
  const all = async (projectSlug: string) => {
    const a = await load()
    return [
      await a.invitePersonAction({ projectSlug, locale: 'en', email: 'x@y.z', role: 'editor', extras: [] }),
      await a.cancelInvitationAction({ projectSlug, locale: 'en', invitationId: '00000000-0000-4000-8000-000000000001' }),
      await a.updatePersonAction({ projectSlug, locale: 'en', membershipId: 'pm-1', role: 'editor', extras: [] }),
      await a.archivePersonAction({ projectSlug, locale: 'en', membershipId: 'pm-1' }),
      await a.restorePersonAction({ projectSlug, locale: 'en', archiveId: '00000000-0000-4000-8000-000000000002' }),
      await a.resendInvitationAction({ projectSlug, locale: 'en', invitationId: '00000000-0000-4000-8000-000000000001' }),
    ]
  }

  it('signed out → every action refused, nothing touched', async () => {
    for (const r of await all('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })
  it('another client’s site → refused before any service-role I/O', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [await grant('owner')] }
    for (const r of await all('tenant-b-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(serviceRoleCalls).toEqual([])
    noSideEffects()
  })
  it('an Editor on the site → refused, no write and no email', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [await grant('editor')] }
    for (const r of await all('tenant-a-site')) expect(r.ok).toBe(false)
    expect(userWrites).toEqual([])
    expect(sendInvite).not.toHaveBeenCalled()
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

  it('an Editor who may only SEE contact requests cannot change, batch-change or delete them (ADR-028)', async () => {
    persona = 'tenantA'
    const { grantPermissions } = await import('@/lib/api/tenant-context')
    const permissions = grantPermissions('editor', ['forms'], undefined, { projectExtras: ['forms.submission.read'] })
    expect(permissions).toContain('forms.submission.read')
    expect(permissions).not.toContain('forms.submission.update')
    expect(permissions).not.toContain('forms.submission.delete')
    tenantCtx = {
      userId: 'user-tenant-a',
      platformRole: 'tenant_user',
      projects: [{ ...grantA, membershipId: 'pm-editor', role: 'editor', permissions }],
    }
    const a = await import('@/app/[locale]/(client)/[tenant]/submissions/actions')
    const base = { projectSlug: 'tenant-a-site', locale: 'en' }
    expect((await a.setSubmissionStatusAction({ ...base, submissionId: 's1', status: 'archived' })).ok).toBe(false)
    expect((await a.setSubmissionsStatusBatchAction({ ...base, submissionIds: ['s1'], status: 'processed' })).ok).toBe(false)
    expect((await a.deleteSubmissionsAction({ ...base, submissionIds: ['s1'] })).ok).toBe(false)
    expect(userWrites).toEqual([])
    expect(serviceRoleCalls).toEqual([])
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
    const r = await a.patchPostDraftAction({ projectSlug: 'tenant-a-site', id: '../not-a-uuid', rev: 'r', set: { projectSlug: 'tenant-b-site' } })
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
    // The draft-count cap and the single-project guard reads, then the one write.
    expect(sanityCalls).toEqual(['write:fetch', 'write:fetch', 'write:create'])
  })

  // S2c — the wizard also calls publish (S5) and Improve (ADR-026). Same refusals.
  const loadPublish = () => import('@/app/[locale]/(client)/[tenant]/posts/publish-actions')
  const loadAi = () => import('@/app/[locale]/(client)/[tenant]/posts/ai-actions')
  const publishInput = (projectSlug: string) => ({ projectSlug, id: ID, rev: 'r', mode: 'now' as const })
  const improveInput = (projectSlug: string) => ({
    projectSlug,
    locale: 'it',
    blocks: [{ _type: 'block', _key: 'b', children: [{ _type: 'span', _key: 's', text: 'ciao '.repeat(40) }] }],
  })

  it('publish + improve: unauthenticated → refused, nothing touched', async () => {
    const p = await loadPublish()
    const ai = await loadAi()
    expect(await p.publishPostDraftAction(publishInput('tenant-a-site'))).toEqual({ ok: false, error: 'unauthenticated' })
    expect(await ai.improvePostBodyAction(improveInput('tenant-a-site'))).toEqual({ ok: false, error: 'unauthenticated' })
    expect(await ai.improvePostLineAction({ projectSlug: 'tenant-a-site', locale: 'it', field: 'title', text: 'Ciao' })).toEqual({ ok: false, error: 'unauthenticated' })
    noSideEffects()
  }, 30_000)

  it("publish + improve: tenant A cannot act in tenant B's project", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const p = await loadPublish()
    const ai = await loadAi()
    expect(await p.publishPostDraftAction(publishInput('tenant-b-site'))).toEqual({ ok: false, error: 'forbidden' })
    expect(await ai.improvePostBodyAction(improveInput('tenant-b-site'))).toEqual({ ok: false, error: 'forbidden' })
    expect(await ai.improvePostLineAction({ projectSlug: 'tenant-b-site', locale: 'it', field: 'title', text: 'Ciao' })).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('publish + improve: a viewer is refused', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    const p = await loadPublish()
    const ai = await loadAi()
    expect(await p.publishPostDraftAction(publishInput('tenant-a-site'))).toEqual({ ok: false, error: 'forbidden' })
    expect(await ai.improvePostBodyAction(improveInput('tenant-a-site'))).toEqual({ ok: false, error: 'forbidden' })
    expect(await ai.improvePostLineAction({ projectSlug: 'tenant-a-site', locale: 'it', field: 'title', text: 'Ciao' })).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  // Wave 2 — editing live posts and lifecycle actions. Same refusals, nothing touched.
  const loadLifecycle = () => import('@/app/[locale]/(client)/[tenant]/posts/lifecycle-actions')
  const lifecycleCalls = async (projectSlug: string, id = 'hoffmann-post-x') => {
    const l = await loadLifecycle()
    const input = { projectSlug, id, rev: 'r' }
    return [
      await l.openPostForEditAction({ projectSlug, id }),
      await l.takePostOfflineAction(input),
      await l.putPostBackOnlineAction(input),
      await l.discardPostChangesAction(input),
      await l.deletePostDraftAction(input),
      await l.deletePublishedPostAction(input),
      await l.setPostFeaturedAction({ projectSlug, id, featured: true }),
    ]
  }

  it('lifecycle: unauthenticated → refused, nothing touched', async () => {
    for (const r of await lifecycleCalls('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'unauthenticated' })
    noSideEffects()
  }, 30_000)

  it("lifecycle: tenant A cannot act in tenant B's project", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    for (const r of await lifecycleCalls('tenant-b-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('lifecycle: a viewer is refused every action', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    for (const r of await lifecycleCalls('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('batch posts: unauthenticated, another tenant and a viewer are refused, nothing touched', async () => {
    const l = await loadLifecycle()
    const batch = (projectSlug: string) => l.batchPostsAction({ projectSlug, ids: ['hoffmann-post-x'], op: 'offline' })
    expect(await batch('tenant-a-site')).toEqual({ ok: false, error: 'unauthenticated' })
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    expect(await batch('tenant-b-site')).toEqual({ ok: false, error: 'forbidden' })
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    expect(await batch('tenant-a-site')).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  }, 30_000)

  it('lifecycle: an editor cannot delete a published post', async () => {
    persona = 'tenantA'
    tenantCtx = {
      userId: 'user-tenant-a',
      platformRole: 'tenant_user',
      projects: [{ ...grantA, role: 'editor', permissions: ['blog.post.read', 'blog.post.write', 'blog.post.delete'] }],
    }
    const l = await loadLifecycle()
    expect(await l.deletePublishedPostAction({ projectSlug: 'tenant-a-site', id: 'hoffmann-post-x', rev: 'r' })).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('lifecycle: unsafe ids are not_found before anything is read', async () => {
    persona = 'tenantA'
    tenantCtx = {
      userId: 'user-tenant-a',
      platformRole: 'tenant_user',
      projects: [{ ...grantA, permissions: ['blog.post.read', 'blog.post.write', 'blog.post.delete', 'blog.published.delete'] }],
    }
    for (const id of ['drafts.x', '../x', 'a/b']) {
      for (const r of await lifecycleCalls('tenant-a-site', id)) expect(r).toEqual({ ok: false, error: 'not_found' })
    }
    noSideEffects()
  })

  // Galleries — the private preview link (the gallery write actions are covered by their owner's tests).
  const loadGalleryPreview = () => import('@/app/[locale]/(client)/[tenant]/galleries/preview-actions')
  const galleryGrantA = { ...grantA, permissions: ['gallery.gallery.read', 'gallery.gallery.write'], enabledModuleIds: ['gallery'] }

  it('gallery preview: unauthenticated, other tenant and viewer are refused, nothing read', async () => {
    const g = await loadGalleryPreview()
    expect(await g.mintGalleryPreviewAction({ projectSlug: 'tenant-a-site', id: 'g1' })).toEqual({ ok: false, error: 'unauthenticated' })
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [galleryGrantA] }
    expect(await g.mintGalleryPreviewAction({ projectSlug: 'tenant-b-site', id: 'g1' })).toEqual({ ok: false, error: 'forbidden' })
    tenantCtx = {
      userId: 'user-tenant-a',
      platformRole: 'tenant_user',
      projects: [{ ...galleryGrantA, role: 'viewer', permissions: ['gallery.gallery.read'] }],
    }
    expect(await g.mintGalleryPreviewAction({ projectSlug: 'tenant-a-site', id: 'g1' })).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  }, 30_000)

  it('gallery preview: unsafe ids are not_found before anything is read', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [galleryGrantA] }
    const g = await loadGalleryPreview()
    process.env.PREVIEW_SECRET = 'route-auth-matrix-secret-1234'
    expect(await g.mintGalleryPreviewAction({ projectSlug: 'tenant-a-site', id: '../g1' })).toEqual({ ok: false, error: 'not_found' })
    expect(await g.mintGalleryPreviewAction({ projectSlug: 'tenant-a-site', id: 'g1', pageId: 'drafts.x' })).toEqual({ ok: false, error: 'not_found' })
    delete process.env.PREVIEW_SECRET
    noSideEffects()
  })

  it('publish: a malformed id is not_found before anything is read', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const p = await loadPublish()
    expect(await p.publishPostDraftAction({ ...publishInput('tenant-a-site'), id: '../x' })).toEqual({ ok: false, error: 'not_found' })
    noSideEffects()
  })
})

// ── Gallery server actions (client dashboard) ───────────────────────────────

describe('gallery server actions — same refusals as posts', () => {
  const grantA = {
    projectId: 'project-a',
    projectSlug: 'tenant-a-site',
    membershipId: 'tenant-owner:tenant-a',
    role: 'owner',
    permissions: ['gallery.gallery.read', 'gallery.gallery.write', 'gallery.gallery.delete'],
    enabledModuleIds: ['gallery'],
  }
  const viewerA = { ...grantA, role: 'viewer', permissions: ['gallery.gallery.read'] }
  const load = () => import('@/app/[locale]/(client)/[tenant]/galleries/actions')
  const writes = async (projectSlug: string, id = 'gallery-x') => {
    const a = await load()
    const fd = new FormData()
    fd.set('projectSlug', projectSlug)
    fd.set('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'a.jpg', { type: 'image/jpeg' }))
    return [
      await a.openGalleryForEditAction({ projectSlug, id }),
      await a.createGalleryAction({ projectSlug, title: 'x' }),
      await a.patchGalleryDraftAction({ projectSlug, id, rev: 'r', set: { 'title.it': 'x' } }),
      await a.updateGalleryPhotoAction({ projectSlug, assetId: 'm1', alt: { it: 'x' } }),
      await a.batchGalleryPhotosAction({ projectSlug, assetIds: ['m1', 'm2'], baseName: 'x', addTags: ['y'] }),
      await a.uploadGalleryImageAction(fd),
      await a.listGalleryMediaAction({ projectSlug }),
      await a.publishGalleryDraftAction({ projectSlug, id, rev: 'r' }),
      await a.discardGalleryDraftAction({ projectSlug, id, rev: 'r' }),
      await a.deleteGalleryAction({ projectSlug, id }),
    ]
  }

  beforeAll(async () => {
    await load()
  }, 30_000)

  it('unauthenticated → refused, nothing touched', async () => {
    const a = await load()
    expect(await a.listGalleriesAction({ projectSlug: 'tenant-a-site' })).toEqual({ ok: false, error: 'unauthenticated' })
    for (const r of await writes('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'unauthenticated' })
    noSideEffects()
  })

  it("tenant A cannot read or write in tenant B's project", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    expect(await a.listGalleriesAction({ projectSlug: 'tenant-b-site' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await a.getGalleryAction({ projectSlug: 'tenant-b-site', id: 'g' })).toEqual({ ok: false, error: 'forbidden' })
    for (const r of await writes('tenant-b-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('a viewer is refused every write', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    for (const r of await writes('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('an editor cannot delete a gallery', async () => {
    persona = 'tenantA'
    // An Editor's real gallery permissions: read + write, never delete (ADR-028).
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [{ ...grantA, role: 'editor', permissions: ['gallery.gallery.read', 'gallery.gallery.write'] }] }
    const a = await load()
    expect(await a.deleteGalleryAction({ projectSlug: 'tenant-a-site', id: 'gallery-x' })).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('unsafe ids are not_found before anything is read', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [grantA] }
    const a = await load()
    for (const id of ['drafts.x', '../x', 'a/b']) {
      expect(await a.openGalleryForEditAction({ projectSlug: 'tenant-a-site', id })).toEqual({ ok: false, error: 'not_found' })
      expect(await a.patchGalleryDraftAction({ projectSlug: 'tenant-a-site', id, rev: 'r', set: { 'title.it': 'x' } })).toEqual({
        ok: false,
        error: 'not_found',
      })
      expect(await a.publishGalleryDraftAction({ projectSlug: 'tenant-a-site', id, rev: 'r' })).toEqual({ ok: false, error: 'not_found' })
      expect(await a.deleteGalleryAction({ projectSlug: 'tenant-a-site', id })).toEqual({ ok: false, error: 'not_found' })
    }
    expect(await a.updateGalleryPhotoAction({ projectSlug: 'tenant-a-site', assetId: '../x', alt: { it: 'x' } })).toEqual({
      ok: false,
      error: 'not_found',
    })
    noSideEffects()
  })
})

// ── Media screen server actions (client dashboard) ──────────────────────────

describe('media screen server actions — owner/editor only, nothing touched on refusal', () => {
  const ownerA = {
    projectId: 'project-a',
    projectSlug: 'tenant-a-site',
    membershipId: 'tenant-owner:tenant-a',
    role: 'owner',
    permissions: ['media.library.manage'],
    enabledModuleIds: [],
  }
  const viewerA = { ...ownerA, role: 'viewer', permissions: [] }
  const load = () => import('@/app/[locale]/(client)/[tenant]/media/actions')
  const calls = async (projectSlug: string) => {
    const a = await load()
    const fd = new FormData()
    fd.set('projectSlug', projectSlug)
    fd.set('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'a.jpg', { type: 'image/jpeg' }))
    return [
      await a.listMediaLibraryAction({ projectSlug }),
      await a.uploadMediaImageAction(fd),
      await a.updateMediaPhotoAction({ projectSlug, assetId: 'm1', alt: { it: 'x' } }),
      await a.batchMediaPhotosAction({ projectSlug, assetIds: ['m1', 'm2'], baseName: 'x', addTags: ['y'] }),
    ]
  }

  beforeAll(async () => {
    await load()
  }, 30_000)

  it('unauthenticated → refused', async () => {
    for (const r of await calls('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'unauthenticated' })
    noSideEffects()
  })

  it("tenant A cannot use tenant B's Media Library", async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [ownerA] }
    for (const r of await calls('tenant-b-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('a viewer is refused', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [viewerA] }
    for (const r of await calls('tenant-a-site')) expect(r).toEqual({ ok: false, error: 'forbidden' })
    noSideEffects()
  })

  it('an unsafe asset id is not_found before anything is read', async () => {
    persona = 'tenantA'
    tenantCtx = { userId: 'user-tenant-a', platformRole: 'tenant_user', projects: [ownerA] }
    const a = await load()
    expect(await a.updateMediaPhotoAction({ projectSlug: 'tenant-a-site', assetId: '../x', alt: { it: 'x' } })).toEqual({ ok: false, error: 'not_found' })
    // Batches: a bad id or more than 100 photos are refused before anything is read.
    expect(await a.batchMediaPhotosAction({ projectSlug: 'tenant-a-site', assetIds: ['../x'], addTags: ['y'] })).toEqual({ ok: false, error: 'invalid_value' })
    expect(
      await a.batchMediaPhotosAction({ projectSlug: 'tenant-a-site', assetIds: Array.from({ length: 101 }, (_, i) => `m${i}`), addTags: ['y'] })
    ).toEqual({ ok: false, error: 'invalid_value' })
    noSideEffects()
  })
})

// ── Machine-to-machine routes ───────────────────────────────────────────────

describe('cron / webhook routes require their shared secret', () => {
  const cases: Array<{ name: string; run: (h?: Record<string, string>) => Promise<Response> }> = [
    { name: 'GET /api/cron/keep-alive', run: async (h = {}) => (await import('@/app/api/cron/keep-alive/route')).GET(req('/api/cron/keep-alive', { headers: h })) },
    { name: 'GET /api/cron/form-events-sweep', run: async (h = {}) => (await import('@/app/api/cron/form-events-sweep/route')).GET(req('/api/cron/form-events-sweep', { headers: h })) },
    { name: 'GET /api/cron/analytics', run: async (h = {}) => (await import('@/app/api/cron/analytics/route')).GET(req('/api/cron/analytics', { headers: h })) },
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
  translate: 'admin',
  'translate/status': 'admin',
  'tenants/[tenantId]/invite': 'admin',
  'projects/[projectId]/invite': 'tenant',
  'cron/keep-alive': 'machine',
  'cron/form-events-sweep': 'machine',
  'cron/analytics': 'machine',
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
        'sanity/document', 'sanity/projects', 'sanity/tenant', 'sanity/tenants',
        'tenants/[tenantId]/invite', 'translate', 'translate/status',
      ].sort()
    )
  })
})
