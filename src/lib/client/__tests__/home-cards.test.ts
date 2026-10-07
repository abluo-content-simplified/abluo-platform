import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { draftProgress, navHref, partOfDay, percentChange, requestCounts, requestTrend, segmentFills, timeAgo } from '../home-cards'

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

  it('counts requests this week and the week before, only when the read reaches back far enough', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    const at = (d: number) => ({ createdAt: new Date(now - d * 86400_000).toISOString() })
    const rows = [at(1), at(3), at(8), at(20)]
    expect(requestTrend(rows, 200, now)).toEqual({ week: 2, previous: 1 })
    // Hit the limit and never got past two weeks: the previous week is unknown.
    expect(requestTrend([at(1), at(9)], 2, now)).toEqual({ week: 1, previous: null })
    // Hit the limit but reached older rows: the previous week is complete.
    expect(requestTrend([at(1), at(9), at(15)], 3, now)).toEqual({ week: 1, previous: 1 })
  })
  it('percent change only against a real, non-zero previous period', () => {
    expect(percentChange(5, 4)).toBe(25)
    expect(percentChange(3, 4)).toBe(-25)
    expect(percentChange(3, 0)).toBeNull()
    expect(percentChange(3, null)).toBeNull()
  })
  it('derives links from registered nav surfaces only', () => {
    const nav = [{ kind: 'nav', id: 'blog', segment: 'posts' }, { kind: 'widget', id: 'gallery' }]
    expect(navHref('abluo', 'blog', nav)).toBe('/abluo/posts')
    expect(navHref('abluo', 'blog', nav, { status: 'draft', tr: 'missing' })).toBe('/abluo/posts?status=draft&tr=missing')
    expect(navHref('abluo', 'gallery', nav)).toBeNull()
  })
})
