import { describe, expect, it } from 'vitest'
import { cleanLinks, firstName, isUnreadSince, linkHref, planConversations, retentionCutoff, validateBody, validateSubject, MESSAGE_LIMITS } from '../model'
import { allowedPairs, buildMessageDirectory } from '../directory'
import type { AdminPerson } from '@/lib/admin/users-model'

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'

describe('planConversations (ADR-050 D3)', () => {
  it('separate (default): one private conversation per person', () => {
    const plan = planConversations('individual', [
      { projectId: P1, userId: 'a' },
      { projectId: P1, userId: 'b' },
      { projectId: P2, userId: 'c' },
    ])
    expect(plan).toEqual({ ok: true, conversations: [{ projectId: P1, userIds: ['a'] }, { projectId: P1, userIds: ['b'] }, { projectId: P2, userIds: ['c'] }] })
  })
  it('shared: one conversation for everyone on one site', () => {
    const plan = planConversations('shared', [
      { projectId: P1, userId: 'a' },
      { projectId: P1, userId: 'b' },
    ])
    expect(plan).toEqual({ ok: true, conversations: [{ projectId: P1, userIds: ['a', 'b'] }] })
  })
  it('shared across two sites is refused — nothing ever crosses projects', () => {
    expect(planConversations('shared', [{ projectId: P1, userId: 'a' }, { projectId: P2, userId: 'b' }])).toEqual({ ok: false, error: 'sharedNeedsOneSite' })
  })
  it('drops duplicates and refuses an empty or too long list', () => {
    expect(planConversations('individual', [{ projectId: P1, userId: 'a' }, { projectId: P1, userId: 'a' }])).toEqual({ ok: true, conversations: [{ projectId: P1, userIds: ['a'] }] })
    expect(planConversations('individual', [])).toEqual({ ok: false, error: 'recipientsRequired' })
    const many = Array.from({ length: MESSAGE_LIMITS.recipientsMax + 1 }, (_, i) => ({ projectId: P1, userId: `u${i}` }))
    expect(planConversations('individual', many)).toEqual({ ok: false, error: 'tooManyRecipients' })
  })
})

describe('dashboard links (D4)', () => {
  it('keeps only known destinations, at most three, without duplicates', () => {
    expect(cleanLinks(['home', 'nope', 'home', 'support', 'media', 'billing'])).toEqual([{ id: 'home' }, { id: 'support' }, { id: 'media' }])
    expect(cleanLinks('home')).toEqual([])
  })
  it('builds the path on the recipient’s site, never a free URL', () => {
    expect(linkHref('hoffmann', 'support')).toBe('/hoffmann/support')
    expect(linkHref('hoffmann', 'https://evil.example')).toBeNull()
  })
})

describe('small rules', () => {
  it('validates subject and body', () => {
    expect(validateSubject('  ')).toBe('subjectRequired')
    expect(validateSubject('x'.repeat(121))).toBe('subjectTooLong')
    expect(validateSubject('Your Digital Card')).toBeNull()
    expect(validateBody('')).toBe('bodyRequired')
  })
  it('unread when the other side wrote after my read mark', () => {
    expect(isUnreadSince('2026-11-10T10:00:00Z', null)).toBe(true)
    expect(isUnreadSince('2026-11-10T10:00:00Z', '2026-11-10T10:05:00Z')).toBe(false)
    expect(isUnreadSince(undefined, null)).toBe(false)
  })
  it('first name for "Tom · Abluo"', () => {
    expect(firstName('Tom Zimmermann')).toBe('Tom')
    expect(firstName('')).toBe('')
  })
  it('retention cutoff is 90 days back', () => {
    expect(retentionCutoff(Date.parse('2026-11-10T00:00:00Z'))).toBe('2026-08-12T00:00:00.000Z')
  })
})

describe('message directory', () => {
  const person = (userId: string, access: AdminPerson['access']): AdminPerson => ({
    key: userId, userId, name: userId.toUpperCase(), email: `${userId}@x.test`, avatarUrl: null, superAdmin: false, access,
    status: 'active', twoFactor: null, lastSignInAt: null, lastActiveAt: null, createdAt: null,
  })
  it('lists only people with ACTIVE access, per site', () => {
    const sites = buildMessageDirectory(
      [
        person('a', [{ scope: 'project', placeId: P1, placeName: 'One', projectIds: [P1], role: 'editor', extras: [], status: 'active', since: null }]),
        person('b', [{ scope: 'project', placeId: P1, placeName: 'One', projectIds: [P1], role: 'editor', extras: [], status: 'archived', since: null }]),
        person('c', [{ scope: 'tenant', placeId: 't', placeName: 'T', projectIds: [P1, P2], role: 'owner', extras: [], status: 'active', since: null }]),
      ],
      [{ id: P1, name: 'One' }, { id: P2, name: 'Two' }],
    )
    expect(sites.map((s) => [s.id, s.people.map((p) => p.userId)])).toEqual([[P1, ['a', 'c']], [P2, ['c']]])
    expect([...allowedPairs(sites)].sort()).toEqual([`${P1}:a`, `${P1}:c`, `${P2}:c`].sort())
  })
})
