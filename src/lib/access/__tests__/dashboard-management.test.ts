/**
 * ADR-040 B2.5 — the dashboard's group-first flow on the management plane:
 * a group is created WITH its password (checked before anything is written),
 * a group's password is changed in place (signing out who used the old one) or
 * set when it had none, and the signed-in counts. Tenant isolation, read-only
 * grants and destructive outcomes are covered for each.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID, createHash } from 'crypto'
import { AccessError } from '../model'
import {
  createGroupWithPassword, getSignedInSummary, listGroups, listSharedPasswords, PasswordRejected,
  revokeAllVisitorSessions, setGroupArchived, setGroupPassword, type AccessManagementGrant,
} from '../management'
import { verifyPassword } from '../password'
import { createFakeStore, type FakeStore } from './fake-store'

const A = randomUUID(), B = randomUUID()
const grant = (projectId: string, level: 'read' | 'manage' = 'manage') => Object.freeze({ projectId, actorUserId: randomUUID(), level }) as unknown as AccessManagementGrant
const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex')

let store: FakeStore
beforeEach(() => {
  store = createFakeStore()
})

/** A visitor signs in with the group's current password (what the unlock route does). */
async function signIn(projectId: string, credentialId: string, env: 'production' | 'preview' = 'production') {
  const c = store.creds.find((x) => x.id === credentialId)!
  return store.unlock({ projectId, environment: env, credentialId, credentialVersion: c.version, currentTokenHash: null, newTokenHash: tokenHash(), sessionSeconds: 3600, attemptId: null, deviceLabel: null })
}

describe('createGroupWithPassword', () => {
  it('creates the group and one password for it, labelled with the group name; never stores the password itself', async () => {
    const { groupId } = await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    const creds = await listSharedPasswords(store, grant(A, 'read'))
    expect(creds).toHaveLength(1)
    expect(creds[0]).toMatchObject({ label: 'Parents', groupIds: [groupId] })
    expect(JSON.stringify(creds)).not.toContain('kitchen-table-7')
    expect(Object.keys(creds[0])).not.toContain('passwordHash')
    expect(await verifyPassword('kitchen-table-7', store.creds[0].hash)).toBe(true)
  })

  it('a refused password creates nothing — no half-made group', async () => {
    await expect(createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'short' })).rejects.toBeInstanceOf(PasswordRejected)
    expect(store.groups).toHaveLength(0)
    await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    const e = await createGroupWithPassword(store, grant(A), { name: { en: 'Board' }, password: 'kitchen-table-7' }).catch((x) => x)
    expect(e).toBeInstanceOf(PasswordRejected)
    expect((e as PasswordRejected).problem).toBe('duplicate')
    expect(store.groups).toHaveLength(1)
  })

  it('the same password may be used by another site (uniqueness is per project)', async () => {
    await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    await expect(createGroupWithPassword(store, grant(B), { name: { en: 'Parents' }, password: 'kitchen-table-7' })).resolves.toBeTruthy()
  })

  it('a read grant cannot create; a name is required', async () => {
    await expect(createGroupWithPassword(store, grant(A, 'read'), { name: { en: 'X' }, password: 'kitchen-table-7' })).rejects.toThrow(AccessError)
    await expect(createGroupWithPassword(store, grant(A), { name: { en: '  ' }, password: 'kitchen-table-7' })).rejects.toThrow(/name/)
    expect(store.groups).toHaveLength(0)
  })
})

