import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { ACCESS_MODULE_ID, ACCESS_PERMISSIONS, AccessError } from '../model'
import {
  authorizeAccessManagement, createGroup, createSharedPassword, listSharedPasswords, normalizeLocalizedName,
  PasswordRejected, renameGroup, revokeAllVisitorSessions, rotateSharedPassword, setGroupArchived,
  setSharedPasswordDisabled, setSharedPasswordGroups, type AccessManagementGrant,
} from '../management'
import { resolveVisitor, unlockWithPassword } from '../visitor'
import { createFakeStore, type FakeStore } from './fake-store'

const A = randomUUID(), B = randomUUID()
const OWNERS = { [ACCESS_PERMISSIONS.read]: ACCESS_MODULE_ID, [ACCESS_PERMISSIONS.manage]: ACCESS_MODULE_ID }
const grantOn = (projectId: string, permissions: string[], modules = [ACCESS_MODULE_ID]): ProjectGrant => ({
  projectId, projectSlug: asSupabaseProjectSlug('cyce'), membershipId: 'm', role: 'admin', permissions, enabledModuleIds: modules,
})
const ctx = (...projects: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u-admin', platformRole: 'tenant_user', projects })
const ALL = [ACCESS_PERMISSIONS.read, ACCESS_PERMISSIONS.manage]

let store: FakeStore
let manage: AccessManagementGrant
beforeEach(() => {
  store = createFakeStore()
  manage = authorizeAccessManagement(ctx(grantOn(A, ALL)), A, 'manage', { permissionOwnerMap: OWNERS })
})

describe('who may manage — the dashboard permission system, never a visitor session', () => {
  it('needs a grant on THAT project', () => {
    expect(() => authorizeAccessManagement(ctx(grantOn(A, ALL)), B, 'manage', { permissionOwnerMap: OWNERS })).toThrow(/no ProjectGrant/)
  })
  it('needs the module installed on the project', () => {
    expect(() => authorizeAccessManagement(ctx(grantOn(A, ALL, ['blog'])), A, 'manage', { permissionOwnerMap: OWNERS })).toThrow(/not installed/)
  })
  it('needs members.access.manage to manage; read is not enough', () => {
    expect(() => authorizeAccessManagement(ctx(grantOn(A, [ACCESS_PERMISSIONS.read])), A, 'manage', { permissionOwnerMap: OWNERS })).toThrow(/does not grant/)
    const read = authorizeAccessManagement(ctx(grantOn(A, [ACCESS_PERMISSIONS.read])), A, 'read', { permissionOwnerMap: OWNERS })
    return expect(createGroup(store, read, { name: { en: 'X' } })).rejects.toBeInstanceOf(AccessError)
  })
  it('a hand-made grant object is refused', async () => {
    const fake = { projectId: 'not-a-uuid', actorUserId: 'x', level: 'manage' } as unknown as AccessManagementGrant
    await expect(createGroup(store, fake, { name: { en: 'X' } })).rejects.toBeInstanceOf(AccessError)
  })
  it('the grant is bound to its project: everything it creates lands on that project only', async () => {
    const gid = await createGroup(store, manage, { name: { en: 'Members' } })
    expect(store.groups.find((g) => g.id === gid)?.projectId).toBe(A)
  })
})

describe('groups', () => {
  it('localized names: trimmed, at least one language, ≤ 80 chars, locale keys only', () => {
    expect(normalizeLocalizedName({ en: '  Members ', fr: 'Membres', de: '' })).toEqual({ en: 'Members', fr: 'Membres' })
    for (const bad of [{}, { en: '  ' }, { english: 'x' }, { en: 'x'.repeat(81) }, 'Members', null, ['x']]) {
      expect(() => normalizeLocalizedName(bad)).toThrow(AccessError)
    }
  })
  it('create, rename, archive (never delete)', async () => {
    const id = await createGroup(store, manage, { name: { en: 'Teachers' } })
    await renameGroup(store, manage, id, { en: 'Instructors', fr: 'Enseignants' })
    await setGroupArchived(store, manage, id, true)
    const g = store.groups.find((x) => x.id === id)!
    expect(g.name).toEqual({ en: 'Instructors', fr: 'Enseignants' })
    expect(g.archivedAt).not.toBeNull()
  })
  it('cannot rename another project\'s group with this project\'s grant', async () => {
    const other = randomUUID()
    store.groups.push({ id: other, projectId: B, name: { en: 'B' }, description: null, sortOrder: 0, archivedAt: null })
    await expect(renameGroup(store, manage, other, { en: 'Hijacked' })).rejects.toMatchObject({ code: 'not_found' })
    expect(store.groups.find((g) => g.id === other)?.name).toEqual({ en: 'B' })
  })
})

describe('shared passwords', () => {
  let members: string, teachers: string
  beforeEach(async () => {
    members = await createGroup(store, manage, { name: { en: 'Members' } })
    teachers = await createGroup(store, manage, { name: { en: 'Teachers' } })
  })

  it('created with one or more live groups of the project; the hash is never listed', async () => {
    const id = await createSharedPassword(store, manage, { label: 'Teachers 2026', password: 'teachers-pass-2026', groupIds: [teachers, members] })
    const list = await listSharedPasswords(store, manage)
    expect(list).toEqual([expect.objectContaining({ id, label: 'Teachers 2026', secretVersion: 1, groupIds: [members, teachers].sort() })])
    expect(JSON.stringify(list)).not.toContain('scrypt')
  })

  it('refuses: no groups, an archived group, another project\'s group, a made-up id', async () => {
    const otherProjectGroup = randomUUID()
    store.groups.push({ id: otherProjectGroup, projectId: B, name: { en: 'B' }, description: null, sortOrder: 0, archivedAt: null })
    await setGroupArchived(store, manage, teachers, true)
    for (const groupIds of [[], [teachers], [otherProjectGroup], [randomUUID()], ['members'], 'x']) {
      await expect(createSharedPassword(store, manage, { label: 'L', password: 'good-password-1', groupIds })).rejects.toBeInstanceOf(AccessError)
    }
    expect(store.creds).toHaveLength(0)
  })

  it('refuses weak or duplicate passwords (a duplicate would make rotation ambiguous)', async () => {
    await createSharedPassword(store, manage, { label: 'M', password: 'members-pass-2026', groupIds: [members] })
    await expect(createSharedPassword(store, manage, { label: 'T', password: 'short', groupIds: [teachers] })).rejects.toMatchObject({ problem: 'too_short' })
    await expect(createSharedPassword(store, manage, { label: 'T', password: 'members-pass-2026', groupIds: [teachers] })).rejects.toBeInstanceOf(PasswordRejected)
  })

  it('rotation on demand signs out its sessions and the new password works', async () => {
    const id = await createSharedPassword(store, manage, { label: 'M', password: 'members-pass-2026', groupIds: [members] })
    const u = await unlockWithPassword({ store, environment: 'production', projectId: A, password: 'members-pass-2026', currentToken: null, ip: '1.2.3.4', ipSalt: 'salt-salt-salt-salt', forGroupIds: null })
    if (!u.ok) throw new Error('unlock failed')
    expect(await rotateSharedPassword(store, manage, id, 'members-pass-2027')).toBe(1)
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: u.token })).toBeNull()
    expect(store.events.map((e) => e.action)).toContain('credential_rotated')
  })

  it('rotating to another password of the project is refused; rotating with B\'s id does nothing', async () => {
    const m = await createSharedPassword(store, manage, { label: 'M', password: 'members-pass-2026', groupIds: [members] })
    await createSharedPassword(store, manage, { label: 'T', password: 'teachers-pass-2026', groupIds: [teachers] })
    await expect(rotateSharedPassword(store, manage, m, 'teachers-pass-2026')).rejects.toBeInstanceOf(PasswordRejected)
    const bCred = randomUUID()
    await expect(rotateSharedPassword(store, manage, bCred, 'whatever-pass-1')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('changing groups and disabling', async () => {
    const id = await createSharedPassword(store, manage, { label: 'T', password: 'teachers-pass-2026', groupIds: [teachers] })
    await setSharedPasswordGroups(store, manage, id, [teachers, members])
    expect(store.creds[0].groupIds.sort()).toEqual([members, teachers].sort())
    await expect(setSharedPasswordGroups(store, manage, id, [])).rejects.toBeInstanceOf(AccessError)
    await setSharedPasswordDisabled(store, manage, id, true)
    expect(store.creds[0].disabledAt).not.toBeNull()
  })

  it('sign out everyone affects this project only', async () => {
    await createSharedPassword(store, manage, { label: 'M', password: 'members-pass-2026', groupIds: [members] })
    const u = await unlockWithPassword({ store, environment: 'production', projectId: A, password: 'members-pass-2026', currentToken: null, ip: '1.2.3.4', ipSalt: 'salt-salt-salt-salt', forGroupIds: null })
    if (!u.ok) throw new Error('unlock failed')
    store.sessions.push({ id: randomUUID(), projectId: B, environment: 'production', tokenHash: 'b'.repeat(64), expiresAt: Date.now() + 1e6, revokedAt: null, revokedReason: null, grants: new Map() })
    expect(await revokeAllVisitorSessions(store, manage)).toBe(1)
    expect(store.sessions.find((s) => s.projectId === B)?.revokedAt).toBeNull()
  })
})
