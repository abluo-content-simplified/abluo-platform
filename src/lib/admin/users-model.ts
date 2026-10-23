/**
 * Admin Users (ADR-030 amendment A1) — the pure part: raw rows → one row per
 * person, filters, sort, summary. No I/O; the provider is
 * `src/lib/api/admin-dashboard/users.ts`.
 *
 * A person is anyone with an Abluo account OR a pending invitation. Their
 * access is a list of places (a client as Owner, or a site as Site admin /
 * Editor), each active, invited or archived. Super Admin is the platform role
 * (`app_metadata.platform_role = 'abluo_admin'`), shown as a badge — it is not
 * a membership.
 */
import { isActiveNow, lastActiveAt } from '@/lib/presence/model'

export type AccessStatus = 'active' | 'invited' | 'archived'
/** Overall: active (any active access or Super Admin) › invited › archived › none. */
export type PersonStatus = AccessStatus | 'none'
/** owner = tenant Owner; admin / editor = site roles. */
export type AccessRole = string

export type PersonAccess = {
  scope: 'tenant' | 'project'
  /** tenant id or project id. */
  placeId: string
  placeName: string
  /** The sites this access covers (an Owner covers every site of the client). */
  projectIds: string[]
  role: AccessRole
  extras: string[]
  status: AccessStatus
  /** When it started (member since / invited / archived). */
  since: string | null
}

export type AdminPerson = {
  /** user id, or `invite:<email>` for someone who has no account yet. */
  key: string
  userId: string | null
  name: string
  email: string
  avatarUrl: string | null
  superAdmin: boolean
  access: PersonAccess[]
  status: PersonStatus
  twoFactor: boolean | null
  lastSignInAt: string | null
  /** Later of the dashboard heartbeat and the last sign-in. */
  lastActiveAt: string | null
  createdAt: string | null
}

// ── Raw inputs (what the provider reads) ─────────────────────────────────────
export type RawUser = {
  id: string
  email: string
  createdAt: string | null
  lastSignInAt: string | null
  superAdmin: boolean
  twoFactor: boolean | null
}
export type RawProfile = { id: string; name: string; avatarUrl: string | null; lastSeenAt: string | null }
export type RawTenant = { id: string; name: string }
export type RawProject = { id: string; name: string; slug: string; tenantId: string }
export type RawTenantMember = { userId: string; tenantId: string; role: string; extras: string[]; createdAt: string | null }
export type RawProjectMember = { userId: string; projectId: string; role: string; extras: string[]; createdAt: string | null }
export type RawArchive = { userId: string; projectId: string; role: string; extras: string[]; archivedAt: string }
export type RawInvitation = {
  email: string
  scope: 'tenant' | 'project'
  tenantId: string | null
  projectId: string | null
  role: string
  extras: string[]
  createdAt: string
}

export type RawUsersInput = {
  users: RawUser[]
  profiles: RawProfile[]
  tenants: RawTenant[]
  projects: RawProject[]
  tenantMembers: RawTenantMember[]
  projectMembers: RawProjectMember[]
  archives: RawArchive[]
  invitations: RawInvitation[]
}

const STATUS_RANK: Record<PersonStatus, number> = { active: 3, invited: 2, archived: 1, none: 0 }

function overallStatus(superAdmin: boolean, access: PersonAccess[]): PersonStatus {
  if (superAdmin) return 'active'
  return access.reduce<PersonStatus>((best, a) => (STATUS_RANK[a.status] > STATUS_RANK[best] ? a.status : best), 'none')
}

