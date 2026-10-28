/**
 * PLAT-2 — transfer ownership of a client. The permission matrix, the
 * last-Owner guard, step-down across several sites, "nothing written when the
 * target isn't in the client", the one-transaction call (migration 056), its
 * fail-closed behaviour before 056 is applied, and the emails (production only).
 *
 * The database half (the transaction itself) is proven against a real
 * Postgres by supabase/verify/hardening-056.verify.mjs; here `rpc` is a fake
 * that applies the same rules in memory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, type Tables } from '@/lib/invitations/__tests__/fake-db'

type Row = Record<string, unknown>
let tables: Tables
let users: Record<string, { id: string; email: string; app_metadata?: Record<string, unknown> }>
let admin: ReturnType<typeof fakeAdmin> & { rpc: ReturnType<typeof vi.fn> }
let rpcMode: 'apply' | 'missing' | 'noop' = 'apply'
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: async (_r: string, fn: (c: unknown) => unknown) => fn(admin) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => admin }))
vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: async () => ['forms', 'blog'] }) }))

import { listOwnershipCandidates, mayTransferOwnership, ownershipErrorFrom, transferOwnership, TRANSFER_RPC } from '../ownership'
import { listProjectPeople } from '../service'
import { renderOwnershipEmail } from '@/lib/invitations/email'
import { loadTenantAuthorizationContext, type TenantAuthorizationContext } from '@/lib/api/tenant-context'

const T = '00000000-0000-4000-8000-0000000000aa'
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const OWNER = U(1), ADMIN = U(2), EDITOR = U(3), MEMBER = U(4), OWNER_B = U(5), STRANGER = U(6), SUPER = U(7), OWNER2 = U(8)
const send = vi.fn(async () => ({ ok: true }))
const prod = () => 'production' as const

/** In-memory twin of tenant_transfer_ownership (migration 056). */
function applyTransfer(p: Row) {
  const tm = tables.tenant_members
  const projectIds = tables.projects.filter((x) => x.tenant_id === p.p_tenant_id).map((x) => x.id)
  const owners = tm.filter((r) => r.tenant_id === p.p_tenant_id && r.role === 'owner').map((r) => r.user_id)
  if (owners.includes(p.p_new_owner)) return { data: null, error: { code: 'P0001', message: 'ownership:already_owner' } }
  const row = tm.find((r) => r.tenant_id === p.p_tenant_id && r.user_id === p.p_new_owner)
  const sites = tables.project_members.filter((r) => r.user_id === p.p_new_owner && projectIds.includes(r.project_id))
  if (!row && !sites.length) return { data: null, error: { code: 'P0001', message: 'ownership:not_member' } }
  if (row) Object.assign(row, { role: 'owner', extra_permissions: [] })
  else tm.push({ id: `tm-${p.p_new_owner}`, tenant_id: p.p_tenant_id, user_id: p.p_new_owner, role: 'owner', extra_permissions: [] })
  tables.project_members = tables.project_members.filter((r) => !sites.includes(r))
  if (p.p_step_down) {
    Object.assign(tm.find((r) => r.tenant_id === p.p_tenant_id && r.user_id === p.p_step_down)!, { role: 'member', extra_permissions: [] })
    for (const pid of projectIds) {
      const existing = tables.project_members.find((r) => r.project_id === pid && r.user_id === p.p_step_down)
      if (existing) existing.role = 'admin'
      else tables.project_members.push({ id: `pm-${pid}-${p.p_step_down}`, project_id: pid, user_id: p.p_step_down, role: 'admin', extra_permissions: [] })
    }
  }
  for (const pid of projectIds) tables.access_audit_log.push({ actor_id: p.p_actor, subject_user_id: p.p_new_owner, project_id: pid, action: 'owner.transfer' })
  return { data: { newOwner: p.p_new_owner }, error: null }
}

