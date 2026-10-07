import { describe, expect, it } from 'vitest'
import type { Person } from '@/lib/people/service'
import { applyPeopleFilters, DEFAULT_PEOPLE_FILTERS, isDefaultPeopleFilters, nextPeopleSort } from '../people-filter'

const p = (over: Partial<Person>): Person =>
  ({
    key: over.email ?? 'k',
    kind: 'member',
    status: 'active',
    name: '',
    email: 'x@y.z',
    avatarUrl: null,
    role: 'editor',
    extras: [],
    isYou: false,
    invitedAt: null,
    invitedBy: null,
    joinedAt: null,
    expiresAt: null,
    archivedAt: null,
    lastActiveAt: null,
    twoFactor: null,
    editableRoles: [],
    canArchive: false,
    canRestore: false,
    canResend: false,
    canCancel: false,
    ...over,
  }) as Person

const people = [
  p({ email: 'bea@a.it', name: 'Bea', role: 'admin', lastActiveAt: '2026-10-01T00:00:00Z' }),
  p({ email: 'al@a.it', name: 'Al', lastActiveAt: '2026-09-01T00:00:00Z' }),
  p({ email: 'new@a.it', status: 'invited', kind: 'invitation' }),
  p({ email: 'old@a.it', status: 'expired', kind: 'invitation' }),
  p({ email: 'gone@a.it', name: 'Gone', status: 'archived', kind: 'archived' }),
]
const names = (f = DEFAULT_PEOPLE_FILTERS) => applyPeopleFilters(people, f).map((x) => x.email)

describe('people filters', () => {
  it('by default hides archived people and sorts by name', () => {
    expect(names()).toEqual(['al@a.it', 'bea@a.it', 'new@a.it', 'old@a.it'])
  })
  it('status: invited includes expired; archived shows only archived; all shows everyone', () => {
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, status: 'invited' })).toEqual(['new@a.it', 'old@a.it'])
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, status: 'archived' })).toEqual(['gone@a.it'])
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, status: 'all' })).toHaveLength(5)
  })
  it('search matches name or email; role filters', () => {
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, q: 'BEA' })).toEqual(['bea@a.it'])
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, q: 'new@' })).toEqual(['new@a.it'])
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, role: 'admin' })).toEqual(['bea@a.it'])
  })
  it('sorts by last active, newest first on first click', () => {
    const sort = nextPeopleSort('lastActive', DEFAULT_PEOPLE_FILTERS.sort)
    expect(sort).toEqual({ column: 'lastActive', dir: 'desc' })
    expect(names({ ...DEFAULT_PEOPLE_FILTERS, sort }).slice(0, 2)).toEqual(['bea@a.it', 'al@a.it'])
  })
  it('knows the defaults', () => {
    expect(isDefaultPeopleFilters(DEFAULT_PEOPLE_FILTERS)).toBe(true)
    expect(isDefaultPeopleFilters({ ...DEFAULT_PEOPLE_FILTERS, status: 'archived' })).toBe(false)
  })
})
