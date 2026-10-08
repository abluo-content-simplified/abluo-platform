/**
 * People on a site — ADR-028 (People list). Server-only.
 *
 * Who may use it: anyone holding users.invite or users.manage on the project
 * (the client's Owner, the site's Site admin). Every action is decided by
 * `checkGrant` on the caller's resolved grants BEFORE any write; the membership
 * tables accept no writes from API roles (migration 028), so these service-role
 * writes are the only way a membership changes. Extras are re-validated by the
 * database triggers (migrations 029, 031).
 *
 * People are archived, never deleted (migration 031): archiving deletes the
 * membership — access ends everywhere at once, through the checks that already
 * exist — and keeps a record of what they had, for Restore.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { checkGrant, type Granter } from '@/lib/authz/grant-rules'
import { granterForProject } from '@/lib/authz/granter'
import { isProjectGrantable, projectGrantableIds } from '@/lib/authz/permissions'
import { isTenantMemberRole, isTenantOwnerRole, PROJECT_MEMBERSHIP_ROLES, type ProjectMembershipRole } from '@/lib/authz/roles'
import { resolveProjectPermissions } from '@/lib/authz/resolve'
import { sendEmail } from '@/lib/notifications/resend'
import { renderAccessRestoredEmail } from '@/lib/invitations/email'
import { invitationLocale } from '@/lib/invitations/messages'
import { createInvitation, invitationOrigin, loadPerson, loadPlace, oneLine } from '@/lib/invitations/service'

export type PersonKind = 'owner' | 'member' | 'clientMember' | 'invitation' | 'archived'
export type PersonStatus = 'active' | 'invited' | 'expired' | 'archived'

export type Person = {
  key: string
  kind: PersonKind
  status: PersonStatus
  /** project_members.id — site memberships only (kind 'member'). */
  membershipId?: string
  /** invitations.id — kind 'invitation'. */
  invitationId?: string
  /** project_member_archive.id — kind 'archived'. */
  archiveId?: string
  name: string
  email: string
  /** Only images stored in Abluo's own storage; anything else is dropped. */
  avatarUrl: string | null
  role: 'owner' | 'admin' | 'editor' | 'member'
  extras: string[]
  isYou: boolean
  invitedAt: string | null
  invitedBy: string | null
  /** When they joined (accepted the invitation, or the membership was created). */
  joinedAt: string | null
  expiresAt: string | null
  archivedAt: string | null
  lastActiveAt: string | null
  /** Authenticator turned on; null for people without an account yet. */
  twoFactor: boolean | null
  /** Roles the viewer may switch this person to (empty → not editable). */
  editableRoles: ProjectMembershipRole[]
  canArchive: boolean
  canRestore: boolean
  canResend: boolean
  canCancel: boolean
}

export type PeopleView = {
  people: Person[]
  /** What the viewer may hand out on this site. */
  invitableRoles: ProjectMembershipRole[]
  grantableExtras: string[]
  /** Per role, the extras that add something (a role that already includes them gets none). */
  extrasForRole: Record<string, string[]>
}

type Err<E extends string> = { ok: false; error: E }
type Row = Record<string, unknown>

/** Resend limits: one per 5 minutes and five per day, per person and site. */
export const RESEND_COOLDOWN_MS = 5 * 60_000
export const RESEND_DAILY_MAX = 5

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The viewer's standing, or null when they may not manage people here. */
function manager(ctx: TenantAuthorizationContext, projectId: string): { grant: ProjectGrant; granter: Granter } | null {
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  const granter = granterForProject(ctx, projectId)
  if (!grant || !granter) return null
  if (!grant.permissions.includes('users.invite') && !grant.permissions.includes('users.manage')) return null
  return { grant, granter }
}

function rolesAllowed(granter: Granter, action: 'invite' | 'change', currentRole?: string): ProjectMembershipRole[] {
  return PROJECT_MEMBERSHIP_ROLES.filter(
    (role) => checkGrant(granter, { scope: 'project', action, role, currentRole: currentRole as never, extras: [] }).ok
  )
}

const mayGrant = (granter: Granter, role: string, extras: string[]) =>
  checkGrant(granter, { scope: 'project', action: 'invite', role: role as never, extras }).ok

