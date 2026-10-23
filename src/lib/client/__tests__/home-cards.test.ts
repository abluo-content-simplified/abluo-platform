import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { gallerySegments, navHref, partOfDay, percentChange, requestCounts, requestTrend, postDraftSegments, segmentFills, segmentsToProgress, timeAgo } from '../home-cards'

describe('home cards', () => {
  it('greets by the local hour', () => {
    expect(partOfDay(4)).toBe('evening')
    expect(partOfDay(5)).toBe('morning')
    expect(partOfDay(12)).toBe('afternoon')
    expect(partOfDay(18)).toBe('evening')
  })
  it('post bar: real first-pass position, never full for a draft', () => {
    const at = (furthest: Parameters<typeof postDraftSegments>[0]['furthest'], complete = false, hasLive = false) =>
      postDraftSegments({ furthest, hasLive, complete })
    expect(at('type')).toBe(1)
    expect(at('title')).toBe(1)
    expect(at('story')).toBeGreaterThanOrEqual(at('title'))
    expect(at('preview')).toBe(3)
    expect(at('publish', true)).toBe(3)
    for (const s of ['title', 'cover', 'preview', 'publish', 'review', 'done'] as const) expect(at(s, true)).toBeLessThanOrEqual(3)
  })
  it('post bar: overview / review does not count as finished unless complete', () => {
    expect(postDraftSegments({ furthest: 'review', hasLive: false, complete: false })).toBe(2)
    expect(postDraftSegments({ furthest: 'overview' as never, hasLive: false, complete: false })).toBe(1)
    expect(postDraftSegments({ furthest: 'review', hasLive: false, complete: true })).toBe(3)
    expect(postDraftSegments({ furthest: 'done', hasLive: false, complete: false })).toBe(2)
  })
  it('post bar: a live post with unpublished changes is three of four', () => {
    expect(postDraftSegments({ furthest: 'story', hasLive: true, complete: false })).toBe(3)
    expect(postDraftSegments({ furthest: 'review', hasLive: true, complete: true })).toBe(3)
  })
  it('gallery bar: 1 no photos, 2 photos, 3 all described, 3 published with changes', () => {
    expect(gallerySegments({ count: 0, allDescribed: false, isPublished: false })).toBe(1)
    expect(gallerySegments({ count: 4, allDescribed: false, isPublished: false })).toBe(2)
    expect(gallerySegments({ count: 4, allDescribed: true, isPublished: false })).toBe(3)
    expect(gallerySegments({ count: 0, allDescribed: false, isPublished: true })).toBe(3)
    expect(gallerySegments({ count: 4, allDescribed: false, isPublished: true })).toBe(3)
  })
  it('segments become a 0…1 progress and back to four bars', () => {
    expect(segmentFills(segmentsToProgress(3))).toEqual([1, 1, 1, 0])
    expect(segmentFills(segmentsToProgress(1))).toEqual([1, 0, 0, 0])
    expect(segmentsToProgress(9)).toBe(1)
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
