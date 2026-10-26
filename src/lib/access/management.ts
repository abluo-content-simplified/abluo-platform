/**
 * Site Access — the management plane (ADR-040 §8). Server-only.
 *
 * Who may manage a project's access is a DASHBOARD question, answered by the
 * existing permission system (ADR-028): `authorizeAccessManagement()` runs
 * `assertModuleAction()` — the module must be installed for the project and
 * the caller must hold `members.access.read` / `.manage` there. It returns an
 * `AccessManagementGrant` bound to ONE project; every function below takes
 * that grant instead of a project id, so a caller cannot authorise on project
 * A and then act on project B.
 *
 * A visitor session can never produce such a grant: it has no Supabase Auth
 * user and no TenantAuthorizationContext. Holding a shared password therefore
 * never grants any CMS permission.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { ACCESS_LIMITS, ACCESS_PERMISSIONS, AccessError, isUuid } from './model'
import { checkNewPassword, hashPassword, verifyPassword, type PasswordProblem } from './password'
import type { CredentialRow, GroupRow, LocalizedName, SessionSummary, SiteAccessStore } from './store'
import type { AccessEnvironment } from './environment'

declare const GRANT: unique symbol
export type AccessManagementGrant = {
  readonly projectId: string
  readonly actorUserId: string
  readonly level: 'read' | 'manage'
  readonly [GRANT]: true
}

/** Throws TenantAuthorizationError (from assertModuleAction) when refused. */
export function authorizeAccessManagement(
  ctx: TenantAuthorizationContext,
  projectId: string,
  level: 'read' | 'manage',
  deps: { permissionOwnerMap?: Record<string, string> } = {}
): AccessManagementGrant {
  assertModuleAction(ctx, projectId, level === 'manage' ? ACCESS_PERMISSIONS.manage : ACCESS_PERMISSIONS.read, deps)
  return Object.freeze({ projectId, actorUserId: ctx.userId, level }) as AccessManagementGrant
}

function requireManage(grant: AccessManagementGrant): void {
  if (grant?.level !== 'manage' || !isUuid(grant.projectId)) throw new AccessError('invalid_input', 'manage grant required')
}
function requireRead(grant: AccessManagementGrant): void {
  if ((grant?.level !== 'read' && grant?.level !== 'manage') || !isUuid(grant.projectId)) throw new AccessError('invalid_input', 'grant required')
}

// ── Validation ────────────────────────────────────────────────────────────────

const LOCALE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/

/** A localized name: at least one language, each 1–80 characters after trimming. */
export function normalizeLocalizedName(value: unknown): LocalizedName {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccessError('invalid_input', 'name')
  const out: LocalizedName = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!LOCALE_KEY.test(k) || typeof v !== 'string') throw new AccessError('invalid_input', 'name')
    const t = v.trim()
    if (t.length === 0) continue
    if ([...t].length > ACCESS_LIMITS.groupNameMax) throw new AccessError('invalid_input', 'name_too_long')
    out[k] = t
  }
  if (Object.keys(out).length === 0) throw new AccessError('invalid_input', 'name')
  return out
}

function normalizeLabel(value: unknown): string {
  const t = typeof value === 'string' ? value.trim() : ''
  if (t.length === 0 || [...t].length > ACCESS_LIMITS.labelMax) throw new AccessError('invalid_input', 'label')
  return t
}

/** Only live (not archived) groups of THIS project may be assigned. */
async function liveGroupIds(store: SiteAccessStore, projectId: string, requested: unknown): Promise<string[]> {
  if (!Array.isArray(requested)) throw new AccessError('invalid_input', 'groups')
  const ids = [...new Set(requested)]
  if (!ids.every(isUuid)) throw new AccessError('invalid_input', 'groups')
  const live = new Set((await store.listGroups(projectId)).filter((g) => !g.archivedAt).map((g) => g.id.toLowerCase()))
  const norm = ids.map((g) => (g as string).toLowerCase())
  if (!norm.every((g) => live.has(g))) throw new AccessError('invalid_input', 'unknown_group')
  return norm.sort()
}

export class PasswordRejected extends AccessError {
  constructor(public readonly problem: PasswordProblem | 'duplicate') {
    super('invalid_input', `password_${problem}`)
  }
}

