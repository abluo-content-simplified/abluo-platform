import { describe, expect, it } from 'vitest'
import { lifecycleAction, snapshotOf, type PublishedSnapshot } from '../transition'

const NOW = new Date('2026-10-13T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const PAST2 = '2026-10-05T09:00:00.000Z'
const FUTURE = '2026-11-01T10:00:00.000Z'
const FUTURE2 = '2026-12-01T10:00:00.000Z'
const s = (o: Partial<NonNullable<PublishedSnapshot>> = {}): PublishedSnapshot => ({ publishedAt: null, expiresAt: null, archivedAt: null, ...o })
const act = (b: PublishedSnapshot, a: PublishedSnapshot, rule: 'required' | 'optional' = 'required') => lifecycleAction(b, a, rule, NOW)

describe('lifecycleAction (ADR-032 D9)', () => {
  it('first publish: now, in the future, or already archived', () => {
    expect(act(null, s({ publishedAt: PAST }))).toBe('published')
    expect(act(null, s({ publishedAt: FUTURE }))).toBe('scheduled')
    expect(act(null, s({ publishedAt: PAST, archivedAt: PAST }))).toBe('archived')
  })
  it('optional rule: a document without dates is published on creation', () => {
    expect(act(null, s(), 'optional')).toBe('published')
    expect(act(null, s())).toBe('unpublished') // required: no publish date = not public
  })
  it('deletion and nothing', () => {
    expect(act(s({ publishedAt: PAST }), null)).toBe('deleted')
    expect(act(null, null)).toBeNull()
  })
  it('unpublish now, back online, unpublish via an expiry already passed', () => {
    expect(act(s({ publishedAt: PAST }), s({ publishedAt: PAST, expiresAt: NOW.toISOString() }))).toBe('unpublished')
    expect(act(s({ publishedAt: PAST, expiresAt: PAST2 }), s({ publishedAt: PAST }))).toBe('published')
  })
  it('scheduling: publish later, then change the date, then publish now', () => {
    expect(act(s({ publishedAt: PAST, expiresAt: PAST2 }), s({ publishedAt: FUTURE }))).toBe('scheduled')
    expect(act(s({ publishedAt: FUTURE }), s({ publishedAt: FUTURE2 }))).toBe('schedule_changed')
    expect(act(s({ publishedAt: FUTURE }), s({ publishedAt: PAST }))).toBe('published')
  })
  it('an unpublish date added, moved or removed on a live item is a schedule change', () => {
    expect(act(s({ publishedAt: PAST }), s({ publishedAt: PAST, expiresAt: FUTURE }))).toBe('schedule_changed')
    expect(act(s({ publishedAt: PAST, expiresAt: FUTURE }), s({ publishedAt: PAST, expiresAt: FUTURE2 }))).toBe('schedule_changed')
    expect(act(s({ publishedAt: PAST, expiresAt: FUTURE }), s({ publishedAt: PAST }))).toBe('schedule_changed')
  })
  it('archive and restore dominate', () => {
    expect(act(s({ publishedAt: PAST }), s({ publishedAt: PAST, archivedAt: NOW.toISOString() }))).toBe('archived')
    expect(act(s({ publishedAt: PAST, archivedAt: PAST }), s({ publishedAt: PAST, expiresAt: NOW.toISOString() }))).toBe('restored')
  })
  it('a content edit with unchanged dates is not a lifecycle event (same instant, different spelling)', () => {
    expect(act(s({ publishedAt: PAST }), s({ publishedAt: PAST }))).toBeNull()
    expect(act(s({ publishedAt: '2026-10-01T09:00:00Z' }), s({ publishedAt: '2026-10-01T09:00:00.000Z' }))).toBeNull()
    expect(act(s(), s(), 'optional')).toBeNull()
  })
  it('snapshotOf keeps only the three lifecycle fields', () => {
    expect(snapshotOf({ publishedAt: PAST, title: 'x' } as never)).toEqual({ publishedAt: PAST, expiresAt: null, archivedAt: null })
    expect(snapshotOf(undefined)).toBeNull()
  })
})