describe('setGroupPassword', () => {
  let groupId: string, credId: string
  beforeEach(async () => {
    ;({ groupId } = await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' }))
    credId = store.creds[0].id
  })

  it('changing the password signs out exactly the visitors who used the old one and says how many', async () => {
    await signIn(A, credId); await signIn(A, credId)
    const other = await createGroupWithPassword(store, grant(A), { name: { en: 'Board' }, password: 'garden-gate-42' })
    await signIn(A, store.creds.find((c) => c.groupIds.includes(other.groupId))!.id)
    expect((await getSignedInSummary(store, grant(A, 'read'), 'production')).total).toBe(3)

    const r = await setGroupPassword(store, grant(A), { groupId, credentialId: credId, password: 'new-password-99' })
    expect(r.signedOut).toBe(2)
    const after = await getSignedInSummary(store, grant(A, 'read'), 'production')
    expect(after.total).toBe(1)
    expect(after.byGroup[groupId]).toBeUndefined()
    expect(await verifyPassword('new-password-99', store.creds.find((c) => c.id === credId)!.hash)).toBe(true)
  })

  it('a group without a password in use gets a new one; nobody is signed out', async () => {
    await store.setCredentialDisabled(A, credId, true, 'x')
    const r = await setGroupPassword(store, grant(A), { groupId, password: 'brand-new-pass-1' })
    expect(r.signedOut).toBe(0)
    expect(store.creds.filter((c) => c.groupIds.includes(groupId))).toHaveLength(2)
  })

  it('refuses a password of ANOTHER group, another project\'s group, an archived group and a read grant', async () => {
    const other = await createGroupWithPassword(store, grant(A), { name: { en: 'Board' }, password: 'garden-gate-42' })
    const otherCred = store.creds.find((c) => c.groupIds.includes(other.groupId))!.id
    await expect(setGroupPassword(store, grant(A), { groupId, credentialId: otherCred, password: 'new-password-99' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(setGroupPassword(store, grant(B), { groupId, credentialId: credId, password: 'new-password-99' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(setGroupPassword(store, grant(A, 'read'), { groupId, credentialId: credId, password: 'new-password-99' })).rejects.toThrow(AccessError)
    await setGroupArchived(store, grant(A), groupId, true)
    await expect(setGroupPassword(store, grant(A), { groupId, credentialId: credId, password: 'new-password-99' })).rejects.toThrow(/archived/)
    expect(await verifyPassword('kitchen-table-7', store.creds.find((c) => c.id === credId)!.hash)).toBe(true)
  })

  it('refuses a password already used by another group of the site, and a too-short one', async () => {
    await createGroupWithPassword(store, grant(A), { name: { en: 'Board' }, password: 'garden-gate-42' })
    await expect(setGroupPassword(store, grant(A), { groupId, credentialId: credId, password: 'garden-gate-42' })).rejects.toMatchObject({ problem: 'duplicate' })
    await expect(setGroupPassword(store, grant(A), { groupId, credentialId: credId, password: 'short' })).rejects.toMatchObject({ problem: 'too_short' })
  })

  it('keeping the same password is allowed (it is not a duplicate of itself)', async () => {
    await expect(setGroupPassword(store, grant(A), { groupId, credentialId: credId, password: 'kitchen-table-7' })).resolves.toMatchObject({ signedOut: 0 })
  })
})

describe('signed-in summary and "Sign out everyone"', () => {
  it('counts only this project and this environment; sign out everyone empties it', async () => {
    const a = await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    const b = await createGroupWithPassword(store, grant(B), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    const ca = store.creds.find((c) => c.groupIds.includes(a.groupId))!.id
    const cb = store.creds.find((c) => c.groupIds.includes(b.groupId))!.id
    await signIn(A, ca); await signIn(A, ca, 'preview'); await signIn(B, cb)
    expect(await getSignedInSummary(store, grant(A, 'read'), 'production')).toEqual({ total: 1, byGroup: { [a.groupId]: 1 } })
    expect(await revokeAllVisitorSessions(store, grant(A))).toBe(2) // both environments of A
    expect((await getSignedInSummary(store, grant(A, 'read'), 'production')).total).toBe(0)
    expect((await getSignedInSummary(store, grant(B, 'read'), 'production')).total).toBe(1)
  })

  it('an archived group stops counting (it opens nothing any more)', async () => {
    const { groupId } = await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    await signIn(A, store.creds[0].id)
    await setGroupArchived(store, grant(A), groupId, true)
    expect((await getSignedInSummary(store, grant(A, 'read'), 'production')).total).toBe(0)
  })

  it('sign out everyone needs a manage grant', async () => {
    await expect(revokeAllVisitorSessions(store, grant(A, 'read'))).rejects.toThrow(AccessError)
  })

  it('lists never cross projects', async () => {
    await createGroupWithPassword(store, grant(A), { name: { en: 'Parents' }, password: 'kitchen-table-7' })
    expect(await listGroups(store, grant(B, 'read'))).toEqual([])
    expect(await listSharedPasswords(store, grant(B, 'read'))).toEqual([])
  })
})