/** A shared password must differ from every other password of the project (unambiguous rotation). */
async function assertPasswordUnique(store: SiteAccessStore, projectId: string, password: string, exceptCredentialId?: string) {
  const others = (await store.candidateCredentials(projectId, null)).filter((c) => c.credentialId !== exceptCredentialId)
  for (const c of others) {
    if (await verifyPassword(password, c.passwordHash)) throw new PasswordRejected('duplicate')
  }
}

// ── Groups ────────────────────────────────────────────────────────────────────

export async function listGroups(store: SiteAccessStore, grant: AccessManagementGrant): Promise<GroupRow[]> {
  requireRead(grant)
  return store.listGroups(grant.projectId)
}

export async function createGroup(store: SiteAccessStore, grant: AccessManagementGrant, input: { name: unknown; description?: unknown }): Promise<string> {
  requireManage(grant)
  const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 500) : null
  return store.createGroup(grant.projectId, { name: normalizeLocalizedName(input.name), description }, grant.actorUserId)
}

export async function renameGroup(store: SiteAccessStore, grant: AccessManagementGrant, groupId: unknown, name: unknown): Promise<void> {
  requireManage(grant)
  if (!isUuid(groupId)) throw new AccessError('invalid_input', 'group')
  await store.updateGroup(grant.projectId, groupId, { name: normalizeLocalizedName(name) }, grant.actorUserId)
}

/** Archiving takes effect on the next request: the group stops opening anything. Never deleted. */
export async function setGroupArchived(store: SiteAccessStore, grant: AccessManagementGrant, groupId: unknown, archived: boolean): Promise<void> {
  requireManage(grant)
  if (!isUuid(groupId)) throw new AccessError('invalid_input', 'group')
  await store.setGroupArchived(grant.projectId, groupId, archived, grant.actorUserId)
}

// ── Shared passwords ──────────────────────────────────────────────────────────

export async function listSharedPasswords(store: SiteAccessStore, grant: AccessManagementGrant): Promise<CredentialRow[]> {
  requireRead(grant)
  return store.listCredentials(grant.projectId)
}

export async function createSharedPassword(
  store: SiteAccessStore,
  grant: AccessManagementGrant,
  input: { label: unknown; password: unknown; groupIds: unknown; expiresAt?: string | null }
): Promise<string> {
  requireManage(grant)
  const label = normalizeLabel(input.label)
  const password = typeof input.password === 'string' ? input.password : ''
  const problem = checkNewPassword(password)
  if (problem) throw new PasswordRejected(problem)
  const groupIds = await liveGroupIds(store, grant.projectId, input.groupIds)
  if (groupIds.length === 0) throw new AccessError('invalid_input', 'groups')
  await assertPasswordUnique(store, grant.projectId, password)
  return store.createCredential(grant.projectId, { label, passwordHash: await hashPassword(password), groupIds, expiresAt: input.expiresAt ?? null }, grant.actorUserId)
}

/** New password; everyone who signed in with the old one is signed out. Returns sessions revoked. */
export async function rotateSharedPassword(store: SiteAccessStore, grant: AccessManagementGrant, credentialId: unknown, password: unknown): Promise<number> {
  requireManage(grant)
  if (!isUuid(credentialId)) throw new AccessError('invalid_input', 'credential')
  const pw = typeof password === 'string' ? password : ''
  const problem = checkNewPassword(pw)
  if (problem) throw new PasswordRejected(problem)
  await assertPasswordUnique(store, grant.projectId, pw, credentialId)
  return store.rotateCredential(grant.projectId, credentialId, await hashPassword(pw), grant.actorUserId)
}

export async function setSharedPasswordGroups(store: SiteAccessStore, grant: AccessManagementGrant, credentialId: unknown, groupIds: unknown): Promise<void> {
  requireManage(grant)
  if (!isUuid(credentialId)) throw new AccessError('invalid_input', 'credential')
  const ids = await liveGroupIds(store, grant.projectId, groupIds)
  if (ids.length === 0) throw new AccessError('invalid_input', 'groups')
  await store.setCredentialGroups(grant.projectId, credentialId, ids, grant.actorUserId)
}

