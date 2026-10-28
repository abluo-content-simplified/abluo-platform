/**
 * "Invite Owner" server action (admin project page) — wiring and permission.
 * The I/O boundaries are faked: the admin gate, the tenant context, the
 * service-role client, the Owners read, the invitation service and the audit
 * log. The route-level refusal with the REAL admin gate is in
 * src/app/api/__tests__/route-auth-matrix.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '65fe9212-28ce-40e2-8139-5e9458cc31f6'

let actor: { userId: string } | null = null
let tenantCtx: unknown = null
let projectRow: Record<string, unknown> | null = null
let openInvites: Record<string, unknown>[] = []
let owners: { userId: string; name: string; email: string }[] = []
const dbCalls: string[] = []

vi.mock('@/lib/api/auth', () => ({ requireAbluoAdmin: async () => actor }))
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: async () => tenantCtx }))
vi.mock('next/headers', () => ({ headers: async () => new Map([['host', 'admin.abluo.app']]) }))

function query(table: string) {
  const filters: Array<[string, unknown]> = []
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push([k, v]), q),
    is: () => q,
    gt: () => q,
    limit: async () => (dbCalls.push(`${table}:list`), { data: table === 'invitations' ? openInvites : [], error: null }),
    maybeSingle: async () => (dbCalls.push(`${table}:one`), { data: table === 'projects' ? projectRow : null, error: null }),
  }
  return q
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => (dbCalls.push('createAdminClient'), { from: query }) }))
vi.mock('@/lib/api/admin-dashboard/shared', () => ({
  readOwnersByTenant: async (_db: unknown, ids: string[]) => new Map(ids.map((id) => [id, owners])),
}))
const createInvitation = vi.fn(async (..._args: unknown[]) => ({ ok: true as const, id: 'inv-1', emailSent: true }) as { ok: true; id: string; emailSent: boolean } | { ok: false; error: string })
vi.mock('@/lib/invitations/service', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { normalizeEmail: real.normalizeEmail, createInvitation: (...a: unknown[]) => createInvitation(...a) }
})
const recordAdminAudit = vi.fn(async () => {})
vi.mock('@/lib/admin/audit', () => ({ recordAdminAudit: (...a: unknown[]) => recordAdminAudit(...(a as [])) }))

const load = async () => (await import('../owner-actions')).inviteOwnerAction
const ADMIN_CTX = { userId: 'user-admin', platformRole: 'abluo_admin', projects: [], tenants: [] }

beforeEach(() => {
  actor = { userId: 'user-admin' }
  tenantCtx = ADMIN_CTX
  projectRow = { id: PROJECT_ID, slug: 'cyce', tenant_id: TENANT_ID }
  openInvites = []
  owners = []
  dbCalls.length = 0
  createInvitation.mockClear()
  recordAdminAudit.mockClear()
})

describe('inviteOwnerAction — permission', () => {
  it('a non-admin (or an admin without two-factor) is refused before any I/O', async () => {
    actor = null
    const r = await (await load())({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(dbCalls).toEqual([])
    expect(createInvitation).not.toHaveBeenCalled()
    expect(recordAdminAudit).not.toHaveBeenCalled()
  })

  it('no resolved authorization context → refused, nothing touched', async () => {
    tenantCtx = null
    const r = await (await load())({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'forbidden' })
    expect(dbCalls).toEqual([])
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it('the invitation service refusing is passed on as forbidden', async () => {
    createInvitation.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    const r = await (await load())({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'forbidden' })
  })
})

describe('inviteOwnerAction — wiring', () => {
  it('invites an Owner to the CLIENT of the project, derived server-side, with the admin assurance', async () => {
    const r = await (await load())({ projectId: PROJECT_ID, email: '  Owner@CYCE.info ', locale: 'de' })
    expect(r).toEqual({ ok: true, email: 'owner@cyce.info', emailSent: true })
    expect(createInvitation).toHaveBeenCalledTimes(1)
    const [ctx, input] = createInvitation.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(ctx).toBe(ADMIN_CTX)
    expect(input).toMatchObject({
      target: { scope: 'tenant', tenantId: TENANT_ID },
      email: 'owner@cyce.info',
      role: 'owner',
      locale: 'de',
      adminAssured: true,
      // Links from admin.abluo.app point at abluo.app, like provisioning's Owner invite.
      requestOrigin: 'https://abluo.app',
    })
    expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'owner.invite', projectId: PROJECT_ID }))
    // The email address is never written to the audit detail.
    expect(JSON.stringify(recordAdminAudit.mock.calls)).not.toContain('owner@cyce.info')
  })

  it('a language without invitation texts falls back to English', async () => {
    await (await load())({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'fr' })
    expect((createInvitation.mock.calls[0] as [unknown, { locale: string }])[1].locale).toBe('en')
  })

  it('an invalid email or unknown project sends nothing', async () => {
    const act = await load()
    expect(await act({ projectId: PROJECT_ID, email: 'not an email', locale: 'en' })).toEqual({ ok: false, error: 'invalid_email' })
    expect(await act({ projectId: 'nope', email: 'owner@cyce.info', locale: 'en' })).toEqual({ ok: false, error: 'not_found' })
    projectRow = null
    expect(await act({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'en' })).toEqual({ ok: false, error: 'not_found' })
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it('someone who is already an Owner is not invited again', async () => {
    owners = [{ userId: 'u1', name: 'Anna', email: 'owner@cyce.info' }]
    const r = await (await load())({ projectId: PROJECT_ID, email: 'OWNER@cyce.info', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'already_owner' })
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it('an open invitation for that email is reported instead of sending a duplicate', async () => {
    openInvites = [{ id: 'inv-0', role: 'owner', expires_at: '2026-11-04T10:00:00.000Z' }]
    const r = await (await load())({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'en' })
    expect(r).toEqual({ ok: false, error: 'already_invited', expiresAt: '2026-11-04T10:00:00.000Z', role: 'owner' })
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it('"Send a new invitation" (sendAgain) goes through and replaces the open one', async () => {
    openInvites = [{ id: 'inv-0', role: 'owner', expires_at: '2026-11-04T10:00:00.000Z' }]
    const r = await (await load())({ projectId: PROJECT_ID, email: 'owner@cyce.info', locale: 'en', sendAgain: true })
    expect(r.ok).toBe(true)
    expect(createInvitation).toHaveBeenCalledTimes(1)
  })

  it('an existing Owner does not block inviting a second one', async () => {
    owners = [{ userId: 'u1', name: 'Anna', email: 'anna@cyce.info' }]
    const r = await (await load())({ projectId: PROJECT_ID, email: 'second@cyce.info', locale: 'it' })
    expect(r).toEqual({ ok: true, email: 'second@cyce.info', emailSent: true })
  })
})