/** Pure: everything the provider read → one row per person, newest activity first. */
export function buildAdminPeople(input: RawUsersInput): AdminPerson[] {
  const tenants = new Map(input.tenants.map((t) => [t.id, t]))
  const projects = new Map(input.projects.map((p) => [p.id, p]))
  const projectsOfTenant = new Map<string, string[]>()
  for (const p of input.projects) projectsOfTenant.set(p.tenantId, [...(projectsOfTenant.get(p.tenantId) ?? []), p.id])
  const profiles = new Map(input.profiles.map((p) => [p.id, p]))
  const byEmail = new Map(input.users.map((u) => [u.email.toLowerCase(), u.id]))

  const access = new Map<string, PersonAccess[]>() // key → access
  const push = (key: string, a: PersonAccess) => {
    const list = access.get(key) ?? []
    // One line per place: an active membership beats an invitation or an archive record.
    const same = list.findIndex((x) => x.scope === a.scope && x.placeId === a.placeId)
    if (same === -1) list.push(a)
    else if (STATUS_RANK[a.status] > STATUS_RANK[list[same].status]) list[same] = a
    access.set(key, list)
  }

  for (const m of input.tenantMembers) {
    const t = tenants.get(m.tenantId)
    push(m.userId, { scope: 'tenant', placeId: m.tenantId, placeName: t?.name ?? '', projectIds: projectsOfTenant.get(m.tenantId) ?? [], role: m.role, extras: m.extras, status: 'active', since: m.createdAt })
  }
  for (const m of input.projectMembers) {
    const p = projects.get(m.projectId)
    push(m.userId, { scope: 'project', placeId: m.projectId, placeName: p?.name ?? '', projectIds: [m.projectId], role: m.role, extras: m.extras, status: 'active', since: m.createdAt })
  }
  for (const a of input.archives) {
    const p = projects.get(a.projectId)
    push(a.userId, { scope: 'project', placeId: a.projectId, placeName: p?.name ?? '', projectIds: [a.projectId], role: a.role, extras: a.extras, status: 'archived', since: a.archivedAt })
  }
  const inviteOnly = new Set<string>()
  for (const i of input.invitations) {
    const email = i.email.toLowerCase()
    const key = byEmail.get(email) ?? `invite:${email}`
    if (!byEmail.has(email)) inviteOnly.add(email)
    const placeId = (i.scope === 'tenant' ? i.tenantId : i.projectId) ?? ''
    const placeName = i.scope === 'tenant' ? (tenants.get(placeId)?.name ?? '') : (projects.get(placeId)?.name ?? '')
    const projectIds = i.scope === 'tenant' ? (projectsOfTenant.get(placeId) ?? []) : [placeId]
    push(key, { scope: i.scope, placeId, placeName, projectIds, role: i.role, extras: i.extras, status: 'invited', since: i.createdAt })
  }

  const people: AdminPerson[] = input.users.map((u) => {
    const prof = profiles.get(u.id)
    const list = sortAccess(access.get(u.id) ?? [])
    return {
      key: u.id,
      userId: u.id,
      name: prof?.name ?? '',
      email: u.email,
      avatarUrl: prof?.avatarUrl ?? null,
      superAdmin: u.superAdmin,
      access: list,
      status: overallStatus(u.superAdmin, list),
      twoFactor: u.twoFactor,
      lastSignInAt: u.lastSignInAt,
      lastActiveAt: lastActiveAt(prof?.lastSeenAt, u.lastSignInAt),
      createdAt: u.createdAt,
    }
  })
  for (const email of inviteOnly) {
    const key = `invite:${email}`
    const list = sortAccess(access.get(key) ?? [])
    people.push({ key, userId: null, name: '', email, avatarUrl: null, superAdmin: false, access: list, status: 'invited', twoFactor: null, lastSignInAt: null, lastActiveAt: null, createdAt: null })
  }
  return people
}

function sortAccess(list: PersonAccess[]): PersonAccess[] {
  return [...list].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.placeName.localeCompare(b.placeName))
}

// ── Filters / sort / summary ────────────────────────────────────────────────
export const USER_STATUS_FILTERS = ['all', 'active', 'invited', 'archived', 'none'] as const
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number]
export const USER_ROLE_FILTERS = ['all', 'superAdmin', 'owner', 'admin', 'editor'] as const
export type UserRoleFilter = (typeof USER_ROLE_FILTERS)[number]
export type UserSortColumn = 'name' | 'lastActive' | 'status'
export type UserFilters = { q: string; project: string; role: UserRoleFilter; status: UserStatusFilter; sort: { column: UserSortColumn; dir: 'asc' | 'desc' } }

export const DEFAULT_USER_FILTERS: UserFilters = { q: '', project: 'all', role: 'all', status: 'all', sort: { column: 'lastActive', dir: 'desc' } }