/** Extras the viewer may hand out here: grantable on a project AND held by the viewer. */
function grantableExtrasFor(grant: ProjectGrant): string[] {
  return projectGrantableIds().filter((id) => isProjectGrantable(id) && grant.permissions.includes(id))
}

/** Avatars only from our own Supabase storage — never an arbitrary URL that could track the viewer. */
export function safeAvatarUrl(url: unknown): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (typeof url !== 'string' || !base) return null
  return url.startsWith(`${base.replace(/\/$/, '')}/storage/v1/object/public/`) ? url : null
}

type Account = { name: string; email: string; avatarUrl: string | null; lastActiveAt: string | null; twoFactor: boolean | null }

async function accounts(admin: SupabaseClient, ids: string[]): Promise<Map<string, Account>> {
  const out = new Map<string, Account>()
  if (!ids.length) return out
  const { data: profiles } = await admin.from('profiles').select('id, full_name, avatar_url').in('id', ids)
  const prof = new Map((profiles ?? []).map((p: Row) => [p.id as string, p]))
  await Promise.all(
    ids.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      const user = data?.user as (Row & { email?: string; last_sign_in_at?: string; factors?: { status?: string }[] }) | null
      let factors = user?.factors
      const mfa = (admin.auth.admin as { mfa?: { listFactors?: (p: { userId: string }) => Promise<{ data: { factors?: { status?: string }[] } | null }> } }).mfa
      if (user && mfa?.listFactors) {
        try {
          factors = (await mfa.listFactors({ userId: uid })).data?.factors ?? factors
        } catch {
          /* keep what getUserById said */
        }
      }
      const p = prof.get(uid)
      out.set(uid, {
        name: (((p?.full_name as string) ?? '') as string).trim(),
        email: user?.email ?? '',
        avatarUrl: safeAvatarUrl(p?.avatar_url),
        lastActiveAt: (user?.last_sign_in_at as string) ?? null,
        twoFactor: user ? (factors ?? []).some((f) => f.status === 'verified') : null,
      })
    })
  )
  return out
}

const NOBODY: Account = { name: '', email: '', avatarUrl: null, lastActiveAt: null, twoFactor: null }

const BLANK = {
  membershipId: undefined,
  invitationId: undefined,
  archiveId: undefined,
  invitedAt: null,
  invitedBy: null,
  joinedAt: null,
  expiresAt: null,
  archivedAt: null,
  editableRoles: [] as ProjectMembershipRole[],
  canArchive: false,
  canRestore: false,
  canResend: false,
  canCancel: false,
}

