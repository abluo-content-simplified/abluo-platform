// Server-only: service-role reads; never import from a client component.
/**
 * Admin provider — everyone with access to any site, across Abluo (ADR-030
 * amendment A1). Reads with the SERVICE ROLE, so every export checks
 * `requireAbluoAdmin()` itself first (defence in depth on top of the
 * `(admin)` layout gate). A snapshot: the page reads it when opened and when
 * the admin presses Update — nothing is live.
 *
 * Before migration 049: `last_seen_at` is missing, so "last active" falls
 * back to the last sign-in and access history reads as empty — the page works.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { readAllRows } from '@/lib/supabase/read-all'
import { assertAbluoAdmin } from '@/lib/api/admin-dashboard/projects'
import { safeAvatarUrl } from '@/lib/people/service'
import {
  buildAdminPeople,
  projectOptions,
  type AdminPerson,
  type RawArchive,
  type RawInvitation,
  type RawProfile,
  type RawProject,
  type RawProjectMember,
  type RawTenant,
  type RawTenantMember,
  type RawUser,
  type RawUsersInput,
  mergeActivity,
  ACTIVITY_LIMIT,
  type UserActivityItem,
} from '@/lib/admin/users-model'

export type { UserActivityItem } from '@/lib/admin/users-model'

type Row = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

async function readAuthUsers(admin: SupabaseClient): Promise<RawUser[]> {
  const out: RawUser[] = []
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`users: ${error.message}`)
    const users = (data?.users ?? []) as unknown as (Row & { app_metadata?: Row; factors?: { status?: string }[] })[]
    for (const u of users) {
      out.push({
        id: str(u.id),
        email: str(u.email),
        createdAt: strOrNull(u.created_at),
        lastSignInAt: strOrNull(u.last_sign_in_at),
        superAdmin: u.app_metadata?.platform_role === 'abluo_admin',
        twoFactor: Array.isArray(u.factors) ? u.factors.some((f) => f?.status === 'verified') : null,
      })
    }
    if (users.length < 1000) break
  }
  return out
}

async function readProfiles(admin: SupabaseClient): Promise<RawProfile[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the column list is chosen at run time (before/after 049)
  const read = (cols: string) => readAllRows<Row>((from, to) => (admin.from('profiles').select(cols) as any).order('id').range(from, to))
  let r = await read('id, full_name, avatar_url, last_seen_at')
  if (r.error) r = await read('id, full_name, avatar_url') // before migration 049
  return r.rows.map((p) => ({ id: str(p.id), name: str(p.full_name).trim(), avatarUrl: safeAvatarUrl(p.avatar_url), lastSeenAt: strOrNull(p.last_seen_at) }))
}

async function rows(admin: SupabaseClient, table: string, cols: string, filter?: (q: any) => any): Promise<Row[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { rows: out, error } = await readAllRows<Row>((from, to) => {
    let q = admin.from(table).select(cols) as any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (filter) q = filter(q)
    return q.order('id').range(from, to)
  })
  if (error) throw new Error(`${table}: ${error.message}`)
  return out
}

/** Everything the Users page needs, read in parallel. */
async function readUsersInput(admin: SupabaseClient): Promise<RawUsersInput> {
  const [users, profiles, tenants, projects, tm, pm, arch, inv] = await Promise.all([
    readAuthUsers(admin),
    readProfiles(admin),
    rows(admin, 'tenants', 'id, display_name'),
    rows(admin, 'projects', 'id, name, slug, tenant_id, status'),
    rows(admin, 'tenant_members', 'id, user_id, tenant_id, role, extra_permissions, created_at'),
    rows(admin, 'project_members', 'id, user_id, project_id, role, extra_permissions, created_at'),
    rows(admin, 'project_member_archive', 'id, user_id, project_id, role, extra_permissions, archived_at', (q) => q.is('restored_at', null)),
    rows(admin, 'invitations', 'id, email, scope_type, tenant_id, project_id, role, extra_permissions, created_at', (q) =>
      q.is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()),
    ),
  ])
  return {
    users,
    profiles,
    tenants: tenants.map((t): RawTenant => ({ id: str(t.id), name: str(t.display_name) })),
    projects: projects.map((p): RawProject => ({ id: str(p.id), name: str(p.name), slug: str(p.slug), tenantId: str(p.tenant_id) })),
    tenantMembers: tm.map((m): RawTenantMember => ({ userId: str(m.user_id), tenantId: str(m.tenant_id), role: str(m.role), extras: strings(m.extra_permissions), createdAt: strOrNull(m.created_at) })),
    projectMembers: pm.map((m): RawProjectMember => ({ userId: str(m.user_id), projectId: str(m.project_id), role: str(m.role), extras: strings(m.extra_permissions), createdAt: strOrNull(m.created_at) })),
    archives: arch.map((a): RawArchive => ({ userId: str(a.user_id), projectId: str(a.project_id), role: str(a.role), extras: strings(a.extra_permissions), archivedAt: str(a.archived_at) })),
    invitations: inv.map((i): RawInvitation => ({
      email: str(i.email),
      scope: i.scope_type === 'tenant' ? 'tenant' : 'project',
      tenantId: strOrNull(i.tenant_id),
      projectId: strOrNull(i.project_id),
      role: str(i.role),
      extras: strings(i.extra_permissions),
      createdAt: str(i.created_at),
    })),
  }
}