/** Disabling signs out everyone who used it; re-enabling does not bring them back. */
export async function setSharedPasswordDisabled(store: SiteAccessStore, grant: AccessManagementGrant, credentialId: unknown, disabled: boolean): Promise<number> {
  requireManage(grant)
  if (!isUuid(credentialId)) throw new AccessError('invalid_input', 'credential')
  return store.setCredentialDisabled(grant.projectId, credentialId, disabled, grant.actorUserId)
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function revokeVisitorSession(store: SiteAccessStore, grant: AccessManagementGrant, sessionId: unknown): Promise<number> {
  requireManage(grant)
  if (!isUuid(sessionId)) throw new AccessError('invalid_input', 'session')
  return store.revokeSessions(grant.projectId, sessionId, 'revoked_by_admin', grant.actorUserId)
}

/** "Sign out everyone" for the project. */
export async function revokeAllVisitorSessions(store: SiteAccessStore, grant: AccessManagementGrant): Promise<number> {
  requireManage(grant)
  return store.revokeSessions(grant.projectId, null, 'revoked_all', grant.actorUserId)
}

/** How many visitors are signed in now, per group and in total — counts only (B2.5, migration 053). */
export async function getSignedInSummary(store: SiteAccessStore, grant: AccessManagementGrant, environment: AccessEnvironment): Promise<SessionSummary> {
  requireRead(grant)
  return store.sessionSummary(grant.projectId, environment)
}

// ── The dashboard's group-first flow (B2.5) ───────────────────────────────────
//
// Tenant administrators think "a group has a password". The model keeps
// passwords (credentials) separate so one password can open several groups;
// the dashboard creates one password per group, labelled with the group's
// name, and changes it in place. Passwords Abluo created another way still
// show and can be changed.

/** Checks the password BEFORE anything is written, so a refused password never leaves a half-made group. */
async function acceptablePassword(store: SiteAccessStore, projectId: string, password: unknown, exceptCredentialId?: string): Promise<string> {
  const pw = typeof password === 'string' ? password : ''
  const problem = checkNewPassword(pw)
  if (problem) throw new PasswordRejected(problem)
  await assertPasswordUnique(store, projectId, pw, exceptCredentialId)
  return pw
}

export async function createGroupWithPassword(
  store: SiteAccessStore,
  grant: AccessManagementGrant,
  input: { name: unknown; password: unknown }
): Promise<{ groupId: string }> {
  requireManage(grant)
  const name = normalizeLocalizedName(input.name)
  const password = await acceptablePassword(store, grant.projectId, input.password)
  const groupId = await store.createGroup(grant.projectId, { name, description: null }, grant.actorUserId)
  const label = [...Object.values(name)[0]].slice(0, ACCESS_LIMITS.labelMax).join('')
  await store.createCredential(grant.projectId, { label, passwordHash: await hashPassword(password), groupIds: [groupId], expiresAt: null }, grant.actorUserId)
  return { groupId }
}

/**
 * Sets a group's password. With `credentialId` (a password of THIS group) it
 * is changed and everyone signed in with the old one is signed out; without,
 * a new password is created for the group (it had none in use). Returns how
 * many visitors were signed out.
 */
export async function setGroupPassword(
  store: SiteAccessStore,
  grant: AccessManagementGrant,
  input: { groupId: unknown; credentialId?: unknown; password: unknown }
): Promise<{ signedOut: number }> {
  requireManage(grant)
  if (!isUuid(input.groupId)) throw new AccessError('invalid_input', 'group')
  const groupId = input.groupId.toLowerCase()
  const group = (await store.listGroups(grant.projectId)).find((g) => g.id.toLowerCase() === groupId)
  if (!group) throw new AccessError('not_found', 'group')
  if (group.archivedAt) throw new AccessError('invalid_input', 'group_archived')
  if (input.credentialId !== undefined && input.credentialId !== null) {
    if (!isUuid(input.credentialId)) throw new AccessError('invalid_input', 'credential')
    const credentialId = input.credentialId
    const cred = (await store.listCredentials(grant.projectId)).find((c) => c.id === credentialId)
    if (!cred || !cred.groupIds.map((g) => g.toLowerCase()).includes(groupId)) throw new AccessError('not_found', 'credential')
    const password = await acceptablePassword(store, grant.projectId, input.password, credentialId)
    return { signedOut: await store.rotateCredential(grant.projectId, credentialId, await hashPassword(password), grant.actorUserId) }
  }
  const password = await acceptablePassword(store, grant.projectId, input.password)
  const label = [...(Object.values(group.name)[0] ?? 'Password')].slice(0, ACCESS_LIMITS.labelMax).join('')
  await store.createCredential(grant.projectId, { label, passwordHash: await hashPassword(password), groupIds: [groupId], expiresAt: null }, grant.actorUserId)
  return { signedOut: 0 }
}

// Documents (who can open them, files, pages) moved to the Documents module:
// see ./documents.ts (ADR-040 §15, R9).