export async function listProjectPeople(ctx: TenantAuthorizationContext, projectId: string): Promise<PeopleView | null> {
  const m = manager(ctx, projectId)
  if (!m) return null
  const { granter, grant } = m
  return runAsTrustedSystemOperation(
    `people: list who has access to project ${projectId} for user ${ctx.userId} — authorized above (users.invite / users.manage on this project)`,
    async (admin) => {
      const { data: project } = await admin.from('projects').select('tenant_id').eq('id', projectId).maybeSingle()
      if (!project) return null
      const tenantId = project.tenant_id as string
      const [{ data: members }, { data: tenantRows }, { data: invites }, archive] = await Promise.all([
        admin.from('project_members').select('id, user_id, role, extra_permissions, created_at').eq('project_id', projectId),
        admin.from('tenant_members').select('user_id, role, extra_permissions, created_at').eq('tenant_id', tenantId),
        admin
          .from('invitations')
          .select('id, email, role, extra_permissions, created_at, expires_at, invited_by, accepted_at, accepted_by, revoked_at')
          .eq('project_id', projectId),
        // Before migration 031 is applied the table is missing: an error here just means "nobody archived".
        admin
          .from('project_member_archive')
          .select('id, user_id, role, extra_permissions, member_since, archived_at, archived_by, restored_at')
          .eq('project_id', projectId)
          .is('restored_at', null),
      ])
      const archived = archive.error ? [] : ((archive.data ?? []) as Row[])
      const owners = ((tenantRows ?? []) as Row[]).filter((r) => isTenantOwnerRole(r.role))
      const clientMembers = ((tenantRows ?? []) as Row[]).filter(
        (r) => isTenantMemberRole(r.role) && ((r.extra_permissions as string[]) ?? []).some(isProjectGrantable)
      )
      const memberRows = (members ?? []) as Row[]
      const allInvites = (invites ?? []) as Row[]

      // The accepted invitation that brought each member in (latest wins).
      const acceptedBy = new Map<string, Row>()
      for (const i of allInvites) {
        if (!i.accepted_by) continue
        const prev = acceptedBy.get(i.accepted_by as string)
        if (!prev || String(i.accepted_at) > String(prev.accepted_at)) acceptedBy.set(i.accepted_by as string, i)
      }
      // Open invitations: the latest per email, neither accepted nor cancelled.
      const openByEmail = new Map<string, Row>()
      for (const i of allInvites) {
        if (i.accepted_at || i.revoked_at) continue
        const prev = openByEmail.get(i.email as string)
        if (!prev || String(i.created_at ?? '') > String(prev.created_at ?? '')) openByEmail.set(i.email as string, i)
      }

      const activeUserIds = new Set([...owners, ...clientMembers, ...memberRows].map((r) => r.user_id as string))
      const openArchive = archived.filter((a) => !activeUserIds.has(a.user_id as string))
      const who = await accounts(admin, [
        ...new Set([
          ...activeUserIds,
          ...openArchive.map((a) => a.user_id as string),
          ...allInvites.flatMap((i) => [i.invited_by as string]).filter(Boolean),
        ]),
      ])
      const acc = (uid: unknown) => who.get(uid as string) ?? NOBODY
      const label = (uid: unknown) => (uid ? acc(uid).name || acc(uid).email || null : null)
      const activeEmails = new Set([...activeUserIds].map((u) => acc(u).email.toLowerCase()).filter(Boolean))
      const now = Date.now()

      const fromAccount = (uid: unknown) => {
        const a = acc(uid)
        return { name: a.name, email: a.email, avatarUrl: a.avatarUrl, lastActiveAt: a.lastActiveAt, twoFactor: a.twoFactor, isYou: uid === ctx.userId }
      }

      const list: Person[] = [
        ...owners.map((r) => ({
          ...BLANK,
          key: `owner:${r.user_id}`,
          kind: 'owner' as const,
          status: 'active' as const,
          ...fromAccount(r.user_id),
          role: 'owner' as const,
          extras: [],
          joinedAt: (r.created_at as string) ?? null,
        })),
        ...memberRows.map((r) => {
          const currentRole = r.role as string
          const self = r.user_id === ctx.userId
          const inv = acceptedBy.get(r.user_id as string)
          return {
            ...BLANK,
            key: `member:${r.id}`,
            kind: 'member' as const,
            status: 'active' as const,
            membershipId: r.id as string,
            ...fromAccount(r.user_id),
            role: currentRole as Person['role'],
            extras: (r.extra_permissions as string[]) ?? [],
            invitedAt: (inv?.created_at as string) ?? null,
            invitedBy: label(inv?.invited_by),
            joinedAt: ((inv?.accepted_at ?? r.created_at) as string) ?? null,
            editableRoles: self ? [] : rolesAllowed(granter, 'change', currentRole),
            canArchive: !self && checkGrant(granter, { scope: 'project', action: 'remove', currentRole: currentRole as never }).ok,
          }
        }),
        ...clientMembers.map((r) => ({
          ...BLANK,
          key: `client:${r.user_id}`,
          kind: 'clientMember' as const,
          status: 'active' as const,
          ...fromAccount(r.user_id),
          role: 'member' as const,
          extras: ((r.extra_permissions as string[]) ?? []).filter(isProjectGrantable),
          joinedAt: (r.created_at as string) ?? null,
        })),
        ...[...openByEmail.values()]
          .filter((i) => !activeEmails.has(String(i.email).toLowerCase()))
          .map((i) => {
            const extras = (i.extra_permissions as string[]) ?? []
            const allowed = mayGrant(granter, i.role as string, extras)
            const expired = new Date(i.expires_at as string).getTime() <= now
            return {
              ...BLANK,
              key: `invitation:${i.id}`,
              kind: 'invitation' as const,
              status: expired ? ('expired' as const) : ('invited' as const),
              invitationId: i.id as string,
              name: '',
              email: i.email as string,
              avatarUrl: null,
              lastActiveAt: null,
              twoFactor: null,
              isYou: false,
              role: i.role as Person['role'],
              extras,
              invitedAt: (i.created_at as string) ?? null,
              invitedBy: label(i.invited_by),
              expiresAt: i.expires_at as string,
              canResend: allowed,
              canCancel: allowed,
            }
          }),
        ...openArchive.map((a) => {
          const extras = (a.extra_permissions as string[]) ?? []
          return {
            ...BLANK,
            key: `archived:${a.id}`,
            kind: 'archived' as const,
            status: 'archived' as const,
            archiveId: a.id as string,
            ...fromAccount(a.user_id),
            role: a.role as Person['role'],
            extras,
            joinedAt: (a.member_since as string) ?? null,
            archivedAt: (a.archived_at as string) ?? null,
            canRestore: mayGrant(granter, a.role as string, extras),
          }
        }),
      ]
      return {
        people: list,
        invitableRoles: rolesAllowed(granter, 'invite'),
        grantableExtras: grantableExtrasFor(grant),
        extrasForRole: Object.fromEntries(
          PROJECT_MEMBERSHIP_ROLES.map((role) => {
            const byRole = resolveProjectPermissions({ role, enabledModuleIds: grant.enabledModuleIds }).permissions
            return [role, grantableExtrasFor(grant).filter((id) => !byRole.includes(id))]
          })
        ),
      }
    }
  )
}

