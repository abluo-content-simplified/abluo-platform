/**
 * Invitations — ADR-028 §4 and §6. Server-only.
 *
 * An invitation is a record until it is accepted. One link and one page for
 * everyone: a person who already has an Abluo account signs in and accepts; a
 * new person sets a password and the account is created. The no-escalation
 * rules are checked when the invitation is CREATED (the caller) and again when
 * it is ACCEPTED (the inviter, freshly resolved from the database — they may
 * have lost access in between).
 *
 * Every database operation here uses the service role: `invitations` has no
 * grant for API roles (migration 029). Each call states why in its audit
 * label. Authorization is decided BEFORE any write, from the caller's
 * resolved grants — never from request input.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { resolvePlatformRole } from '@/lib/api/auth'
import { loadTenantAuthorizationContext, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { checkGrant, type GrantRefusal } from '@/lib/authz/grant-rules'
import { granterForProject, granterForTenant } from '@/lib/authz/granter'
import { PROJECT_MEMBERSHIP_ROLES, TENANT_MEMBERSHIP_ROLES } from '@/lib/authz/roles'
import { sendEmail } from '@/lib/notifications/resend'
import { renderInvitationEmail } from './email'
import { invitationLocale } from './messages'
import { hashInvitationToken, isWellFormedToken, newInvitationToken } from './token'

export type InvitationTarget = { scope: 'tenant'; tenantId: string } | { scope: 'project'; projectId: string }
export type TenantInviteRole = 'owner' | 'member'
export type ProjectInviteRole = 'admin' | 'editor'
export type InviteRole = TenantInviteRole | ProjectInviteRole

export const MIN_PASSWORD_LENGTH = 8

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Lower-cased, trimmed, plausible email — or null. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const email = input.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) return null
  return email
}

/**
 * The origin the email link points to. Only Abluo's own hosts (and localhost
 * in development) are trusted — a forged Host header must never turn an
 * invitation into a link to someone else's site.
 */
export function invitationOrigin(requestOrigin: string | null | undefined): string {
  const fallback = 'https://abluo.app'
  if (!requestOrigin) return fallback
  try {
    const u = new URL(requestOrigin)
    if (u.protocol === 'https:' && (u.hostname === 'abluo.app' || u.hostname.endsWith('.abluo.app'))) return u.origin
    if (u.protocol === 'http:' && u.hostname === 'localhost') return u.origin
  } catch {
    /* fall through */
  }
  return fallback
}

/** Single-line display text (names go into the From header and subject). */
function oneLine(s: string, max = 80): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

const RANK: Record<string, number> = { member: 1, owner: 2, editor: 1, admin: 2 }

// ── Create ──────────────────────────────────────────────────────────────────

export type CreateInvitationResult =
  | { ok: true; id: string; emailSent: boolean }
  | { ok: false; error: 'invalid_email' | 'invalid_role' | 'forbidden' | 'not_found' | 'failed'; reason?: GrantRefusal }

