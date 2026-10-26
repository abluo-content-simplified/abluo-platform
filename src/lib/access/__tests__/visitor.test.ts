import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { hashPassword } from '../password'
import { AccessError } from '../model'
import { evaluateAccess, parseAccessPolicy } from '../policy'
import { hashIp, RATE_LIMITS } from '../rate-limit'
import { generateSessionToken, hashSessionToken } from '../session-token'
import { logout, resolveVisitor, unlockWithPassword } from '../visitor'
import { createFakeStore, type FakeStore } from './fake-store'

const A = randomUUID(), B = randomUUID()
const SALT = 'test-salt-test-salt-test'
let store: FakeStore
let g: Record<string, string>
let pw: Record<string, string>

async function addGroup(projectId: string, name: string) {
  const id = randomUUID()
  store.groups.push({ id, projectId, name: { en: name }, description: null, sortOrder: 0, archivedAt: null })
  return id
}
async function addCred(projectId: string, password: string, groupIds: string[]) {
  return store.createCredential(projectId, { label: password, passwordHash: await hashPassword(password), groupIds, expiresAt: null }, 'actor')
}
const unlock = (projectId: string, password: string, currentToken: string | null = null, extra: Partial<Parameters<typeof unlockWithPassword>[0]> = {}) =>
  unlockWithPassword({ store, projectId, environment: 'production', password, currentToken, ip: '203.0.113.7', ipSalt: SALT, forGroupIds: null, ...extra })
const groupsOf = async (projectId: string, token: string) => [...((await resolveVisitor({ store, environment: 'production', projectId, token }))?.groupIds ?? [])].sort()

beforeEach(async () => {
  store = createFakeStore()
  g = { members: await addGroup(A, 'Members'), teachers: await addGroup(A, 'Teachers'), staff: await addGroup(A, 'Staff'), bMembers: await addGroup(B, 'Members') }
  pw = {
    members: await addCred(A, 'members-pass-2026', [g.members]),
    teachers: await addCred(A, 'teachers-pass-2026', [g.teachers, g.members]),
    staff: await addCred(A, 'staff-pass-2026!', [g.staff]),
    b: await addCred(B, 'other-site-pass-1', [g.bMembers]),
  }
})

describe('unlock → resolve', () => {
  it('the right password returns a fresh token whose session holds the credential\'s groups', async () => {
    const r = await unlock(A, 'teachers-pass-2026')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await groupsOf(A, r.token)).toEqual([g.members, g.teachers].sort())
    // only the hash is stored
    expect(store.sessions.some((s) => s.tokenHash === r.token)).toBe(false)
    expect(store.sessions.some((s) => s.tokenHash === hashSessionToken(r.token))).toBe(true)
  })

  it('typing a second password adds its groups (OR across credentials) and rotates the token', async () => {
    const first = await unlock(A, 'members-pass-2026')
    if (!first.ok) throw new Error('unlock failed')
    const second = await unlock(A, 'staff-pass-2026!', first.token)
    if (!second.ok) throw new Error('unlock failed')
    expect(second.token).not.toBe(first.token)
    expect(second.sessionId).toBe(first.sessionId)
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: first.token })).toBeNull()   // old token dead (fixation)
    expect(await groupsOf(A, second.token)).toEqual([g.members, g.staff].sort())
  })

  it('a planted token from someone else is never adopted: no valid session for it → a new one', async () => {
    const planted = generateSessionToken()
    const r = await unlock(A, 'members-pass-2026', planted)
    if (!r.ok) throw new Error('unlock failed')
    expect(r.token).not.toBe(planted)
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: planted })).toBeNull()
  })

  it('wrong password → wrong_password, a failure is recorded, no session', async () => {
    expect(await unlock(A, 'members-pass-2025')).toEqual({ ok: false, code: 'wrong_password' })
    expect(store.attempts.filter((a) => a.succeeded === false)).toHaveLength(1)
    expect(store.attempts.filter((a) => a.succeeded === null)).toHaveLength(0)
    expect(store.sessions).toHaveLength(0)
  })

  it('non-string, empty and over-long passwords are wrong passwords, not errors', async () => {
    for (const p of [undefined, 42, '', 'x'.repeat(10_000)]) {
      expect((await unlockWithPassword({ store, environment: 'production', projectId: A, password: p, currentToken: null, ip: '1.1.1.1', ipSalt: SALT, forGroupIds: null })).ok).toBe(false)
    }
  })
})

