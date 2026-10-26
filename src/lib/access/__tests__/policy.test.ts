import { describe, it, expect } from 'vitest'
import { evaluateAccess, groupsRelevantTo, isRestricted, parseAccessPolicy, parseNavigationMode, slugAncestorPaths, PUBLIC_POLICY, type AccessPolicy } from '../policy'

const M = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const S = '33333333-3333-4333-8333-333333333333'
const restricted = (...groupIds: string[]): AccessPolicy => ({ visibility: 'restricted', groupIds })
const visitor = (...g: string[]) => ({ sessionId: 's', groupIds: new Set(g) })

describe('parseAccessPolicy — fail closed', () => {
  it('absent or null → public (every existing page keeps working)', () => {
    expect(parseAccessPolicy(undefined)).toEqual(PUBLIC_POLICY)
    expect(parseAccessPolicy(null)).toEqual(PUBLIC_POLICY)
    expect(parseAccessPolicy({ visibility: 'public' })).toEqual(PUBLIC_POLICY)
  })
  it('restricted keeps only valid, unique, lower-cased UUIDs', () => {
    expect(parseAccessPolicy({ visibility: 'restricted', groups: [T, M, M.toUpperCase(), 'members', 42, null] }))
      .toEqual({ visibility: 'restricted', groupIds: [M, T] })
  })
  it('an unknown visibility, a non-object or an array restricts to NOBODY', () => {
    for (const raw of [{ visibility: 'Restricted' }, { visibility: 'private', groups: [M] }, 'restricted', 1, [M], true]) {
      expect(parseAccessPolicy(raw)).toEqual({ visibility: 'restricted', groupIds: [] })
    }
  })
  it('a missing visibility is restricted to nobody — public must be stated', () => {
    expect(parseAccessPolicy({ groups: ['11111111-1111-4111-8111-111111111111'] })).toEqual({ visibility: 'restricted', groupIds: [] })
    expect(parseAccessPolicy({})).toEqual({ visibility: 'restricted', groupIds: [] })
    expect(parseAccessPolicy({ navigation: 'locked' })).toEqual({ visibility: 'restricted', groupIds: [] })
  })
  it('a public object with stray groups stays public', () => {
    expect(parseAccessPolicy({ visibility: 'public', groups: ['11111111-1111-4111-8111-111111111111'] })).toEqual(PUBLIC_POLICY)
  })
})

describe('evaluateAccess — OR within a resource, AND along the chain, deny by default', () => {
  it('public chains are open to everyone, even with the module off', () => {
    expect(evaluateAccess({ chain: [PUBLIC_POLICY], visitor: null, moduleEnabled: false })).toEqual({ allowed: true, reason: 'public' })
    expect(evaluateAccess({ chain: [], visitor: null, moduleEnabled: false }).allowed).toBe(true)
  })
  it('one matching group is enough (OR)', () => {
    expect(evaluateAccess({ chain: [restricted(M, T)], visitor: visitor(T), moduleEnabled: true })).toEqual({ allowed: true, reason: 'granted' })
  })
  it('no session → no_session; wrong groups → no_matching_group', () => {
    expect(evaluateAccess({ chain: [restricted(M)], visitor: null, moduleEnabled: true }).reason).toBe('no_session')
    expect(evaluateAccess({ chain: [restricted(M)], visitor: visitor(S), moduleEnabled: true }).reason).toBe('no_matching_group')
  })
  it('restricted with no groups opens for nobody', () => {
    expect(evaluateAccess({ chain: [restricted()], visitor: visitor(M, T, S), moduleEnabled: true }).reason).toBe('nobody')
  })
  it('module off never turns a restricted resource public', () => {
    expect(evaluateAccess({ chain: [restricted(M)], visitor: visitor(M), moduleEnabled: false }).reason).toBe('module_unavailable')
  })
  it('a child cannot weaken its parent: every restricted link must be satisfied (AND)', () => {
    const chain = [restricted(T), PUBLIC_POLICY, restricted(M, T)]   // page: Teachers; file: Members or Teachers
    expect(evaluateAccess({ chain, visitor: visitor(M), moduleEnabled: true }).allowed).toBe(false) // a Member can't reach it through a Teachers page
    expect(evaluateAccess({ chain, visitor: visitor(T), moduleEnabled: true }).allowed).toBe(true)
    expect(evaluateAccess({ chain: [restricted(T), restricted(M)], visitor: visitor(T, M), moduleEnabled: true }).allowed).toBe(true)
  })
  it('a visitor group id must match exactly — case-insensitive UUID, nothing fuzzy', () => {
    expect(evaluateAccess({ chain: [restricted(M)], visitor: visitor(M.toLowerCase()), moduleEnabled: true }).allowed).toBe(true)
    expect(evaluateAccess({ chain: [restricted(M)], visitor: visitor(M.slice(0, 35)), moduleEnabled: true }).allowed).toBe(false)
  })
})

describe('helpers', () => {
  it('isRestricted', () => {
    expect(isRestricted([PUBLIC_POLICY])).toBe(false)
    expect(isRestricted([PUBLIC_POLICY, restricted(M)])).toBe(true)
  })
  it('groupsRelevantTo is the union of restricted links (null when nothing is restricted)', () => {
    expect(groupsRelevantTo([PUBLIC_POLICY])).toBeNull()
    expect(groupsRelevantTo([restricted(T), restricted(M, T)])).toEqual([M, T])
  })
})

describe('navigation mode and path ancestors', () => {
  it('navigation is hidden unless explicitly locked', () => {
    expect(parseNavigationMode(undefined)).toBe('hidden')
    expect(parseNavigationMode({ visibility: 'restricted' })).toBe('hidden')
    expect(parseNavigationMode({ navigation: 'LOCKED' })).toBe('hidden')
    expect(parseNavigationMode({ navigation: 'locked' })).toBe('locked')
  })
  it('ancestor paths of a nested slug', () => {
    expect(slugAncestorPaths('members')).toEqual([])
    expect(slugAncestorPaths('members/teachers/notes')).toEqual(['members', 'members/teachers'])
    expect(slugAncestorPaths('/a//b/')).toEqual(['a'])
  })
})