export async function createInvitation(
  ctx: TenantAuthorizationContext,
  input: {
    target: InvitationTarget
    email: unknown
    role: unknown
    extras?: unknown
    locale: string
    requestOrigin?: string | null
    /** True only after requireAbluoAdmin() (Super Admin, 2FA) on this request. */
    adminAssured?: boolean
  },
  deps: { send?: typeof sendEmail } = {}
): Promise<CreateInvitationResult> {
  const email = normalizeEmail(input.email)
  if (!email) return { ok: false, error: 'invalid_email' }
  const extras = Array.isArray(input.extras) ? [...new Set(input.extras.filter((x): x is string => typeof x === 'string'))] : []
  const { target } = input
  const role = input.role
  const roleOk = (target.scope === 'tenant' ? TENANT_MEMBERSHIP_ROLES : PROJECT_MEMBERSHIP_ROLES).includes(role as never)
  if (!roleOk) return { ok: false, error: 'invalid_role' }

  // 1. Authorization — from the caller's resolved grants, before anything else.
  const granter =
    target.scope === 'tenant'
      ? granterForTenant(ctx, target.tenantId, { adminAssured: input.adminAssured })
      : granterForProject(ctx, target.projectId, { adminAssured: input.adminAssured })
  if (!granter) return { ok: false, error: 'forbidden' }
  const decision = checkGrant(granter, { scope: target.scope, action: 'invite', role: role as InviteRole as never, extras })
  if (!decision.ok) return { ok: false, error: 'forbidden', reason: decision.reason }

  return runAsTrustedSystemOperation(
    `invitations: create a ${target.scope} invitation for user ${ctx.userId} — authorized above by checkGrant (ADR-028 §4); invitations is server-only (migration 029)`,
    async (admin) => {
      const place = await loadPlace(admin, target)
      if (!place) return { ok: false as const, error: 'not_found' as const }
      const inviter = await loadPerson(admin, ctx.userId)

      const token = newInvitationToken()
      const now = new Date().toISOString()
      // A new invitation replaces a pending one for the same person and place.
      const pending = admin
        .from('invitations')
        .update({ revoked_at: now, revoked_by: ctx.userId })
        .eq('email', email)
        .is('accepted_at', null)
        .is('revoked_at', null)
      const { error: revokeError } =
        target.scope === 'tenant' ? await pending.eq('tenant_id', target.tenantId) : await pending.eq('project_id', target.projectId)
      if (revokeError) return { ok: false as const, error: 'failed' as const }

      const { data: row, error } = await admin
        .from('invitations')
        .insert({
          email,
          scope_type: target.scope,
          tenant_id: target.scope === 'tenant' ? target.tenantId : null,
          project_id: target.scope === 'project' ? target.projectId : null,
          role,
          extra_permissions: extras,
          invited_by: ctx.userId,
          token_hash: hashInvitationToken(token),
        })
        .select('id, expires_at')
        .single()
      if (error || !row) return { ok: false as const, error: 'failed' as const }

      const locale = invitationLocale(input.locale)
      const url = `${invitationOrigin(input.requestOrigin)}/invite/accept?token=${token}&lang=${locale}`
      const inviterName = oneLine(inviter.name || inviter.email || 'Abluo')
      const mail = renderInvitationEmail({
        locale,
        inviterName,
        placeName: oneLine(place.name),
        role: role as string,
        extras,
        url,
        expiresAt: new Date(row.expires_at as string),
      })
      const sent = await (deps.send ?? sendEmail)({
        to: [email],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        fromName: `${inviterName} via Abluo`,
        replyTo: inviter.email ?? undefined,
      })
      return { ok: true as const, id: row.id as string, emailSent: sent.ok }
    }
  )
}

// ── Revoke ──────────────────────────────────────────────────────────────────

/** Whoever could have sent this invitation may cancel it. */
export async function revokeInvitation(
  ctx: TenantAuthorizationContext,
  invitationId: string,
  opts: { adminAssured?: boolean } = {}
): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'forbidden' | 'failed' }> {
  if (typeof invitationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(invitationId)) return { ok: false, error: 'not_found' }
  return runAsTrustedSystemOperation(
    `invitations: revoke invitation ${invitationId} for user ${ctx.userId} — authorized by checkGrant on the invitation's own scope and role`,
    async (admin) => {
      const { data: row } = await admin
        .from('invitations')
        .select('id, scope_type, tenant_id, project_id, role, accepted_at, revoked_at')
        .eq('id', invitationId)
        .maybeSingle()
      if (!row) return { ok: false as const, error: 'not_found' as const }
      const granter =
        row.scope_type === 'tenant'
          ? granterForTenant(ctx, row.tenant_id as string, opts)
          : granterForProject(ctx, row.project_id as string, opts)
      // Same answer for "not yours" and "does not exist": no probing other clients' invitations.
      if (!granter) return { ok: false as const, error: 'not_found' as const }
      const decision = checkGrant(granter, { scope: row.scope_type as 'tenant', action: 'invite', role: row.role as never })
      if (!decision.ok) return { ok: false as const, error: 'forbidden' as const }
      if (row.accepted_at || row.revoked_at) return { ok: true as const }
      const { error } = await admin
        .from('invitations')
        .update({ revoked_at: new Date().toISOString(), revoked_by: ctx.userId })
        .eq('id', invitationId)
        .is('accepted_at', null)
        .is('revoked_at', null)
      return error ? { ok: false as const, error: 'failed' as const } : { ok: true as const }
    }
  )
}

// ── Look up (acceptance page) ───────────────────────────────────────────────

export type InvitationStatus = 'valid' | 'invalid' | 'expired' | 'revoked' | 'used'

export type InvitationView = {
  status: InvitationStatus
  email?: string
  role?: InviteRole
  extras?: string[]
  placeName?: string
  inviterName?: string
}