describe('tenant isolation on the visitor plane', () => {
  it('another project\'s password does not open this project', async () => {
    expect(await unlock(A, 'other-site-pass-1')).toEqual({ ok: false, code: 'wrong_password' })
  })
  it('a token of project A is nothing on project B (shared preview host replay)', async () => {
    const r = await unlock(A, 'members-pass-2026')
    if (!r.ok) throw new Error('unlock failed')
    expect(await resolveVisitor({ store, environment: 'production', projectId: B, token: r.token })).toBeNull()
  })
  it('presenting A\'s token while unlocking B neither extends nor reuses A\'s session', async () => {
    const a = await unlock(A, 'members-pass-2026')
    if (!a.ok) throw new Error('unlock failed')
    const b = await unlock(B, 'other-site-pass-1', a.token)
    if (!b.ok) throw new Error('unlock failed')
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(await groupsOf(A, a.token)).toEqual([g.members])
  })
  it('a page on A restricted to B\'s group id stays closed even for B\'s members', async () => {
    const r = await unlock(B, 'other-site-pass-1')
    if (!r.ok) throw new Error('unlock failed')
    const visitorOnA = await resolveVisitor({ store, environment: 'production', projectId: A, token: r.token })
    const chain = [parseAccessPolicy({ visibility: 'restricted', groups: [g.bMembers] })]
    expect(evaluateAccess({ chain, visitor: visitorOnA, moduleEnabled: true }).allowed).toBe(false)
  })
})

describe('narrowing the prompt to the resource', () => {
  it('only passwords that help with the resource are tried', async () => {
    expect((await unlock(A, 'staff-pass-2026!', null, { forGroupIds: [g.teachers] })).ok).toBe(false)
    expect((await unlock(A, 'teachers-pass-2026', null, { forGroupIds: [g.teachers] })).ok).toBe(true)
    expect((await unlock(A, 'teachers-pass-2026', null, { forGroupIds: [g.members] })).ok).toBe(true)  // teachers open Members too
  })
})

describe('rate limiting', () => {
  it('after 5 failures the 6th attempt is refused without checking any password', async () => {
    for (let i = 0; i < 5; i++) await unlock(A, `wrong-guess-${i}xx`)
    store.calls.length = 0
    const r = await unlock(A, 'members-pass-2026')
    expect(r).toEqual({ ok: false, code: 'too_many_attempts', retryAfterSeconds: 900 })
    expect(store.calls).not.toContain('candidateCredentials')
    expect(store.attempts).toHaveLength(5)   // a refused attempt writes nothing
  })
  it('a guessing storm from other IPs does not lock out a member from a fresh IP', async () => {
    for (let i = 0; i < 60; i++) {
      await unlockWithPassword({ store, environment: 'production', projectId: A, password: `bad-guess-${i}`, currentToken: null, ip: `198.51.100.${i}`, ipSalt: SALT, forGroupIds: null })
    }
    const r = await unlockWithPassword({ store, environment: 'production', projectId: A, password: 'members-pass-2026', currentToken: null, ip: '192.0.2.44', ipSalt: SALT, forGroupIds: null })
    expect(r.ok).toBe(true)
  }, 30_000)
  it('failures on project B do not count against project A for the same IP', async () => {
    for (let i = 0; i < 5; i++) await unlock(B, `wrong-guess-${i}xx`)
    expect((await unlock(A, 'members-pass-2026')).ok).toBe(true)
  })
  it('signed-in visitors are never rate-limited: resolve does not consult attempts', async () => {
    const r = await unlock(A, 'members-pass-2026')
    if (!r.ok) throw new Error('unlock failed')
    for (let i = 0; i < 10; i++) await unlock(A, `wrong-guess-${i}xx`)
    store.calls.length = 0
    expect(await groupsOf(A, r.token)).toEqual([g.members])
    expect(store.calls).toEqual(['resolve'])
  })
  it('no salt → unavailable; unreadable counts → try_later (fail closed)', async () => {
    expect(await unlock(A, 'members-pass-2026', null, { ipSalt: undefined })).toEqual({ ok: false, code: 'unavailable' })
    store.failNext = { method: 'reserveAttempt', error: new AccessError('unavailable', 'store error') }
    expect(await unlock(A, 'members-pass-2026')).toEqual({ ok: false, code: 'try_later' })
  })
  it('tables not installed → unavailable', async () => {
    store.failNext = { method: 'reserveAttempt', error: new AccessError('unavailable', 'site access tables are not installed') }
    expect(await unlock(A, 'members-pass-2026')).toEqual({ ok: false, code: 'unavailable' })
  })
})

