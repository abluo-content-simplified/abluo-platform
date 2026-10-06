import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { draftProgress, partOfDay, requestCounts, segmentFills, timeAgo } from '../home-cards'

describe('home cards', () => {
  it('greets by the local hour', () => {
    expect(partOfDay(4)).toBe('evening')
    expect(partOfDay(5)).toBe('morning')
    expect(partOfDay(12)).toBe('afternoon')
    expect(partOfDay(18)).toBe('evening')
  })
  it('progress grows with the first-pass step; the overview is full', () => {
    expect(draftProgress('type')).toBe(0)
    expect(draftProgress('title')).toBeGreaterThan(draftProgress('category'))
    expect(draftProgress('story')).toBeLessThan(draftProgress('preview'))
    expect(draftProgress('publish')).toBe(1)
    expect(draftProgress('review')).toBe(1)
  })
  it('splits progress over four segments', () => {
    expect(segmentFills(0)).toEqual([0, 0, 0, 0])
    expect(segmentFills(0.375)).toEqual([1, 0.5, 0, 0])
    expect(segmentFills(1)).toEqual([1, 1, 1, 1])
  })
  it('says how long ago', () => {
    const now = Date.parse('2026-10-06T12:00:00Z')
    expect(timeAgo('2026-10-06T10:00:00Z', 'en', now)).toBe('2 hr. ago')
    expect(timeAgo('bad', 'en', now)).toBe('')
  })
  it('counts requests this week and unanswered ones', () => {
    const now = Date.parse('2026-10-06T12:00:00Z')
    expect(
      requestCounts(
        [
          { status: 'new', createdAt: '2026-10-05T10:00:00Z' },
          { status: 'processed', createdAt: '2026-10-04T10:00:00Z' },
          { status: 'new', createdAt: '2026-09-01T10:00:00Z' },
        ],
        now
      )
    ).toEqual({ week: 2, open: 2 })
  })
})