type InvitationRow = {
  id: string
  email: string
  scope_type: 'tenant' | 'project'
  tenant_id: string | null
  project_id: string | null
  role: InviteRole
  extra_permissions: string[]
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

function statusOf(row: InvitationRow | null, now = Date.now()): InvitationStatus {
  if (!row) return 'invalid'
  if (row.accepted_at) return 'used'
  if (row.revoked_at) return 'revoked'
  if (new Date(row.expires_at).getTime() <= now) return 'expired'
  return 'valid'
}

async function rowForToken(admin: SupabaseClient, token: unknown): Promise<InvitationRow | null> {
  if (!isWellFormedToken(token)) return null
  const { data } = await admin
    .from('invitations')
    .select('id, email, scope_type, tenant_id, project_id, role, extra_permissions, invited_by, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashInvitationToken(token))
    .maybeSingle()
  return (data as InvitationRow | null) ?? null
}

/** What the acceptance page may show. The token holder is the invitee, so this is theirs to see. */
export async function lookupInvitation(token: unknown): Promise<InvitationView> {
  if (!isWellFormedToken(token)) return { status: 'invalid' }
  return runAsTrustedSystemOperation(
    'invitations: read one invitation by the hash of the token its invitee holds (acceptance page)',
    async (admin) => {
      const row = await rowForToken(admin, token)
      const status = statusOf(row)
      if (!row) return { status }
      const place = await loadPlace(admin, row.scope_type === 'tenant' ? { scope: 'tenant', tenantId: row.tenant_id! } : { scope: 'project', projectId: row.project_id! })
      const inviter = row.invited_by ? await loadPerson(admin, row.invited_by) : { name: '', email: null }
      return {
        status,
        email: row.email,
        role: row.role,
        extras: row.extra_permissions ?? [],
        placeName: place?.name ?? '',
        inviterName: oneLine(inviter.name || inviter.email || 'Abluo'),
      }
    }
  )
}

// ── Accept ──────────────────────────────────────────────────────────────────

export type AcceptResult =
  | { ok: true; scope: 'tenant' | 'project'; projectSlug?: string }
  | { ok: false; error: Exclude<InvitationStatus, 'valid'> | 'wrong_account' | 'not_allowed' | 'failed' }

/**
 * Accepts an invitation for a signed-in user. `user` must come from the
 * validated session (getUser()), never from request input.
 */
export async function acceptInvitation(token: unknown, user: { id: string; email: string | null | undefined }): Promise<AcceptResult> {
  if (!isWellFormedToken(token)) return { ok: false, error: 'invalid' }
  return runAsTrustedSystemOperation(
    `invitations: accept for signed-in user ${user.id} — token hash match, email match and a fresh no-escalation check of the inviter`,
    (admin) => acceptWithClient(admin, token, user)
  )
}

async function acceptWithClient(admin: SupabaseClient, token: string, user: { id: string; email: string | null | undefined }): Promise<AcceptResult> {
  const row = await rowForToken(admin, token)
  const status = statusOf(row)
  if (!row || status !== 'valid') return { ok: false, error: status === 'valid' ? 'invalid' : status }
  if (!user.email || user.email.trim().toLowerCase() !== row.email) return { ok: false, error: 'wrong_account' }

  // The inviter must STILL be allowed to give exactly this access.
  if (!(await inviterStillAllowed(admin, row))) return { ok: false, error: 'not_allowed' }

  // Claim the invitation atomically: only one acceptance can win.
  const { data: claimed } = await admin
    .from('invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
    .eq('id', row.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
  if (!claimed?.length) return { ok: false, error: 'used' }

  const applied = await applyMembership(admin, row, user.id)
  if (!applied.ok) {
    await admin.from('invitations').update({ accepted_at: null, accepted_by: null }).eq('id', row.id)
    return { ok: false, error: 'failed' }
  }
  return { ok: true, scope: row.scope_type, projectSlug: applied.projectSlug }
}

/** New person: create the account (the token proves they read the invited inbox), then accept. */
export async function registerAndAccept(
  token: unknown,
  input: { password: unknown; fullName: unknown }
): Promise<AcceptResult | { ok: false; error: 'email_exists' | 'weak_password' }> {
  if (!isWellFormedToken(token)) return { ok: false, error: 'invalid' }
  if (typeof input.password !== 'string' || input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 200) {
    return { ok: false, error: 'weak_password' }
  }
  const password = input.password
  const fullName = typeof input.fullName === 'string' ? oneLine(input.fullName, 120) : ''
  return runAsTrustedSystemOperation(
    'invitations: create the invited person’s account (self-signup is disabled; a valid invitation token is the authorization) and accept',
    async (admin) => {
      const row = await rowForToken(admin, token)
      const status = statusOf(row)
      if (!row || status !== 'valid') return { ok: false as const, error: status === 'valid' ? ('invalid' as const) : status }
      const { data, error } = await admin.auth.admin.createUser({
        email: row.email,
        password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      })
      if (error || !data.user) {
        const exists = /already|exists|registered/i.test(error?.message ?? '') || error?.status === 422
        return { ok: false as const, error: exists ? ('email_exists' as const) : ('failed' as const) }
      }
      return acceptWithClient(admin, token as string, { id: data.user.id, email: data.user.email })
    }
  )
}

// ── Internals ───────────────────────────────────────────────────────────────

async function loadPlace(admin: SupabaseClient, target: InvitationTarget): Promise<{ name: string; tenantId: string; slug?: string } | null> {
  if (target.scope === 'tenant') {
    const { data } = await admin.from('tenants').select('id, display_name').eq('id', target.tenantId).maybeSingle()
    return data ? { name: (data.display_name as string) ?? '', tenantId: data.id as string } : null
  }
  const { data } = await admin.from('projects').select('id, name, slug, tenant_id').eq('id', target.projectId).maybeSingle()
  return data ? { name: (data.name as string) ?? '', tenantId: data.tenant_id as string, slug: data.slug as string } : null
}

async function loadPerson(admin: SupabaseClient, userId: string): Promise<{ name: string; email: string | null }> {
  const [{ data: profile }, { data: auth }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ])
  return { name: ((profile?.full_name as string) ?? '').trim(), email: auth?.user?.email ?? null }
}

async function inviterStillAllowed(admin: SupabaseClient, row: InvitationRow): Promise<boolean> {
  if (!row.invited_by) return false
  const { data: auth } = await admin.auth.admin.getUserById(row.invited_by)
  if (!auth?.user) return false
  const platformRole = resolvePlatformRole(auth.user.app_metadata)
  const ctx = await loadTenantAuthorizationContext(admin, { userId: row.invited_by, platformRole })
  // A Super Admin's flag is server-controlled (app_metadata); it was verified with 2FA when the invitation was created.
  const adminAssured = platformRole === 'abluo_admin'
  const granter =
    row.scope_type === 'tenant'
      ? granterForTenant(ctx, row.tenant_id!, { adminAssured })
      : granterForProject(ctx, row.project_id!, { adminAssured })
  if (!granter) return false
  return checkGrant(granter, {
    scope: row.scope_type as 'tenant',
    action: 'invite',
    role: row.role as never,
    extras: row.extra_permissions ?? [],
  }).ok
}

async function applyMembership(admin: SupabaseClient, row: InvitationRow, userId: string): Promise<{ ok: boolean; projectSlug?: string }> {
  const extras = row.extra_permissions ?? []
  if (row.scope_type === 'tenant') {
    const { data: existing } = await admin
      .from('tenant_members')
      .select('id, role, extra_permissions')
      .eq('tenant_id', row.tenant_id!)
      .eq('user_id', userId)
      .maybeSingle()
    if (!existing) {
      const { error } = await admin.from('tenant_members').insert({ tenant_id: row.tenant_id, user_id: userId, role: row.role, extra_permissions: extras })
      return { ok: !error }
    }
    // Never downgrade an existing membership; extras only add.
    const role = (RANK[row.role] ?? 0) > (RANK[existing.role as string] ?? 0) ? row.role : existing.role
    const merged = [...new Set([...((existing.extra_permissions as string[]) ?? []), ...extras])]
    const { error } = await admin.from('tenant_members').update({ role, extra_permissions: merged }).eq('id', existing.id)
    return { ok: !error }
  }
  const { data: project } = await admin.from('projects').select('slug').eq('id', row.project_id!).maybeSingle()
  const { data: existing } = await admin
    .from('project_members')
    .select('id, role, extra_permissions')
    .eq('project_id', row.project_id!)
    .eq('user_id', userId)
    .maybeSingle()
  let error
  if (!existing) {
    ;({ error } = await admin.from('project_members').insert({ project_id: row.project_id, user_id: userId, role: row.role, extra_permissions: extras }))
  } else {
    const role = (RANK[row.role] ?? 0) > (RANK[existing.role as string] ?? 0) ? row.role : existing.role
    const merged = [...new Set([...((existing.extra_permissions as string[]) ?? []), ...extras])]
    ;({ error } = await admin.from('project_members').update({ role, extra_permissions: merged }).eq('id', existing.id))
  }
  return { ok: !error, projectSlug: (project?.slug as string) ?? undefined }
}