describe('live authorization: rotation, disabling, groups, revocation', () => {
  it('rotation signs out sessions that used the old password and only those grants', async () => {
    const onlyMembers = await unlock(A, 'members-pass-2026')
    const both = await unlock(A, 'staff-pass-2026!')
    if (!onlyMembers.ok || !both.ok) throw new Error('unlock failed')
    const both2 = await unlock(A, 'members-pass-2026', both.token)
    if (!both2.ok) throw new Error('unlock failed')
    const revoked = await store.rotateCredential(A, pw.members, await hashPassword('members-pass-2027'), 'actor')
    expect(revoked).toBe(1)
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: onlyMembers.token })).toBeNull()
    expect(await groupsOf(A, both2.token)).toEqual([g.staff])
    expect((await unlock(A, 'members-pass-2026', null, { ip: '192.0.2.9' })).ok).toBe(false)
    expect((await unlock(A, 'members-pass-2027', null, { ip: '192.0.2.9' })).ok).toBe(true)
  })
  it('a rotation racing an unlock: the stale version is refused, no session is created', async () => {
    const real = store.candidateCredentials.bind(store)
    store.candidateCredentials = async (...args) => {
      const c = await real(...args)
      await store.rotateCredential(A, pw.members, await hashPassword('members-pass-2027'), 'actor')
      return c
    }
    expect(await unlock(A, 'members-pass-2026')).toEqual({ ok: false, code: 'wrong_password' })
    expect(store.sessions).toHaveLength(0)
  })
  it('removing a group from a password, or archiving the group, takes effect on the next request', async () => {
    const r = await unlock(A, 'teachers-pass-2026')
    if (!r.ok) throw new Error('unlock failed')
    await store.setCredentialGroups(A, pw.teachers, [g.teachers], 'actor')
    expect(await groupsOf(A, r.token)).toEqual([g.teachers])
    await store.setGroupArchived(A, g.teachers, true, 'actor')
    expect(await groupsOf(A, r.token)).toEqual([])
  })
  it('logout revokes this session only; a foreign or junk token is a no-op', async () => {
    const r1 = await unlock(A, 'members-pass-2026'), r2 = await unlock(A, 'members-pass-2026')
    if (!r1.ok || !r2.ok) throw new Error('unlock failed')
    await logout({ store, environment: 'production', projectId: B, token: r1.token })
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: r1.token })).not.toBeNull()
    await logout({ store, environment: 'production', projectId: A, token: 'junk' })
    await logout({ store, environment: 'production', projectId: A, token: r1.token })
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: r1.token })).toBeNull()
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: r2.token })).not.toBeNull()
  })
  it('an expired session is nothing', async () => {
    let t = Date.now()
    store = Object.assign(createFakeStore(() => t), {})
    g.x = await addGroup(A, 'X')
    await addCred(A, 'expiring-pass-1', [g.x])
    const r = await unlock(A, 'expiring-pass-1', null, { sessionSeconds: 3600 })
    if (!r.ok) throw new Error('unlock failed')
    t += 3601 * 1000
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: r.token })).toBeNull()
  })
})

describe('resolveVisitor never throws and never queries junk', () => {
  it('malformed tokens do not reach the store', async () => {
    store.calls.length = 0
    for (const t of [undefined, null, '', 'abc', 'x'.repeat(200)]) expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: t })).toBeNull()
    expect(store.calls).toEqual([])
  })
  it('a store failure denies (null) and logs no token', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = generateSessionToken()
    store.failNext = { method: 'resolve', error: new Error('connection reset') }
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token })).toBeNull()
    expect(JSON.stringify(spy.mock.calls)).not.toContain(token)
    spy.mockRestore()
  })
})