beforeEach(() => {
  rpcMode = 'apply'
  send.mockClear()
  users = {
    owner: { id: OWNER, email: 'owner@a.it' },
    owner2: { id: OWNER2, email: 'owner2@a.it' },
    admin: { id: ADMIN, email: 'admin@a.it' },
    editor: { id: EDITOR, email: 'editor@a.it' },
    member: { id: MEMBER, email: 'member@a.it' },
    ownerB: { id: OWNER_B, email: 'owner@b.it' },
    stranger: { id: STRANGER, email: 'stranger@x.it' },
    super: { id: SUPER, email: 'tom@abluo.app', app_metadata: { platform_role: 'abluo_admin' } },
  }
  tables = {
    access_audit_log: [],
    tenants: [{ id: T, display_name: 'Studio A' }, { id: 'tB', display_name: 'B' }],
    projects: [
      { id: 'p1', slug: 'a-one', name: 'One', tenant_id: T },
      { id: 'p2', slug: 'a-two', name: 'Two', tenant_id: T },
      { id: 'p3', slug: 'a-three', name: 'Three', tenant_id: T },
      { id: 'pb', slug: 'b', name: 'B', tenant_id: 'tB' },
    ],
    tenant_members: [
      { id: 'tm1', tenant_id: T, user_id: OWNER, role: 'owner', extra_permissions: [] },
      { id: 'tm2', tenant_id: 'tB', user_id: OWNER_B, role: 'owner', extra_permissions: [] },
      { id: 'tm3', tenant_id: T, user_id: MEMBER, role: 'member', extra_permissions: ['billing.invoice.read'] },
    ],
    project_members: [
      { id: 'pm-admin', project_id: 'p1', user_id: ADMIN, role: 'admin', extra_permissions: [] },
      { id: 'pm-editor', project_id: 'p2', user_id: EDITOR, role: 'editor', extra_permissions: [] },
      { id: 'pm-owner-p3', project_id: 'p3', user_id: OWNER, role: 'editor', extra_permissions: ['forms.submission.read'] },
      { id: 'pm-stranger', project_id: 'pb', user_id: STRANGER, role: 'admin', extra_permissions: [] },
    ],
    profiles: [{ id: ADMIN, full_name: 'Anna Admin' }, { id: OWNER, full_name: 'Olga Owner' }],
    invitations: [],
  }
  const base = fakeAdmin(tables, users)
  admin = Object.assign(base, {
    rpc: vi.fn(async (name: string, params: Row) => {
      if (rpcMode === 'missing') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }
      if (rpcMode === 'noop') return { data: {}, error: null }
      return applyTransfer(params)
    }),
  })
})

const ctx = (who: keyof typeof users) =>
  loadTenantAuthorizationContext(admin as never, { userId: users[who].id, platformRole: users[who].app_metadata?.platform_role === 'abluo_admin' ? 'abluo_admin' : 'tenant_user' })
const run = async (who: keyof typeof users, input: Partial<Parameters<typeof transferOwnership>[1]> = {}, c?: TenantAuthorizationContext) =>
  transferOwnership(c ?? (await ctx(who)), { tenantId: T, newOwnerUserId: ADMIN, stepDownUserId: null, locale: 'en', ...input }, { send, environment: prod })
const roleOf = (uid: string) => tables.tenant_members.find((r) => r.tenant_id === T && r.user_id === uid)?.role ?? null
const snapshot = () => JSON.stringify([tables.tenant_members, tables.project_members, tables.access_audit_log])

