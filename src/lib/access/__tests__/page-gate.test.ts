/**
 * ADR-040 B2.2 — the page gate. Every deny-by-default branch, plus the real
 * unlock → resolve path over the fake store (authorized, foreign-project and
 * other-environment tokens, rotation).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { hashPassword } from '../password'
import { decidePageGate, pagePolicyChain, type PageAccessFields, type PageGateDeps } from '../page-gate'
import { resolveVisitor, unlockWithPassword } from '../visitor'
import { ACCESS_MODULE_ID } from '../model'
import type { AccessEnvironment } from '../environment'
import { createFakeStore, type FakeStore } from './fake-store'

const A = randomUUID(), B = randomUUID()
const SALT = 'test-salt-test-salt-test'
const ON = ['blog', ACCESS_MODULE_ID]
let store: FakeStore
let gA: string, gA2: string, gB: string
let tokenA: string, tokenB: string

const restricted = (groups: string[], navigation?: string): PageAccessFields => ({
  access: { visibility: 'restricted', groups, ...(navigation ? { navigation } : {}) },
  ancestorAccess: [],
  contentWithheld: true,
})

/** Deps wired to the fake store, as page-gate.server.ts wires the real one. */
function deps(over: Partial<PageGateDeps> & { cookie?: string | null; env?: AccessEnvironment | null; segmentTo?: string | null } = {}): PageGateDeps & { resolveSpy: ReturnType<typeof vi.fn> } {
  const resolveSpy = vi.fn(async (projectId: string, environment: AccessEnvironment | null, token: string | null | undefined) =>
    token ? resolveVisitor({ store, projectId, environment, token }) : null)
  return {
    projectIdFor: () => ('segmentTo' in over ? over.segmentTo! : A),
    environment: () => ('env' in over ? over.env! : 'production'),
    readToken: () => ('cookie' in over ? over.cookie : tokenA),
    resolveVisitor: resolveSpy,
    resolveSpy,
    ...over,
  }
}
const decide = (page: PageAccessFields, d = deps(), enabled: readonly string[] | null = ON) =>
  decidePageGate(page, { projectSegment: 'site-a', enabledModuleIds: enabled }, d)

beforeEach(async () => {
  store = createFakeStore()
  const add = (projectId: string) => {
    const id = randomUUID()
    store.groups.push({ id, projectId, name: { en: 'G' }, description: null, sortOrder: 0, archivedAt: null })
    return id
  }
  gA = add(A); gA2 = add(A); gB = add(B)
  await store.createCredential(A, { label: 'a', passwordHash: await hashPassword('site-a-password-1'), groupIds: [gA], expiresAt: null }, 'actor')
  await store.createCredential(B, { label: 'b', passwordHash: await hashPassword('site-b-password-1'), groupIds: [gB], expiresAt: null }, 'actor')
  const unlock = async (projectId: string, password: string) => {
    const r = await unlockWithPassword({ store, projectId, environment: 'production', password, currentToken: null, ip: '203.0.113.9', ipSalt: SALT, forGroupIds: null })
    if (!r.ok) throw new Error('unlock failed')
    return r.token
  }
  tokenA = await unlock(A, 'site-a-password-1')
  tokenB = await unlock(B, 'site-b-password-1')
})

describe('public pages behave exactly as before', () => {
  it.each([
    ['no access field', { access: undefined, ancestorAccess: [], contentWithheld: false }],
    ['explicit public', { access: { visibility: 'public' }, ancestorAccess: [], contentWithheld: false }],
  ])('%s → open, and no session lookup at all', async (_n, page) => {
    const readToken = vi.fn(() => tokenA)
    const projectIdFor = vi.fn(() => A)
    const d = deps({ readToken, projectIdFor })
    expect(await decide(page as PageAccessFields, d)).toEqual({ kind: 'open' })
    expect(d.resolveSpy).not.toHaveBeenCalled()
    expect(readToken).not.toHaveBeenCalled() // no cookie read: the request stays as it was
    expect(projectIdFor).not.toHaveBeenCalled()
  })
  it('open even with the module off: the module never gates public content', async () => {
    expect(await decide({ access: null, contentWithheld: false }, deps(), [])).toEqual({ kind: 'open' })
  })
})

describe('authorized access', () => {
  it('a session holding one of the groups is granted (OR within a page)', async () => {
    const g = await decide(restricted([gA2, gA]))
    expect(g.kind).toBe('granted')
  })
  it('AND along the path: a child of a page whose group the visitor lacks is denied', async () => {
    const page: PageAccessFields = { ...restricted([gA]), ancestorAccess: [{ access: { visibility: 'restricted', groups: [gA2] } }] }
    expect(await decide(page)).toMatchObject({ kind: 'denied', reason: 'no_matching_group' })
  })
  it('a public child under a restricted parent is restricted', async () => {
    const page: PageAccessFields = { access: null, ancestorAccess: [{ access: { visibility: 'restricted', groups: [gA] } }], contentWithheld: true }
    expect(pagePolicyChain(page)[1].visibility).toBe('restricted')
    expect((await decide(page)).kind).toBe('granted')
    expect((await decide(page, deps({ cookie: null }))).kind).toBe('denied')
  })
})