async function loadMember(admin: SupabaseClient, projectId: string, membershipId: string) {
  const { data } = await admin
    .from('project_members')
    .select('id, user_id, role, extra_permissions, created_at')
    .eq('id', membershipId)
    .eq('project_id', projectId)
    .maybeSingle()
  return data as { id: string; user_id: string; role: string; extra_permissions: string[]; created_at?: string } | null
}

export async function updateProjectMember(
  ctx: TenantAuthorizationContext,
  projectId: string,
  membershipId: unknown,
  input: { role: unknown; extras: unknown }
): Promise<{ ok: true } | Err<'not_found' | 'forbidden' | 'invalid' | 'failed'>> {
  if (typeof membershipId !== 'string') return { ok: false, error: 'not_found' }
  const m = manager(ctx, projectId)
  if (!m) return { ok: false, error: 'not_found' }
  if (!PROJECT_MEMBERSHIP_ROLES.includes(input.role as never)) return { ok: false, error: 'invalid' }
  const extras = Array.isArray(input.extras) ? [...new Set(input.extras.filter((x): x is string => typeof x === 'string'))] : null
  if (!extras) return { ok: false, error: 'invalid' }
  return runAsTrustedSystemOperation(
    `people: change membership ${membershipId} on project ${projectId} by user ${ctx.userId} — checkGrant(change) on the caller's grant`,
    async (admin) => {
      const row = await loadMember(admin, projectId, membershipId)
      if (!row) return { ok: false as const, error: 'not_found' as const }
      if (row.user_id === ctx.userId) return { ok: false as const, error: 'forbidden' as const } // nobody edits their own access
      const decision = checkGrant(m.granter, {
        scope: 'project',
        action: 'change',
        role: input.role as never,
        currentRole: row.role as never,
        extras,
      })
      if (!decision.ok) return { ok: false as const, error: 'forbidden' as const }
      const { error } = await admin.from('project_members').update({ role: input.role, extra_permissions: extras }).eq('id', row.id)
      return error ? { ok: false as const, error: 'failed' as const } : { ok: true as const }
    }
  )
}

/**
 * Archive: the membership is removed (access ends at once, everywhere) and a
 * record of the role and extras is kept for Restore. Pending invitations for
 * the same person on this site are cancelled too, so nothing lets them back in.
 */
