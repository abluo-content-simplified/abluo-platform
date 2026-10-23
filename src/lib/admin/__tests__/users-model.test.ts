import { describe, expect, it } from 'vitest'
import { applyUserFilters, buildAdminPeople, DEFAULT_USER_FILTERS, mergeActivity, summarizeUsers, type RawUsersInput } from '../users-model'

const NOW = Date.parse('2026-10-23T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

const input = (): RawUsersInput => ({
  users: [
    { id: 'tom', email: 'tom@abluo.app', createdAt: null, lastSignInAt: ago(600), superAdmin: true, twoFactor: true },
    { id: 'paolo', email: 'paolo@studio.it', createdAt: null, lastSignInAt: ago(3000), superAdmin: false, twoFactor: false },
    { id: 'marco', email: 'marco@livener.co', createdAt: null, lastSignInAt: ago(9000), superAdmin: false, twoFactor: true },
    { id: 'nobody', email: 'gone@x.it', createdAt: null, lastSignInAt: null, superAdmin: false, twoFactor: null },
  ],
  profiles: [
    { id: 'tom', name: 'Tom', avatarUrl: null, lastSeenAt: ago(1) },
    { id: 'paolo', name: 'Paolo Martegani', avatarUrl: null, lastSeenAt: ago(30) },
  ],
  tenants: [{ id: 'tS', name: 'Studio Martegani' }, { id: 'tL', name: 'Livener' }],
  projects: [
    { id: 'pS', name: 'Studio Martegani', slug: 'studiomartegani', tenantId: 'tS' },
    { id: 'pL', name: 'Livener', slug: 'livener', tenantId: 'tL' },
  ],
  tenantMembers: [{ userId: 'paolo', tenantId: 'tS', role: 'owner', extras: [], createdAt: null }],
  projectMembers: [],
  archives: [{ userId: 'marco', projectId: 'pL', role: 'editor', extras: [], archivedAt: ago(100) }],
  invitations: [
    { email: 'valentina@studio.it', scope: 'project', tenantId: null, projectId: 'pS', role: 'editor', extras: [], createdAt: ago(60) },
    { email: 'Paolo@studio.it', scope: 'project', tenantId: null, projectId: 'pL', role: 'editor', extras: [], createdAt: ago(60) },
  ],
})

describe('admin users model (ADR-030 A1)', () => {
  const people = buildAdminPeople(input())
  const by = (key: string) => people.find((p) => p.key === key)!

  it('one row per person, invite-only people included', () => {
    expect(people.map((p) => p.key).sort()).toEqual(['invite:valentina@studio.it', 'marco', 'nobody', 'paolo', 'tom'])
  })
  it('status: Super Admin active, Owner active, archived, invited, no access', () => {
    expect(by('tom').status).toBe('active')
    expect(by('paolo').status).toBe('active')
    expect(by('marco').status).toBe('archived')
    expect(by('invite:valentina@studio.it').status).toBe('invited')
    expect(by('nobody').status).toBe('none')
  })
  it('an Owner covers every site of the client; invitations match accounts by email', () => {
    expect(by('paolo').access.find((a) => a.scope === 'tenant')!.projectIds).toEqual(['pS'])
    expect(by('paolo').access.some((a) => a.status === 'invited' && a.placeId === 'pL')).toBe(true)
  })
  it('last active = heartbeat, else last sign-in', () => {
    expect(by('tom').lastActiveAt).toBe(ago(1))
    expect(by('marco').lastActiveAt).toBe(ago(9000))
  })
  it('filters: site, role, status, search', () => {
    const f = DEFAULT_USER_FILTERS
    expect(applyUserFilters(people, { ...f, project: 'pS' }).map((p) => p.key).sort()).toEqual(['invite:valentina@studio.it', 'paolo'])
    expect(applyUserFilters(people, { ...f, role: 'superAdmin' }).map((p) => p.key)).toEqual(['tom'])
    expect(applyUserFilters(people, { ...f, role: 'owner' }).map((p) => p.key)).toEqual(['paolo'])
    expect(applyUserFilters(people, { ...f, status: 'archived' }).map((p) => p.key)).toEqual(['marco'])
    expect(applyUserFilters(people, { ...f, q: 'livener' }).map((p) => p.key).sort()).toEqual(['marco', 'paolo'])
  })
  it('default sort: most recently active first', () => {
    expect(applyUserFilters(people, DEFAULT_USER_FILTERS)[0].key).toBe('tom')
  })
  it('summary tiles', () => {
    expect(summarizeUsers(people, NOW)).toEqual({ activeNow: 1, people: 2, invitations: 2, withoutTwoFactor: 1 })
  })
  it('activity: newest first, capped', () => {
    const items = [
      { id: 'a', at: ago(10), kind: 'content' as const, place: 'x' },
      { id: 'b', at: ago(1), kind: 'joined' as const, place: 'x' },
      { id: 'c', at: ago(5), kind: 'invited' as const, place: 'x' },
    ]
    expect(mergeActivity(items, 2).map((i) => i.id)).toEqual(['b', 'c'])
  })
})