export function isDefaultUserFilters(f: UserFilters): boolean {
  return !f.q.trim() && f.project === 'all' && f.role === 'all' && f.status === 'all'
}

/** Live (not archived) access only — what filters and the Access column mean by "has access". */
const liveAccess = (p: AdminPerson) => p.access.filter((a) => a.status !== 'archived')

export function applyUserFilters(people: readonly AdminPerson[], f: UserFilters): AdminPerson[] {
  const q = f.q.trim().toLowerCase()
  const out = people.filter((p) => {
    if (q && !`${p.name} ${p.email} ${p.access.map((a) => a.placeName).join(' ')}`.toLowerCase().includes(q)) return false
    if (f.status !== 'all' && p.status !== f.status) return false
    if (f.project !== 'all' && !p.access.some((a) => a.projectIds.includes(f.project))) return false
    if (f.role === 'superAdmin' && !p.superAdmin) return false
    if (f.role !== 'all' && f.role !== 'superAdmin' && !liveAccess(p).some((a) => a.role === f.role)) return false
    return true
  })
  const dir = f.sort.dir === 'asc' ? 1 : -1
  const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0)
  const label = (p: AdminPerson) => (p.name || p.email).toLowerCase()
  return out.sort((a, b) => {
    const by =
      f.sort.column === 'name'
        ? label(a).localeCompare(label(b))
        : f.sort.column === 'status'
          ? STATUS_RANK[a.status] - STATUS_RANK[b.status]
          : time(a.lastActiveAt) - time(b.lastActiveAt)
    return by * dir || label(a).localeCompare(label(b))
  })
}

export function nextUserSort(column: UserSortColumn, current: UserFilters['sort']): UserFilters['sort'] {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'name' ? 'asc' : 'desc' }
}

export type UsersSummary = { activeNow: number; people: number; invitations: number; withoutTwoFactor: number }

/** The four tiles. People = accounts with live access (or Super Admin); invitations = pending invitation lines. */
export function summarizeUsers(people: readonly AdminPerson[], now: number): UsersSummary {
  const withAccess = people.filter((p) => p.userId && p.status === 'active')
  return {
    activeNow: people.filter((p) => isActiveNow(p.lastActiveAt, now)).length,
    people: withAccess.length,
    invitations: people.reduce((n, p) => n + p.access.filter((a) => a.status === 'invited').length, 0),
    withoutTwoFactor: withAccess.filter((p) => p.twoFactor === false).length,
  }
}

/** Who is active now, most recent first. */
export function activeNowPeople(people: readonly AdminPerson[], now: number): AdminPerson[] {
  return people
    .filter((p) => isActiveNow(p.lastActiveAt, now))
    .sort((a, b) => (Date.parse(b.lastActiveAt ?? '') || 0) - (Date.parse(a.lastActiveAt ?? '') || 0))
}

/** The sites a person's live access covers, for the project filter options. */
export function projectOptions(projects: readonly RawProject[]): { id: string; name: string }[] {
  return [...projects].map((p) => ({ id: p.id, name: p.name || p.slug })).sort((a, b) => a.name.localeCompare(b.name))
}

// ── One person's activity ───────────────────────────────────────────────────
export type UserActivityItem = {
  id: string
  at: string
  /** content = something published/archived/… ; access = their access changed ; accessBy = they changed someone's access ; invited / joined / inviteCancelled. */
  kind: 'content' | 'access' | 'accessBy' | 'invited' | 'joined' | 'inviteCancelled'
  place: string
  /** content: lifecycle action; access/accessBy: member.change | member.archive | member.restore. */
  action?: string
  contentType?: string
  outcome?: 'ok' | 'refused' | 'failed'
  role?: string
  /** The other person (who changed their access / whose access they changed). */
  other?: string
  support?: boolean
}

export const ACTIVITY_LIMIT = 50

/** Pure: newest first, capped. Exported for tests. */
export function mergeActivity(items: UserActivityItem[], limit = ACTIVITY_LIMIT): UserActivityItem[] {
  return [...items].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)).slice(0, limit)
}