export async function archiveProjectMember(
  ctx: TenantAuthorizationContext,
  projectId: string,
  membershipId: unknown
): Promise<{ ok: true } | Err<'not_found' | 'forbidden' | 'failed'>> {
  if (typeof membershipId !== 'string') return { ok: false, error: 'not_found' }
  const m = manager(ctx, projectId)
  if (!m) return { ok: false, error: 'not_found' }
  return runAsTrustedSystemOperation(
    `people: archive membership ${membershipId} on project ${projectId} by user ${ctx.userId} — checkGrant(remove) on the caller's grant`,
    async (admin) => {
      const row = await loadMember(admin, projectId, membershipId)
      if (!row) return { ok: false as const, error: 'not_found' as const }
      if (row.user_id === ctx.userId) return { ok: false as const, error: 'forbidden' as const }
      if (!checkGrant(m.granter, { scope: 'project', action: 'remove', currentRole: row.role as never }).ok) {
        return { ok: false as const, error: 'forbidden' as const }
      }
      const now = new Date().toISOString()
      // A stale open record (they re-joined some other way) is closed first.
      await admin
        .from('project_member_archive')
        .update({ restored_at: now, restored_by: ctx.userId })
        .eq('project_id', projectId)
        .eq('user_id', row.user_id)
        .is('restored_at', null)
      const { data: record, error: archiveError } = await admin
        .from('project_member_archive')
        .insert({
          project_id: projectId,
          user_id: row.user_id,
          role: row.role,
          extra_permissions: row.extra_permissions ?? [],
          member_since: row.created_at ?? null,
          archived_by: ctx.userId,
        })
        .select('id')
        .single()
      if (archiveError || !record) return { ok: false as const, error: 'failed' as const }
      const { error } = await admin.from('project_members').delete().eq('id', row.id).eq('project_id', projectId)
      if (error) {
        await admin.from('project_member_archive').delete().eq('id', record.id as string)
        return { ok: false as const, error: 'failed' as const }
      }
      const { email } = await loadPerson(admin, row.user_id)
      if (email) {
        await admin
          .from('invitations')
          .update({ revoked_at: now, revoked_by: ctx.userId })
          .eq('project_id', projectId)
          .eq('email', email.toLowerCase())
          .is('accepted_at', null)
          .is('revoked_at', null)
      }
      return { ok: true as const }
    }
  )
}

/** Restore: the same role and extras come back — only if the viewer could give them today. */
export async function restoreProjectMember(
  ctx: TenantAuthorizationContext,
  projectId: string,
  archiveId: unknown,
  opts: { locale: string; requestOrigin?: string | null },
  deps: { send?: typeof sendEmail } = {}
): Promise<{ ok: true; emailSent: boolean } | Err<'not_found' | 'forbidden' | 'failed'>> {
  if (typeof archiveId !== 'string' || !UUID.test(archiveId)) return { ok: false, error: 'not_found' }
  const m = manager(ctx, projectId)
  if (!m) return { ok: false, error: 'not_found' }
  return runAsTrustedSystemOperation(
    `people: restore archived member ${archiveId} on project ${projectId} by user ${ctx.userId} — checkGrant(invite) for the archived role and extras`,
    async (admin) => {
      const { data: rec } = await admin
        .from('project_member_archive')
        .select('id, user_id, role, extra_permissions, restored_at')
        .eq('id', archiveId)
        .eq('project_id', projectId)
        .is('restored_at', null)
        .maybeSingle()
      if (!rec) return { ok: false as const, error: 'not_found' as const }
      const extras = (rec.extra_permissions as string[]) ?? []
      if (rec.user_id === ctx.userId || !mayGrant(m.granter, rec.role as string, extras)) {
        return { ok: false as const, error: 'forbidden' as const }
      }
      const now = new Date().toISOString()
      const { data: existing } = await admin
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', rec.user_id as string)
        .maybeSingle()
      if (!existing) {
        const { error } = await admin
          .from('project_members')
          .insert({ project_id: projectId, user_id: rec.user_id, role: rec.role, extra_permissions: extras })
        if (error) return { ok: false as const, error: 'failed' as const }
      }
      await admin.from('project_member_archive').update({ restored_at: now, restored_by: ctx.userId }).eq('id', rec.id as string)
      if (existing) return { ok: true as const, emailSent: false }

      // "Your access is back" — best effort; the restore stands either way.
      const [place, person, by] = await Promise.all([
        loadPlace(admin, { scope: 'project', projectId }),
        loadPerson(admin, rec.user_id as string),
        loadPerson(admin, ctx.userId),
      ])
      if (!place || !person.email) return { ok: true as const, emailSent: false }
      const locale = invitationLocale(opts.locale)
      const byName = oneLine(by.name || by.email || 'Abluo')
      const mail = renderAccessRestoredEmail({
        locale,
        byName,
        placeName: oneLine(place.name),
        role: rec.role as string,
        url: `${invitationOrigin(opts.requestOrigin)}/${locale}/${place.slug ?? ''}/home`,
      })
      const sent = await (deps.send ?? sendEmail)({
        to: [person.email],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        fromName: `${byName} via Abluo`,
        replyTo: by.email ?? undefined,
      })
      return { ok: true as const, emailSent: sent.ok }
    }
  )
}