describe('unauthorized access — deny by default', () => {
  it('no cookie', async () => {
    expect(await decide(restricted([gA]), deps({ cookie: null }))).toMatchObject({ kind: 'denied', reason: 'no_session' })
  })
  it('a garbage cookie', async () => {
    expect(await decide(restricted([gA]), deps({ cookie: 'not-a-token' }))).toMatchObject({ kind: 'denied' })
  })
  it('a session without a matching group', async () => {
    expect(await decide(restricted([gA2]))).toMatchObject({ kind: 'denied', reason: 'no_matching_group' })
  })
  it('a malformed policy: unknown visibility, missing or invalid groups → nobody', async () => {
    for (const access of [{ visibility: 'members' }, { visibility: 'restricted' }, { visibility: 'restricted', groups: ['x'] }, 'restricted', 42]) {
      const g = await decide({ access, contentWithheld: true })
      expect(g, JSON.stringify(access)).toMatchObject({ kind: 'denied' })
    }
  })
  it('a group that no longer exists (deleted / archived) grants nobody', async () => {
    expect(await decide(restricted([randomUUID()]))).toMatchObject({ kind: 'denied' })
  })
  it('module disabled, or the installation list unreadable (null)', async () => {
    expect(await decide(restricted([gA]), deps(), ['blog'])).toMatchObject({ kind: 'denied', reason: 'module_unavailable' })
    expect(await decide(restricted([gA]), deps(), null)).toMatchObject({ kind: 'denied', reason: 'module_unavailable' })
  })
  it('the project segment does not resolve', async () => {
    expect(await decide(restricted([gA]), deps({ segmentTo: null }))).toMatchObject({ kind: 'denied', reason: 'unknown_project' })
  })
  it('the environment cannot be determined', async () => {
    expect(await decide(restricted([gA]), deps({ env: null }))).toMatchObject({ kind: 'denied' })
  })
  it('a session from another environment', async () => {
    expect(await decide(restricted([gA]), deps({ env: 'preview' }))).toMatchObject({ kind: 'denied' })
  })
  it('the authorization service is unavailable (store throws, or resolver throws)', async () => {
    const broken = deps({ resolveVisitor: async () => { throw new Error('supabase down') } })
    expect(await decide(restricted([gA]), broken)).toMatchObject({ kind: 'denied' })
    vi.spyOn(store, 'resolve').mockRejectedValue(new Error('timeout'))
    expect(await decide(restricted([gA]))).toMatchObject({ kind: 'denied' })
  })
  it('GROQ and TypeScript disagree (withheld but nothing restricted) → denied, never served', async () => {
    expect(await decide({ access: null, contentWithheld: true })).toMatchObject({ kind: 'denied', reason: 'inconsistent' })
  })
  it('the denial carries the page\'s navigation mode, hidden by default', async () => {
    expect(await decide(restricted([gA2]))).toMatchObject({ navigation: 'hidden' })
    expect(await decide(restricted([gA2], 'locked'))).toMatchObject({ navigation: 'locked' })
  })
})

describe('cross-tenant attempts', () => {
  it('site B\'s valid session on site A\'s page is denied', async () => {
    expect(await decide(restricted([gA]), deps({ cookie: tokenB }))).toMatchObject({ kind: 'denied' })
  })
  it('a page naming site B\'s group on site A grants nobody, even to site B\'s members', async () => {
    expect(await decide(restricted([gB]), deps({ cookie: tokenB }))).toMatchObject({ kind: 'denied' })
    expect(await decide(restricted([gB]))).toMatchObject({ kind: 'denied' })
  })
  it('the visitor is always resolved for the REQUEST\'s project, never one named by the page', async () => {
    const d = deps()
    await decide(restricted([gA]), d)
    expect(d.resolveSpy).toHaveBeenCalledWith(A, 'production', tokenA)
  })
})

describe('revocation and rotation take effect on the next request', () => {
  it('revoking all sessions closes the page', async () => {
    expect((await decide(restricted([gA]))).kind).toBe('granted')
    await store.revokeSessions(A, null, 'revoked_all', 'actor')
    expect((await decide(restricted([gA]))).kind).toBe('denied')
  })
})

describe('what the prompt may say about the visitor (never the page)', () => {
  it('no cookie → none; a dead or foreign cookie → ended; a live session without the group → other_groups', async () => {
    expect(await decide(restricted([gA]), deps({ cookie: null }))).toMatchObject({ visitor: 'none' })
    expect(await decide(restricted([gA]), deps({ cookie: 'garbage' }))).toMatchObject({ visitor: 'ended' })
    expect(await decide(restricted([gA]), deps({ cookie: tokenB }))).toMatchObject({ visitor: 'ended' })
    expect(await decide(restricted([gA2]))).toMatchObject({ visitor: 'other_groups' })
    await store.revokeSessions(A, null, 'revoked_all', 'actor')
    expect(await decide(restricted([gA]))).toMatchObject({ visitor: 'ended' })
  })
  it('early refusals (module off, unknown project) say nothing about the visitor', async () => {
    expect(await decide(restricted([gA]), deps(), [])).toMatchObject({ visitor: 'none' })
    expect(await decide(restricted([gA]), deps({ segmentTo: null }))).toMatchObject({ visitor: 'none' })
  })
})

