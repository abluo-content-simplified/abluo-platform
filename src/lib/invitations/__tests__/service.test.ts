/**
 * ADR-028 §6 — invitations: creation, revocation, look-up and acceptance,
 * against an in-memory database. Every refusal path is exercised; the inviter
 * is re-checked at acceptance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, type Tables } from './fake-db'

let tables: Tables
let users: Record<string, { id: string; email: string; app_metadata?: Record<string, unknown> }>
let admin: ReturnType<typeof fakeAdmin>
const sent: Array<{ to: string[]; html: string; fromName?: string; replyTo?: string }> = []

vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: async (_r: string, fn: (c: unknown) => unknown) => fn(admin),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => admin }))
vi.mock('@/lib/sanity/client', () => ({
  // Every project has the forms + blog modules enabled.
  tenantClient: () => ({ fetchForTenant: async () => ['forms', 'blog'] }),
}))
vi.mock('@/lib/notifications/resend', () => ({
  sendEmail: async (m: (typeof sent)[number]) => (sent.push(m), { ok: true, id: 'm1' }),
}))

import { acceptInvitation, createInvitation, invitationOrigin, lookupInvitation, registerAndAccept, revokeInvitation } from '../service'
import { loadTenantAuthorizationContext, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { hashInvitationToken } from '../token'

const T = 'tenant-a'
const TB = 'tenant-b'
const P = 'project-a'
const PB = 'project-b'

beforeEach(() => {
  sent.length = 0
  users = {
    owner: { id: 'u-owner', email: 'owner@a.it' },
    siteAdmin: { id: 'u-admin', email: 'admin@a.it' },
    editor: { id: 'u-editor', email: 'editor@a.it' },
    ownerB: { id: 'u-ownerb', email: 'owner@b.it' },
    tom: { id: 'u-tom', email: 'tom@abluo.app', app_metadata: { platform_role: 'abluo_admin' } },
    invitee: { id: 'u-inv', email: 'new@x.it' },
  }
  tables = {
    tenants: [{ id: T, display_name: 'Studio A' }, { id: TB, display_name: 'Studio B' }],
    projects: [{ id: P, slug: 'studio-a', name: 'Studio A site', tenant_id: T }, { id: PB, slug: 'studio-b', name: 'Studio B site', tenant_id: TB }],
    tenant_members: [
      { id: 'tm1', tenant_id: T, user_id: 'u-owner', role: 'owner', extra_permissions: [] },
      { id: 'tm2', tenant_id: TB, user_id: 'u-ownerb', role: 'owner', extra_permissions: [] },
    ],
    project_members: [
      { id: 'pm1', project_id: P, user_id: 'u-admin', role: 'admin', extra_permissions: [] },
      { id: 'pm2', project_id: P, user_id: 'u-editor', role: 'editor', extra_permissions: [] },
    ],
    profiles: [{ id: 'u-owner', full_name: 'Anna Owner' }],
    invitations: [],
  }
  admin = fakeAdmin(tables, users)
})

const ctxOf = (who: keyof typeof users): Promise<TenantAuthorizationContext> =>
  loadTenantAuthorizationContext(admin as never, {
    userId: users[who].id,
    platformRole: users[who].app_metadata?.platform_role === 'abluo_admin' ? 'abluo_admin' : 'tenant_user',
  })

async function invite(who: keyof typeof users, o: Partial<Parameters<typeof createInvitation>[1]> = {}) {
  const r = await createInvitation(await ctxOf(who), {
    target: { scope: 'project', projectId: P },
    email: 'New@X.it ',
    role: 'editor',
    locale: 'it',
    requestOrigin: 'https://dev.abluo.app',
    ...o,
  })
  const token = sent.at(-1)?.html.match(/token=([A-Za-z0-9_-]{43})/)?.[1] ?? ''
  return { r, token }
}

describe('create', () => {
  it('stores a hashed token, normalises the email, mails the link from "<inviter> via Abluo", replies to the inviter', async () => {
    const { r, token } = await invite('owner')
    expect(r).toMatchObject({ ok: true, emailSent: true })
    const row = tables.invitations[0]
    expect(row).toMatchObject({ email: 'new@x.it', role: 'editor', project_id: P, invited_by: 'u-owner' })
    expect(row.token_hash).toBe(hashInvitationToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(sent[0]).toMatchObject({ to: ['new@x.it'], fromName: 'Anna Owner via Abluo', replyTo: 'owner@a.it' })
    expect(sent[0].html).toContain('https://dev.abluo.app/invite/accept?token=')
    expect(sent[0].html).toContain('lang=it')
  })
  it('refuses another client’s site, an Editor, and a Site admin inviting a Site admin — before anything is written', async () => {
    expect((await invite('ownerB')).r).toMatchObject({ ok: false, error: 'forbidden' })
    expect((await invite('editor')).r).toMatchObject({ ok: false, error: 'forbidden' })
    expect((await invite('siteAdmin', { role: 'admin' })).r).toMatchObject({ ok: false, error: 'forbidden', reason: 'role_too_high' })
    expect(tables.invitations).toEqual([])
    expect(sent).toEqual([])
  })
  it('a Site admin may give contact requests (it holds them), never invoices', async () => {
    expect((await invite('siteAdmin', { extras: ['forms.submission.read'] })).r).toMatchObject({ ok: true })
    expect((await invite('siteAdmin', { extras: ['billing.invoice.read'] })).r).toMatchObject({ ok: false, error: 'forbidden' })
  })
  it('a new invitation for the same person and place cancels the pending one', async () => {
    await invite('owner')
    await invite('owner')
    expect(tables.invitations.filter((i) => !i.revoked_at)).toHaveLength(1)
    expect(tables.invitations.filter((i) => i.revoked_at)).toHaveLength(1)
  })
  it('Super Admin may invite a client’s Owner only with a 2FA-assured request', async () => {
    const t = { target: { scope: 'tenant' as const, tenantId: T }, role: 'owner' }
    expect((await invite('tom', t)).r).toMatchObject({ ok: false, error: 'forbidden' })
    expect((await invite('tom', { ...t, adminAssured: true })).r).toMatchObject({ ok: true })
  })
  it('rejects bad emails and roles that do not exist at that level', async () => {
    expect((await invite('owner', { email: 'nope' })).r).toMatchObject({ ok: false, error: 'invalid_email' })
    expect((await invite('owner', { role: 'owner' })).r).toMatchObject({ ok: false, error: 'invalid_role' })
    expect((await invite('owner', { role: 'viewer' })).r).toMatchObject({ ok: false, error: 'invalid_role' })
  })
  it('a forged Host never becomes the link origin', () => {
    expect(invitationOrigin('https://evil.example')).toBe('https://abluo.app')
    expect(invitationOrigin('http://dev.abluo.app')).toBe('https://abluo.app')
    expect(invitationOrigin('https://abluo.app.evil.example')).toBe('https://abluo.app')
    expect(invitationOrigin('https://preview.abluo.app')).toBe('https://preview.abluo.app')
    expect(invitationOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })
})

describe('look up', () => {
  it('valid shows place, role and inviter; anything else says why', async () => {
    const { token } = await invite('owner')
    expect(await lookupInvitation(token)).toMatchObject({ status: 'valid', email: 'new@x.it', role: 'editor', placeName: 'Studio A site', inviterName: 'Anna Owner' })
    expect(await lookupInvitation('short')).toEqual({ status: 'invalid' })
    expect((await lookupInvitation('A'.repeat(43))).status).toBe('invalid')
    tables.invitations[0].expires_at = '2000-01-01T00:00:00Z'
    expect((await lookupInvitation(token)).status).toBe('expired')
    tables.invitations[0].revoked_at = '2026-01-01T00:00:00Z'
    expect((await lookupInvitation(token)).status).toBe('revoked')
  })
})

describe('accept', () => {
  it('only the invited email can accept; it creates exactly the invited membership, once', async () => {
    const { token } = await invite('owner', { extras: ['forms.submission.read'] })
    expect(await acceptInvitation(token, { id: 'u-editor', email: 'editor@a.it' })).toEqual({ ok: false, error: 'wrong_account' })
    expect(await acceptInvitation(token, { id: 'u-inv', email: 'NEW@x.it' })).toEqual({ ok: true, scope: 'project', projectSlug: 'studio-a' })
    expect(tables.project_members.find((m) => m.user_id === 'u-inv')).toMatchObject({ project_id: P, role: 'editor', extra_permissions: ['forms.submission.read'] })
    expect(await acceptInvitation(token, { id: 'u-inv', email: 'new@x.it' })).toEqual({ ok: false, error: 'used' })
    expect(tables.project_members.filter((m) => m.user_id === 'u-inv')).toHaveLength(1)
  })
  it('expired and revoked invitations cannot be accepted', async () => {
    const { token } = await invite('owner')
    tables.invitations[0].expires_at = '2000-01-01T00:00:00Z'
    expect(await acceptInvitation(token, { id: 'u-inv', email: 'new@x.it' })).toEqual({ ok: false, error: 'expired' })
    const { token: t2 } = await invite('owner')
    await revokeInvitation(await ctxOf('owner'), tables.invitations.at(-1)!.id as string)
    expect(await acceptInvitation(t2, { id: 'u-inv', email: 'new@x.it' })).toEqual({ ok: false, error: 'revoked' })
    expect(tables.project_members.some((m) => m.user_id === 'u-inv')).toBe(false)
  })
  it('if the inviter lost the right in between, nothing is granted', async () => {
    const { token } = await invite('siteAdmin', { extras: ['forms.submission.read'] })
    tables.project_members.find((m) => m.user_id === 'u-admin')!.role = 'editor' // demoted
    expect(await acceptInvitation(token, { id: 'u-inv', email: 'new@x.it' })).toEqual({ ok: false, error: 'not_allowed' })
    expect(tables.project_members.some((m) => m.user_id === 'u-inv')).toBe(false)
    expect(tables.invitations[0].accepted_at).toBeNull()
  })
  it('never downgrades an existing membership; extras only add', async () => {
    tables.project_members.push({ id: 'pm9', project_id: P, user_id: 'u-inv', role: 'admin', extra_permissions: [] })
    const { token } = await invite('owner', { extras: ['forms.submission.read'] })
    expect((await acceptInvitation(token, { id: 'u-inv', email: 'new@x.it' })).ok).toBe(true)
    expect(tables.project_members.find((m) => m.user_id === 'u-inv')).toMatchObject({ role: 'admin', extra_permissions: ['forms.submission.read'] })
  })
})

describe('new person', () => {
  it('weak passwords are refused; a new account is created for the invited email only, then accepted', async () => {
    const { token } = await invite('owner')
    expect(await registerAndAccept(token, { password: 'short', fullName: 'X' })).toEqual({ ok: false, error: 'weak_password' })
    delete users.invitee
    expect(await registerAndAccept(token, { password: 'long-enough-1', fullName: 'Nuova\nPersona' })).toMatchObject({ ok: true })
    expect(Object.values(users).find((u) => u.email === 'new@x.it')).toBeDefined()
    expect(tables.project_members.filter((m) => m.role === 'editor')).toHaveLength(2)
  })
  it('an existing account must sign in instead', async () => {
    const { token } = await invite('owner')
    expect(await registerAndAccept(token, { password: 'long-enough-1', fullName: '' })).toEqual({ ok: false, error: 'email_exists' })
  })
  it('no account is created for an invalid or used token', async () => {
    delete users.invitee
    expect(await registerAndAccept('B'.repeat(43), { password: 'long-enough-1', fullName: '' })).toEqual({ ok: false, error: 'invalid' })
    expect(Object.values(users).some((u) => u.email === 'new@x.it')).toBe(false)
  })
})

describe('revoke', () => {
  it('the sender’s peers may cancel; an Editor may not; another client cannot even see it', async () => {
    await invite('owner')
    const invId = tables.invitations[0].id as string
    expect(await revokeInvitation(await ctxOf('editor'), invId)).toEqual({ ok: false, error: 'forbidden' })
    expect(await revokeInvitation(await ctxOf('ownerB'), invId)).toEqual({ ok: false, error: 'not_found' })
    expect(await revokeInvitation(await ctxOf('siteAdmin'), invId)).toEqual({ ok: true })
    expect(tables.invitations[0].revoked_by).toBe('u-admin')
  })
})