/**
 * Resend: a fresh invitation with the same email, role and extras (the old
 * link stops working). Limited per person and site so nobody can be spammed
 * through Abluo.
 */
export async function resendProjectInvitation(
  ctx: TenantAuthorizationContext,
  projectId: string,
  invitationId: unknown,
  opts: { locale: string; requestOrigin?: string | null },
  deps: { send?: typeof sendEmail } = {}
): Promise<{ ok: true; emailSent: boolean } | Err<'not_found' | 'forbidden' | 'too_soon' | 'failed'>> {
  if (typeof invitationId !== 'string' || !UUID.test(invitationId)) return { ok: false, error: 'not_found' }
  const m = manager(ctx, projectId)
  if (!m) return { ok: false, error: 'not_found' }
  const found = await runAsTrustedSystemOperation(
    `people: look up invitation ${invitationId} on project ${projectId} to resend, for user ${ctx.userId} — manager of this project`,
    async (admin) => {
      const { data: inv } = await admin
        .from('invitations')
        .select('id, email, role, extra_permissions, accepted_at, revoked_at')
        .eq('id', invitationId)
        .eq('project_id', projectId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .maybeSingle()
      if (!inv) return null
      const dayAgo = new Date(Date.now() - 864e5).toISOString()
      const { data: recent } = await admin
        .from('invitations')
        .select('id, created_at')
        .eq('project_id', projectId)
        .eq('email', inv.email as string)
        .gt('created_at', dayAgo)
      return { inv, recent: (recent ?? []) as Row[] }
    }
  )
  if (!found) return { ok: false, error: 'not_found' }
  const { inv, recent } = found
  const extras = (inv.extra_permissions as string[]) ?? []
  if (!mayGrant(m.granter, inv.role as string, extras)) return { ok: false, error: 'forbidden' }
  const lastSent = Math.max(0, ...recent.map((r) => new Date(r.created_at as string).getTime() || 0))
  if (recent.length >= RESEND_DAILY_MAX || Date.now() - lastSent < RESEND_COOLDOWN_MS) return { ok: false, error: 'too_soon' }
  const r = await createInvitation(
    ctx,
    {
      target: { scope: 'project', projectId },
      email: inv.email,
      role: inv.role,
      extras,
      locale: opts.locale,
      requestOrigin: opts.requestOrigin,
    },
    deps
  )
  if (!r.ok) return { ok: false, error: r.error === 'forbidden' ? 'forbidden' : r.error === 'not_found' ? 'not_found' : 'failed' }
  return { ok: true, emailSent: r.emailSent }
}

/** Cancel an invitation — only one that belongs to this site. */
export async function cancelProjectInvitation(
  ctx: TenantAuthorizationContext,
  projectId: string,
  invitationId: unknown
): Promise<{ ok: true } | Err<'not_found' | 'forbidden' | 'failed'>> {
  if (typeof invitationId !== 'string' || !UUID.test(invitationId)) return { ok: false, error: 'not_found' }
  const m = manager(ctx, projectId)
  if (!m) return { ok: false, error: 'not_found' }
  return runAsTrustedSystemOperation(
    `people: cancel invitation ${invitationId} on project ${projectId} by user ${ctx.userId} — checkGrant(invite) for the invitation's role and extras`,
    async (admin) => {
      const { data: inv } = await admin
        .from('invitations')
        .select('id, role, extra_permissions, accepted_at, revoked_at')
        .eq('id', invitationId)
        .eq('project_id', projectId)
        .maybeSingle()
      if (!inv) return { ok: false as const, error: 'not_found' as const }
      if (!mayGrant(m.granter, inv.role as string, (inv.extra_permissions as string[]) ?? [])) {
        return { ok: false as const, error: 'forbidden' as const }
      }
      if (inv.accepted_at || inv.revoked_at) return { ok: true as const }
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
