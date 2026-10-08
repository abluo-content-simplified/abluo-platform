/**
 * ADR-028 — the People screen's service: who may see the list, change access
 * and remove people, each decided by checkGrant before any write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, type Tables } from '@/lib/invitations/__tests__/fake-db'

let tables: Tables
let users: Record<string, { id: string; email: string; app_metadata?: Record<string, unknown> }>
let admin: ReturnType<typeof fakeAdmin>
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: async (_r: string, fn: (c: unknown) => unknown) => fn(admin) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => admin }))
vi.mock('@/lib/sanity/client', () => ({ tenantClient: () => ({ fetchForTenant: async () => ['forms', 'blog'] }) }))

import {
  archiveProjectMember,
  cancelProjectInvitation,
  listProjectPeople,
  resendProjectInvitation,
  restoreProjectMember,
  updateProjectMember,
} from '../service'
import { loadTenantAuthorizationContext } from '@/lib/api/tenant-context'

const P = 'project-a'
const INV = '00000000-0000-4000-8000-00000000aaaa'
const send = vi.fn(async () => ({ ok: true }))
beforeEach(() => {
  users = {
    owner: { id: 'u-owner', email: 'owner@a.it' },
    admin: { id: 'u-admin', email: 'admin@a.it' },
    admin2: { id: 'u-admin2', email: 'admin2@a.it' },
    editor: { id: 'u-editor', email: 'editor@a.it' },
    ownerB: { id: 'u-ownerb', email: 'owner@b.it' },
    accountant: { id: 'u-acc', email: 'acc@a.it' },
  }
  tables = {
    tenants: [{ id: 'tA', display_name: 'A' }, { id: 'tB', display_name: 'B' }],
    projects: [{ id: P, slug: 'a', name: 'A', tenant_id: 'tA' }, { id: 'project-b', slug: 'b', name: 'B', tenant_id: 'tB' }],
    tenant_members: [
      { id: 'tm1', tenant_id: 'tA', user_id: 'u-owner', role: 'owner', extra_permissions: [] },
      { id: 'tm2', tenant_id: 'tB', user_id: 'u-ownerb', role: 'owner', extra_permissions: [] },
      { id: 'tm3', tenant_id: 'tA', user_id: 'u-acc', role: 'member', extra_permissions: ['billing.invoice.read'] },
    ],
    project_members: [
      { id: 'pm-admin', project_id: P, user_id: 'u-admin', role: 'admin', extra_permissions: [] },
      { id: 'pm-admin2', project_id: P, user_id: 'u-admin2', role: 'admin', extra_permissions: [] },
      { id: 'pm-editor', project_id: P, user_id: 'u-editor', role: 'editor', extra_permissions: [] },
    ],
    profiles: [],
    invitations: [{ id: INV, project_id: P, created_at: '2026-01-01T00:00:00Z', email: 'x@y.z', role: 'editor', extra_permissions: [], expires_at: '2999-01-01T00:00:00Z', invited_by: 'u-owner', accepted_at: null, revoked_at: null }],
  }
  admin = fakeAdmin(tables, users)
})
const ctx = (who: keyof typeof users) => loadTenantAuthorizationContext(admin as never, { userId: users[who].id, platformRole: 'tenant_user' })

describe('who sees the People screen', () => {
  it('Owner and Site admin do; Editor, another client and an invoices-only Member do not', async () => {
    expect(await listProjectPeople(await ctx('owner'), P)).not.toBeNull()
    expect(await listProjectPeople(await ctx('admin'), P)).not.toBeNull()
    expect(await listProjectPeople(await ctx('editor'), P)).toBeNull()
    expect(await listProjectPeople(await ctx('ownerB'), P)).toBeNull()
    expect(await listProjectPeople(await ctx('accountant'), P)).toBeNull()
  })
  it('the Owner may change Site admins and Editors; a Site admin only Editors, never itself', async () => {
    const asOwner = (await listProjectPeople(await ctx('owner'), P))!
    expect(asOwner.invitableRoles).toEqual(['admin', 'editor'])
    expect(asOwner.people.find((p) => p.membershipId === 'pm-admin')!.editableRoles).toEqual(['admin', 'editor'])
    const asAdmin = (await listProjectPeople(await ctx('admin'), P))!
    expect(asAdmin.invitableRoles).toEqual(['editor'])
    expect(asAdmin.people.find((p) => p.membershipId === 'pm-admin')).toMatchObject({ isYou: true, editableRoles: [], canArchive: false })
    expect(asAdmin.people.find((p) => p.membershipId === 'pm-admin2')).toMatchObject({ editableRoles: [], canArchive: false })
    expect(asAdmin.people.find((p) => p.membershipId === 'pm-editor')).toMatchObject({ editableRoles: ['editor'], canArchive: true })
    expect(asAdmin.grantableExtras).toEqual(['forms.submission.read', 'forms.submission.update', 'analytics.read'])
    expect(asAdmin.extrasForRole).toEqual({ admin: [], editor: ['forms.submission.read', 'forms.submission.update', 'analytics.read'] })
    expect(asAdmin.people.filter((p) => p.kind === 'invitation')).toMatchObject([{ status: 'invited', invitedBy: 'owner@a.it', canResend: true, canCancel: true }])
  })
  it('the client’s Owners are listed read-only; an invoices-only Member is not listed on the site', async () => {
    const v = (await listProjectPeople(await ctx('admin'), P))!
    expect(v.people.find((p) => p.kind === 'owner')).toMatchObject({ email: 'owner@a.it', editableRoles: [], canArchive: false })
    expect(v.people.some((p) => p.email === 'acc@a.it')).toBe(false)
  })
})

describe('changing access', () => {
  it('a Site admin gives an Editor contact requests', async () => {
    expect(await updateProjectMember(await ctx('admin'), P, 'pm-editor', { role: 'editor', extras: ['forms.submission.read'] })).toEqual({ ok: true })
    expect(tables.project_members.find((m) => m.id === 'pm-editor')!.extra_permissions).toEqual(['forms.submission.read'])
  })
  it('a Site admin cannot promote an Editor, touch another Site admin, or change itself', async () => {
    const c = await ctx('admin')
    expect(await updateProjectMember(c, P, 'pm-editor', { role: 'admin', extras: [] })).toEqual({ ok: false, error: 'forbidden' })
    expect(await updateProjectMember(c, P, 'pm-admin2', { role: 'editor', extras: [] })).toEqual({ ok: false, error: 'forbidden' })
    expect(await updateProjectMember(c, P, 'pm-admin', { role: 'admin', extras: [] })).toEqual({ ok: false, error: 'forbidden' })
  })
  it('an Editor changes nobody; another client cannot reach these memberships', async () => {
    expect(await updateProjectMember(await ctx('editor'), P, 'pm-editor', { role: 'editor', extras: ['forms.submission.read'] })).toEqual({ ok: false, error: 'not_found' })
    expect(await updateProjectMember(await ctx('ownerB'), P, 'pm-editor', { role: 'editor', extras: [] })).toEqual({ ok: false, error: 'not_found' })
    expect(await updateProjectMember(await ctx('ownerB'), 'project-b', 'pm-editor', { role: 'editor', extras: [] })).toEqual({ ok: false, error: 'not_found' })
  })
  it('extras the granter may not give, or bad input, are refused', async () => {
    const c = await ctx('owner')
    expect(await updateProjectMember(c, P, 'pm-editor', { role: 'editor', extras: ['billing.invoice.read'] })).toEqual({ ok: false, error: 'forbidden' })
    expect(await updateProjectMember(c, P, 'pm-editor', { role: 'owner', extras: [] })).toEqual({ ok: false, error: 'invalid' })
    expect(await updateProjectMember(c, P, 'pm-editor', { role: 'editor', extras: 'x' })).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('archiving people (never deleting)', () => {
  it('a Site admin archives an Editor, not another Site admin, not itself', async () => {
    const c = await ctx('admin')
    expect(await archiveProjectMember(c, P, 'pm-admin2')).toEqual({ ok: false, error: 'forbidden' })
    expect(await archiveProjectMember(c, P, 'pm-admin')).toEqual({ ok: false, error: 'forbidden' })
    expect(await archiveProjectMember(c, P, 'pm-editor')).toEqual({ ok: true })
    expect(tables.project_members.some((m) => m.id === 'pm-editor')).toBe(false)
    expect(tables.project_member_archive).toMatchObject([{ project_id: P, user_id: 'u-editor', role: 'editor', archived_by: 'u-admin' }])
  })
  it('the archived person loses the site at once and shows as Archived', async () => {
    tables.project_members.find((m) => m.id === 'pm-editor')!.extra_permissions = ['forms.submission.read']
    await archiveProjectMember(await ctx('owner'), P, 'pm-editor')
    expect((await ctx('editor')).projects.some((g) => g.projectId === P)).toBe(false)
    const row = (await listProjectPeople(await ctx('owner'), P))!.people.find((p) => p.email === 'editor@a.it')!
    expect(row).toMatchObject({ kind: 'archived', status: 'archived', extras: ['forms.submission.read'], canRestore: true })
  })
  it('archiving cancels their pending invitations on this site', async () => {
    tables.invitations.push({ id: 'inv-ed', project_id: P, email: 'editor@a.it', role: 'admin', extra_permissions: [], expires_at: '2999-01-01T00:00:00Z', accepted_at: null, revoked_at: null })
    await archiveProjectMember(await ctx('owner'), P, 'pm-editor')
    expect(tables.invitations.find((i) => i.id === 'inv-ed')!.revoked_at).not.toBeNull()
  })
  it('another client cannot archive here', async () => {
    expect(await archiveProjectMember(await ctx('ownerB'), P, 'pm-admin2')).toEqual({ ok: false, error: 'not_found' })
    expect(await archiveProjectMember(await ctx('owner'), P, 'pm-admin2')).toEqual({ ok: true })
  })
})

describe('restoring people', () => {
  it('the same role and extras come back, with an email', async () => {
    tables.project_members.find((m) => m.id === 'pm-editor')!.extra_permissions = ['forms.submission.read']
    await archiveProjectMember(await ctx('owner'), P, 'pm-editor')
    const archiveId = tables.project_member_archive[0].id as string
    send.mockClear()
    expect(await restoreProjectMember(await ctx('admin'), P, archiveId, { locale: 'it' }, { send })).toEqual({ ok: true, emailSent: true })
    expect(tables.project_members.find((m) => m.user_id === 'u-editor')).toMatchObject({ role: 'editor', extra_permissions: ['forms.submission.read'] })
    expect(tables.project_member_archive[0].restored_at).toBeTruthy()
    expect(send).toHaveBeenCalledTimes(1)
    expect((await ctx('editor')).projects.some((g) => g.projectId === P)).toBe(true)
  })
  it('a Site admin cannot restore a Site admin (no escalation); another client cannot restore at all', async () => {
    await archiveProjectMember(await ctx('owner'), P, 'pm-admin2')
    const archiveId = tables.project_member_archive[0].id as string
    expect(await restoreProjectMember(await ctx('admin'), P, archiveId, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'forbidden' })
    expect(await restoreProjectMember(await ctx('ownerB'), P, archiveId, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'not_found' })
    expect(await restoreProjectMember(await ctx('ownerB'), 'project-b', archiveId, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'not_found' })
    expect(tables.project_members.some((m) => m.user_id === 'u-admin2')).toBe(false)
  })
  it('a closed record cannot be restored twice', async () => {
    await archiveProjectMember(await ctx('owner'), P, 'pm-editor')
    const archiveId = tables.project_member_archive[0].id as string
    expect((await restoreProjectMember(await ctx('owner'), P, archiveId, { locale: 'en' }, { send })).ok).toBe(true)
    expect(await restoreProjectMember(await ctx('owner'), P, archiveId, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('resending and cancelling invitations', () => {
  it('resend issues a fresh invitation and cancels the old link', async () => {
    send.mockClear()
    expect(await resendProjectInvitation(await ctx('admin'), P, INV, { locale: 'en' }, { send })).toEqual({ ok: true, emailSent: true })
    expect(tables.invitations.find((i) => i.id === INV)!.revoked_at).not.toBeNull()
    expect(tables.invitations.filter((i) => i.email === 'x@y.z' && !i.revoked_at)).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('is limited: not again within minutes', async () => {
    await resendProjectInvitation(await ctx('admin'), P, INV, { locale: 'en' }, { send })
    const fresh = tables.invitations.find((i) => i.email === 'x@y.z' && !i.revoked_at)!.id as string
    expect(await resendProjectInvitation(await ctx('admin'), P, fresh, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'too_soon' })
  })
  it('an Editor or another client cannot resend or cancel; an invitation of another site is not found', async () => {
    expect(await resendProjectInvitation(await ctx('editor'), P, INV, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'not_found' })
    expect(await resendProjectInvitation(await ctx('ownerB'), 'project-b', INV, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'not_found' })
    expect(await cancelProjectInvitation(await ctx('ownerB'), 'project-b', INV)).toEqual({ ok: false, error: 'not_found' })
    expect(tables.invitations.find((i) => i.id === INV)!.revoked_at).toBeNull()
  })
  it('a Site admin cannot resend or cancel an invitation for a Site admin', async () => {
    tables.invitations[0].role = 'admin'
    expect(await resendProjectInvitation(await ctx('admin'), P, INV, { locale: 'en' }, { send })).toEqual({ ok: false, error: 'forbidden' })
    expect(await cancelProjectInvitation(await ctx('admin'), P, INV)).toEqual({ ok: false, error: 'forbidden' })
    expect(await cancelProjectInvitation(await ctx('owner'), P, INV)).toEqual({ ok: true })
  })
  it('an expired invitation is listed as Expired and can be resent', async () => {
    tables.invitations[0].expires_at = '2020-01-01T00:00:00Z'
    const row = (await listProjectPeople(await ctx('owner'), P))!.people.find((p) => p.kind === 'invitation')!
    expect(row).toMatchObject({ status: 'expired', canResend: true })
    expect((await resendProjectInvitation(await ctx('owner'), P, INV, { locale: 'en' }, { send })).ok).toBe(true)
  })
})

describe('what the list shows', () => {
  it('avatars only from Abluo storage', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    tables.profiles.push({ id: 'u-editor', full_name: 'Eddie', avatar_url: 'https://x.supabase.co/storage/v1/object/public/avatars/e.png' })
    tables.profiles.push({ id: 'u-admin2', full_name: 'Tracky', avatar_url: 'https://evil.example/pixel.png' })
    const v = (await listProjectPeople(await ctx('owner'), P))!
    expect(v.people.find((p) => p.email === 'editor@a.it')!.avatarUrl).toBe('https://x.supabase.co/storage/v1/object/public/avatars/e.png')
    expect(v.people.find((p) => p.email === 'admin2@a.it')!.avatarUrl).toBeNull()
  })
  it('last active and two-step verification come from the account', async () => {
    Object.assign(users.editor, { last_sign_in_at: '2026-10-01T10:00:00Z', factors: [{ status: 'verified' }] })
    const v = (await listProjectPeople(await ctx('owner'), P))!
    expect(v.people.find((p) => p.email === 'editor@a.it')).toMatchObject({ lastActiveAt: '2026-10-01T10:00:00Z', twoFactor: true })
    expect(v.people.find((p) => p.email === 'admin2@a.it')).toMatchObject({ twoFactor: false })
  })
})