describe('who may make someone Owner — the permission matrix', () => {
  it('the client’s Owner: yes', async () => {
    expect(mayTransferOwnership(await ctx('owner'), T)).toBe(true)
    expect(await run('owner')).toEqual({ ok: true, emailsSent: 2 })
    expect(roleOf(ADMIN)).toBe('owner')
  })
  it('a Site admin, an Editor, a Member with extras, another client’s Owner: no — and nothing is touched', async () => {
    for (const who of ['admin', 'editor', 'member', 'ownerB'] as const) {
      const before = snapshot()
      expect(await run(who, { newOwnerUserId: who === 'admin' ? EDITOR : ADMIN })).toEqual({ ok: false, error: 'forbidden' })
      expect(snapshot()).toBe(before)
    }
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it('nobody can make THEMSELVES Owner (no escalation): a Site admin naming their own id is refused', async () => {
    expect(await run('admin', { newOwnerUserId: ADMIN })).toEqual({ ok: false, error: 'forbidden' })
    expect(roleOf(ADMIN)).toBeNull()
  })
  it('a Super Admin: only with adminAssured (two-factor checked on this request)', async () => {
    expect(await run('super')).toEqual({ ok: false, error: 'forbidden' })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(await run('super', { adminAssured: true })).toMatchObject({ ok: true })
    expect(admin.rpc).toHaveBeenCalledWith(TRANSFER_RPC, expect.objectContaining({ p_actor: SUPER, p_by_admin: true }))
  })
  it('a support visit never, even with the Owner perspective and edit access', async () => {
    const owner = await ctx('owner')
    const support: TenantAuthorizationContext = { ...owner, userId: SUPER, platformRole: 'abluo_admin', support: { sessionId: 's', projectId: 'p1', projectSlug: 'a-one', projectName: 'One', adminUserId: SUPER, role: 'owner', status: 'allowed' as never, writesAllowed: true, expiresAt: null, contactRequestsShown: false, purpose: 'mutation' as never } }
    expect(mayTransferOwnership(support, T, { adminAssured: true })).toBe(false)
    expect(await run('owner', { adminAssured: true }, support)).toEqual({ ok: false, error: 'forbidden' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('an Owner may step down only themselves; a Super Admin may pick any current Owner', async () => {
    tables.tenant_members.push({ id: 'tm4', tenant_id: T, user_id: OWNER2, role: 'owner', extra_permissions: [] })
    expect(await run('owner', { stepDownUserId: OWNER2 })).toEqual({ ok: false, error: 'forbidden' })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(await run('super', { adminAssured: true, stepDownUserId: OWNER2 })).toMatchObject({ ok: true })
    expect(roleOf(OWNER2)).toBe('member')
  })
})

describe('the target must already be in the client', () => {
  it('a person from another client (or nowhere) → not_member, nothing written, no call, no email', async () => {
    for (const id of [STRANGER, U(99)]) {
      const before = snapshot()
      expect(await run('owner', { newOwnerUserId: id, stepDownUserId: OWNER })).toEqual({ ok: false, error: 'not_member' })
      expect(snapshot()).toBe(before)
    }
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
  it('an existing Owner → already_owner; a bad id → invalid', async () => {
    expect(await run('owner', { newOwnerUserId: OWNER })).toEqual({ ok: false, error: 'already_owner' })
    expect(await run('owner', { newOwnerUserId: 'not-a-uuid' })).toEqual({ ok: false, error: 'invalid' })
    expect(await run('owner', { newOwnerUserId: ADMIN, stepDownUserId: ADMIN })).toEqual({ ok: false, error: 'invalid' })
  })
  it('a client Member (tenant row) and a site-only Editor both qualify', async () => {
    expect(await run('owner', { newOwnerUserId: MEMBER })).toMatchObject({ ok: true })
    expect(await run('owner', { newOwnerUserId: EDITOR })).toMatchObject({ ok: true })
    expect([roleOf(MEMBER), roleOf(EDITOR)]).toEqual(['owner', 'owner'])
  })
})

describe('never without an Owner', () => {
  it('stepping down someone who is not an Owner is refused before any write', async () => {
    const before = snapshot()
    expect(await run('super', { adminAssured: true, stepDownUserId: EDITOR })).toEqual({ ok: false, error: 'not_owner' })
    expect(snapshot()).toBe(before)
  })
  it('the database’s last-Owner refusal is reported as last_owner', () => {
    expect(ownershipErrorFrom({ code: '23514', message: 'a client must always have at least one Owner (tenant x)' })).toBe('last_owner')
    expect(ownershipErrorFrom({ code: 'P0001', message: 'ownership:no_owner' })).toBe('last_owner')
    expect(ownershipErrorFrom({ code: 'P0001', message: 'ownership:not_member' })).toBe('not_member')
    expect(ownershipErrorFrom({ code: 'XX000', message: 'boom' })).toBe('failed')
  })
})

describe('step down with several sites', () => {
  it('the Owner becomes Member and Site admin on every site; the new Owner’s site rows go', async () => {
    expect(await run('owner', { stepDownUserId: OWNER })).toMatchObject({ ok: true })
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith(TRANSFER_RPC, { p_tenant_id: T, p_new_owner: ADMIN, p_actor: OWNER, p_step_down: OWNER, p_by_admin: false })
    expect(roleOf(OWNER)).toBe('member')
    expect(roleOf(ADMIN)).toBe('owner')
    const mine = tables.project_members.filter((r) => r.user_id === OWNER).map((r) => [r.project_id, r.role]).sort()
    expect(mine).toEqual([['p1', 'admin'], ['p2', 'admin'], ['p3', 'admin']])
    expect(tables.project_members.filter((r) => r.user_id === ADMIN)).toEqual([])
  })
})

describe('one transaction — and closed until migration 056 is applied', () => {
  it('function missing → not_ready, nothing changes, no email', async () => {
    rpcMode = 'missing'
    const before = snapshot()
    expect(await run('owner', { stepDownUserId: OWNER })).toEqual({ ok: false, error: 'not_ready' })
    expect(snapshot()).toBe(before)
    expect(send).not.toHaveBeenCalled()
  })
  it('every write goes through the one RPC: with a no-op RPC, nothing at all changes', async () => {
    rpcMode = 'noop'
    const before = snapshot()
    expect(await run('owner', { stepDownUserId: OWNER })).toMatchObject({ ok: true })
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(snapshot()).toBe(before)
  })
})

describe('audit and email', () => {
  it('access history is written by the transaction, attributed to the actor', async () => {
    await run('owner')
    expect(tables.access_audit_log.map((r) => [r.action, r.actor_id, r.subject_user_id, r.project_id])).toEqual([
      ['owner.transfer', OWNER, ADMIN, 'p1'],
      ['owner.transfer', OWNER, ADMIN, 'p2'],
      ['owner.transfer', OWNER, ADMIN, 'p3'],
    ])
  })
  it('production: one email to the new Owner and one to each previous Owner, from the actor', async () => {
    await run('owner', { stepDownUserId: OWNER, locale: 'de', projectSlug: 'a-two' })
    expect(send).toHaveBeenCalledTimes(2)
    const calls = send.mock.calls.map((c) => (c as unknown as [Row])[0])
    expect(calls.map((c) => c.to)).toEqual([['admin@a.it'], ['owner@a.it']])
    expect(calls[0]).toMatchObject({ subject: 'Du bist jetzt Inhaber von Studio A', fromName: 'Olga Owner via Abluo', replyTo: 'owner@a.it' })
    expect(calls[0].text).toContain('https://abluo.app/de/a-two/home')
    expect(calls[1].subject).toBe('Anna Admin ist jetzt Inhaber von Studio A')
    expect(calls[1].text).toContain('Du bist jetzt Website-Admin auf allen Websites von Studio A.')
  })
  it('not production: the change happens, no email', async () => {
    const r = await transferOwnership(await ctx('owner'), { tenantId: T, newOwnerUserId: ADMIN, stepDownUserId: null, locale: 'en' }, { send, environment: () => 'preview' })
    expect(r).toEqual({ ok: true, emailsSent: 0 })
    expect(send).not.toHaveBeenCalled()
  })
  it('the email is written in en / it / de and escapes names', () => {
    const base = { kind: 'newOwner' as const, byName: '<b>Tom</b>', ownerName: 'Anna', placeName: 'Studio A', steppedDown: false, url: 'https://abluo.app/x' }
    expect(renderOwnershipEmail({ ...base, locale: 'en' }).subject).toBe('You’re now an Owner of Studio A')
    expect(renderOwnershipEmail({ ...base, locale: 'it' }).subject).toBe('Ora sei Titolare di Studio A')
    expect(renderOwnershipEmail({ ...base, locale: 'fr' }).subject).toBe('You’re now an Owner of Studio A')
    expect(renderOwnershipEmail({ ...base, locale: 'en' }).html).not.toContain('<b>Tom</b>')
  })
})

describe('People list and admin candidates', () => {
  it('the Owner sees "Make owner" on site members and client members, never on themselves; a Site admin sees none', async () => {
    const asOwner = (await listProjectPeople(await ctx('owner'), 'p1'))!
    expect(asOwner.canTransferOwnership).toBe(true)
    expect(asOwner.people.find((p) => p.userId === ADMIN)).toMatchObject({ canMakeOwner: true })
    expect(asOwner.people.find((p) => p.userId === OWNER)).toMatchObject({ canMakeOwner: false })
    const asAdmin = (await listProjectPeople(await ctx('admin'), 'p1'))!
    expect(asAdmin.canTransferOwnership).toBe(false)
    expect(asAdmin.people.every((p) => !p.canMakeOwner)).toBe(true)
  })
  it('admin candidates: everyone in the client who is not an Owner, nobody from another client', async () => {
    const r = await listOwnershipCandidates(admin as never, T)
    expect(r.ownerIds).toEqual([OWNER])
    expect(r.candidates.map((c) => c.userId).sort()).toEqual([ADMIN, EDITOR, MEMBER].sort())
  })
})