describe('B2.0 — atomic reservation (regression: 20 of 20 parallel guesses were checked in B1)', () => {
  it('20 parallel wrong guesses from one IP: exactly 5 passwords are checked, 15 are refused', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => unlock(A, `parallel-guess-${i}`)))
    expect(results.filter((r) => !r.ok && r.code === 'wrong_password')).toHaveLength(5)
    expect(results.filter((r) => !r.ok && r.code === 'too_many_attempts')).toHaveLength(15)
    expect(store.attempts.filter((a) => a.succeeded === null)).toHaveLength(0)  // nothing left pending
  }, 30_000)

  it('a successful unlock finishes its reservation as succeeded (it does not count against the IP)', async () => {
    for (let i = 0; i < 4; i++) await unlock(A, `wrong-guess-${i}xx`)
    expect((await unlock(A, 'members-pass-2026')).ok).toBe(true)
    expect(store.attempts.at(-1)?.succeeded).toBe(true)
    expect((await unlock(A, 'members-pass-2026')).ok).toBe(true)  // 4 failures + 1 success < 5
  })

  it('an ABANDONED reservation counts as a failure inside the window and never after it', async () => {
    let t = Date.now()
    store = createFakeStore(() => t)
    g.x = await addGroup(A, 'X')
    await addCred(A, 'abandon-pass-01', [g.x])
    // five reservations whose function died before finishing (still pending)
    for (let i = 0; i < 5; i++) await store.reserveAttempt(A, hashIp('203.0.113.7', SALT), RATE_LIMITS)
    expect(store.attempts.every((a) => a.succeeded === null)).toBe(true)
    expect((await unlock(A, 'abandon-pass-01')).ok).toBe(false)          // blocked: pending = failure
    t += (15 * 60 + 1) * 1000                                            // the window passes
    expect((await unlock(A, 'abandon-pass-01')).ok).toBe(true)           // no permanent block
  })

  it('if finishing a failed attempt errors, the attempt stays pending — and still counts', async () => {
    store.failNext = { method: 'failAttempt', error: new Error('network') }
    expect(await unlock(A, 'wrong-guess-zz')).toEqual({ ok: false, code: 'wrong_password' })
    expect(store.attempts.filter((a) => a.succeeded === null)).toHaveLength(1)
  })

  it('a failure after the reservation (store error) finishes it as failed, answers try_later', async () => {
    store.failNext = { method: 'candidateCredentials', error: new Error('boom') }
    expect(await unlock(A, 'members-pass-2026')).toEqual({ ok: false, code: 'try_later' })
    expect(store.attempts.at(-1)?.succeeded).toBe(false)
  })
})

describe('B2.0 — sessions are bound to their environment', () => {
  it('a session made on dev or preview is nothing in production (and vice versa)', async () => {
    const dev = await unlock(A, 'members-pass-2026', null, { environment: 'dev' })
    if (!dev.ok) throw new Error('unlock failed')
    expect(await resolveVisitor({ store, environment: 'dev', projectId: A, token: dev.token })).not.toBeNull()
    for (const env of ['production', 'preview', 'local'] as const) {
      expect(await resolveVisitor({ store, environment: env, projectId: A, token: dev.token })).toBeNull()
    }
  })
  it('presenting a dev token while unlocking in production starts a new production session; the dev one is untouched', async () => {
    const dev = await unlock(A, 'members-pass-2026', null, { environment: 'dev' })
    if (!dev.ok) throw new Error('unlock failed')
    const prod = await unlock(A, 'members-pass-2026', dev.token, { environment: 'production', ip: '192.0.2.1' })
    if (!prod.ok) throw new Error('unlock failed')
    expect(prod.sessionId).not.toBe(dev.sessionId)
    expect(await resolveVisitor({ store, environment: 'dev', projectId: A, token: dev.token })).not.toBeNull()
  })
  it('logout in production does not touch the dev session', async () => {
    const dev = await unlock(A, 'members-pass-2026', null, { environment: 'dev' })
    if (!dev.ok) throw new Error('unlock failed')
    await logout({ store, environment: 'production', projectId: A, token: dev.token })
    expect(await resolveVisitor({ store, environment: 'dev', projectId: A, token: dev.token })).not.toBeNull()
  })
  it('an undeterminable environment fails closed: no unlock, no session, no store call', async () => {
    store.calls.length = 0
    expect(await unlock(A, 'members-pass-2026', null, { environment: null })).toEqual({ ok: false, code: 'unavailable' })
    expect(await resolveVisitor({ store, environment: null, projectId: A, token: generateSessionToken() })).toBeNull()
    expect(await resolveVisitor({ store, environment: 'staging' as never, projectId: A, token: generateSessionToken() })).toBeNull()
    expect(store.calls).toEqual([])
  })
  it('project-level data stays shared: rotating the password signs out every environment', async () => {
    const dev = await unlock(A, 'members-pass-2026', null, { environment: 'dev' })
    const prod = await unlock(A, 'members-pass-2026', null, { environment: 'production', ip: '192.0.2.2' })
    if (!dev.ok || !prod.ok) throw new Error('unlock failed')
    await store.rotateCredential(A, pw.members, await hashPassword('members-pass-2027'), 'actor')
    expect(await resolveVisitor({ store, environment: 'dev', projectId: A, token: dev.token })).toBeNull()
    expect(await resolveVisitor({ store, environment: 'production', projectId: A, token: prod.token })).toBeNull()
  })
})