export type AdminUsersResult = {
  people: AdminPerson[]
  projects: { id: string; name: string }[]
  /** When this snapshot was read (ISO). */
  readAt: string
  error: string | null
}

export async function listAdminUsers(): Promise<AdminUsersResult> {
  await assertAbluoAdmin()
  const readAt = new Date().toISOString()
  try {
    const input = await readUsersInput(createAdminClient())
    return { people: buildAdminPeople(input), projects: projectOptions(input.projects), readAt, error: null }
  } catch (e) {
    return { people: [], projects: [], readAt, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── One person ──────────────────────────────────────────────────────────────
export type AdminUserDetail = { person: AdminPerson; activity: UserActivityItem[]; readAt: string }

async function settledRows(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  try {
    const { data, error } = await p
    return error ? [] : ((data as Row[]) ?? [])
  } catch {
    return []
  }
}

/** `key` is a user id, or `invite:<email>` for someone without an account. Null → 404. */
export async function getAdminUser(key: string): Promise<AdminUserDetail | null> {
  await assertAbluoAdmin()
  const admin = createAdminClient()
  const input = await readUsersInput(admin)
  const all = buildAdminPeople(input)
  const person = all.find((p) => p.key === key)
  if (!person) return null

  const projectName = new Map(input.projects.map((p) => [p.id, p.name || p.slug]))
  const tenantName = new Map(input.tenants.map((t) => [t.id, t.name]))
  const people = new Map(all.map((p) => [p.userId ?? '', p.name || p.email]))
  const place = (projectId: unknown, tenantId?: unknown) => projectName.get(str(projectId)) ?? tenantName.get(str(tenantId)) ?? ''
  const uid = person.userId
  const email = person.email.toLowerCase()

  const [content, accessAbout, accessBy, invites] = await Promise.all([
    uid
      ? settledRows(admin.from('content_audit_log').select('id, occurred_at, project_id, content_type, action, outcome, detail').eq('actor_id', uid).order('occurred_at', { ascending: false }).limit(ACTIVITY_LIMIT))
      : Promise.resolve([]),
    uid
      ? settledRows(admin.from('access_audit_log').select('id, occurred_at, actor_id, project_id, action, detail').eq('subject_user_id', uid).order('occurred_at', { ascending: false }).limit(ACTIVITY_LIMIT))
      : Promise.resolve([]),
    uid
      ? settledRows(admin.from('access_audit_log').select('id, occurred_at, subject_user_id, project_id, action, detail').eq('actor_id', uid).neq('subject_user_id', uid).order('occurred_at', { ascending: false }).limit(ACTIVITY_LIMIT))
      : Promise.resolve([]),
    settledRows(admin.from('invitations').select('id, created_at, accepted_at, revoked_at, scope_type, tenant_id, project_id, role, invited_by').eq('email', email).order('created_at', { ascending: false }).limit(ACTIVITY_LIMIT)),
  ])

  const items: UserActivityItem[] = []
  for (const r of content) {
    const outcome = r.outcome === 'refused' || r.outcome === 'failed' ? r.outcome : 'ok'
    items.push({ id: `c${r.id}`, at: str(r.occurred_at), kind: 'content', place: place(r.project_id), action: str(r.action), contentType: str(r.content_type), outcome, support: (r.detail as Row | null)?.support === true })
  }
  for (const r of accessAbout) {
    const d = (r.detail as Row | null) ?? {}
    items.push({ id: `a${r.id}`, at: str(r.occurred_at), kind: 'access', place: place(r.project_id), action: str(r.action), role: str(d.role), other: people.get(str(r.actor_id)) ?? '', support: d.support === true })
  }
  for (const r of accessBy) {
    const d = (r.detail as Row | null) ?? {}
    items.push({ id: `b${r.id}`, at: str(r.occurred_at), kind: 'accessBy', place: place(r.project_id), action: str(r.action), role: str(d.role), other: people.get(str(r.subject_user_id)) ?? '', support: d.support === true })
  }
  for (const r of invites) {
    const where = place(r.project_id, r.tenant_id)
    const by = people.get(str(r.invited_by)) ?? ''
    items.push({ id: `i${r.id}`, at: str(r.created_at), kind: 'invited', place: where, role: str(r.role), other: by })
    if (r.accepted_at) items.push({ id: `j${r.id}`, at: str(r.accepted_at), kind: 'joined', place: where, role: str(r.role) })
    if (r.revoked_at) items.push({ id: `r${r.id}`, at: str(r.revoked_at), kind: 'inviteCancelled', place: where, role: str(r.role) })
  }
  return { person, activity: mergeActivity(items), readAt: new Date().toISOString() }
}
