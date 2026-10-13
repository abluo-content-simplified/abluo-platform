/**
 * ADR-032 slice 6 — the shared lifecycle UI pieces, minus React: the menu
 * rules, site-time-zone dates (D8, DST), the default publish choice, the
 * posts filters (All hides archived) and the list's live overlay.
 */
import { describe, expect, it } from 'vitest'
import { lifecycleMenu } from '../lifecycle-menu'
import { editingZone, formatInZone, fromLocalInput, offsetLabel, toLocalInput, validZone } from '../zoned-time'
import { defaultPublishChoice } from '@/components/client/create/steps/PublishStep'
import { applyFilters, DEFAULT_FILTERS, inStatusFilter, parseFilters, statusCounts, type PostStatus } from '@/lib/client/posts-filter'
import { applyLiveOverlays, staleOverlays } from '@/lib/client/posts-overlay'
import { publishedStatus } from '@/lib/lifecycle/status'

const ALL = { write: true, delete: true, deletePublished: true }
const actions = (s: Parameters<typeof lifecycleMenu>[0], can = ALL) => lifecycleMenu(s, can).map((e) => e.action)

describe('lifecycleMenu — one pattern for every module', () => {
  it('offers the D6 transitions per status', () => {
    expect(actions('draft')).toEqual(['delete'])
    expect(actions('scheduled')).toEqual(['unpublish', 'setUnpublishDate', 'archive'])
    expect(actions('published')).toEqual(['unpublish', 'setUnpublishDate', 'archive'])
    expect(actions('unpublished')).toEqual(['publishAgain', 'setUnpublishDate', 'archive'])
    expect(actions('archived')).toEqual(['restore', 'deletePermanently'])
  })

  it('deleting is always last, separated and destructive; archive is neither', () => {
    for (const s of ['draft', 'archived'] as const) {
      const last = lifecycleMenu(s, ALL).at(-1)!
      expect(last).toMatchObject({ destructive: true, separated: true })
    }
    for (const s of ['scheduled', 'published', 'unpublished'] as const) {
      expect(lifecycleMenu(s, ALL).every((e) => !e.destructive && !e.separated)).toBe(true)
    }
  })

  it('permissions only hide; delete-permanently needs both delete permissions', () => {
    expect(actions('archived', { write: true, delete: true, deletePublished: false })).toEqual(['restore'])
    expect(actions('archived', { write: true, delete: false, deletePublished: true })).toEqual(['restore'])
    expect(actions('published', { write: false, delete: true, deletePublished: true })).toEqual([])
    expect(actions('draft', { write: true, delete: false, deletePublished: false })).toEqual([])
  })
})

describe('dates in the site time zone (D8)', () => {
  const ROME = 'Europe/Rome'
  it('shows the same instant as the site sees it, wherever the viewer is', () => {
    const iso = '2026-10-15T07:30:00.000Z'
    expect(toLocalInput(iso, ROME)).toBe('2026-10-15T09:30')
    expect(toLocalInput(iso, 'Europe/London')).toBe('2026-10-15T08:30')
    expect(formatInZone(iso, ROME, 'en-GB')).toMatch(/15 Oct 2026, 09:30/)
    expect(offsetLabel(iso, ROME, 'en')).toBe('GMT+2')
    expect(offsetLabel('2026-12-15T07:30:00Z', ROME, 'en')).toBe('GMT+1')
  })

  it('typed times convert to UTC in the site zone; DST gaps move forward, overlaps take the first', () => {
    expect(fromLocalInput('2026-10-15T09:30', ROME)).toEqual({ utc: '2026-10-15T07:30:00.000Z', resolution: 'exact' })
    expect(fromLocalInput('2026-03-29T02:30', ROME)).toEqual({ utc: '2026-03-29T01:00:00.000Z', resolution: 'gap' }) // → 03:00 CEST
    expect(fromLocalInput('2026-10-25T02:30', ROME)).toEqual({ utc: '2026-10-25T00:30:00.000Z', resolution: 'overlap' }) // first 02:30 (CEST)
    expect(fromLocalInput('', ROME)).toBeNull()
    expect(fromLocalInput('2026-02-30T10:00', ROME)).toBeNull()
  })

  it('an unknown or missing zone falls back to the viewer’s own', () => {
    expect(validZone('Europe/Brussels')).toBe('Europe/Brussels')
    expect(validZone('Mars/Olympus')).toBeNull()
    expect(editingZone(null)).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(editingZone('Europe/London')).toBe('Europe/London')
  })

  it('the default schedule is tomorrow 09:00 in the site zone, unpublish 30 days later', () => {
    const now = new Date('2026-10-15T22:30:00Z') // already the 16th in Rome
    const c = defaultPublishChoice(ROME, now)
    expect(c.mode).toBe('now')
    expect(toLocalInput(c.at, ROME)).toBe('2026-10-17T09:00')
    expect(Date.parse(c.expireAt) - Date.parse(c.at)).toBe(30 * 24 * 3600 * 1000)
    expect(toLocalInput(defaultPublishChoice('Europe/London', now).at, 'Europe/London')).toBe('2026-10-16T09:00')
  })
})

describe('one status function for the list (D4)', () => {
  const now = new Date('2026-10-15T10:00:00Z')
  it('published, scheduled, unpublished (expired or empty window), archived dominating', () => {
    expect(publishedStatus({ publishedAt: '2026-10-01T00:00:00Z' }, 'required', now)).toBe('published')
    expect(publishedStatus({ publishedAt: '2026-11-01T00:00:00Z' }, 'required', now)).toBe('scheduled')
    expect(publishedStatus({ publishedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z' }, 'required', now)).toBe('unpublished')
    expect(publishedStatus({ publishedAt: '2027-01-01T00:00:00Z', expiresAt: '2026-10-13T00:00:00Z' }, 'required', now)).toBe('unpublished')
    expect(publishedStatus({ publishedAt: '2026-11-01T00:00:00Z', archivedAt: '2026-10-14T00:00:00Z' }, 'required', now)).toBe('archived')
  })
})

describe('posts filters', () => {
  const post = (id: string, status: PostStatus) => ({
    _id: id,
    status,
    searchText: id,
    categoryKeys: [],
    languages: [],
    primaryDate: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    publishedAt: null,
    expiresAt: null,
    featured: false,
  })
  const posts = [post('d', 'draft'), post('s', 'scheduled'), post('p', 'published'), post('u', 'unpublished'), post('a', 'archived')]
  const any = { ...DEFAULT_FILTERS, range: 'all' as const }

  it('All hides archived posts; the Archived filter shows them; counts agree', () => {
    expect(applyFilters(posts, any).map((p) => p._id).sort()).toEqual(['d', 'p', 's', 'u'])
    expect(applyFilters(posts, { ...any, status: 'archived' }).map((p) => p._id)).toEqual(['a'])
    expect(statusCounts(posts, any)).toEqual({ all: 4, draft: 1, scheduled: 1, published: 1, unpublished: 1, archived: 1 })
    expect(inStatusFilter('archived', 'all')).toBe(false)
  })

  it('old links with status=offline open the Unpublished filter', () => {
    expect(parseFilters(new URLSearchParams('status=offline')).status).toBe('unpublished')
    expect(parseFilters(new URLSearchParams('status=unpublished')).status).toBe('unpublished')
  })
})

describe('the list shows a lifecycle change at once', () => {
  const row = (liveRev: string, status: PostStatus = 'published') => ({ _id: 'p1', liveRev, hasLive: true, status, publishedAt: '2026-10-01T00:00:00Z', expiresAt: null, archivedAt: null })
  const overlay = new Map([['p1', { previousRev: 'r1', live: { rev: 'r2', publishedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-15T09:00:00Z', archivedAt: '2026-10-15T09:00:00Z' } }]])
  const now = new Date('2026-10-15T10:00:00Z')

  it('while the list still holds the replaced revision, the returned state is shown', () => {
    expect(applyLiveOverlays([row('r1')], overlay, now)[0]).toMatchObject({ status: 'archived', liveRev: 'r2', archivedAt: '2026-10-15T09:00:00Z' })
  })

  it('once the list caught up — or the post changed elsewhere — the list wins and the overlay is dropped', () => {
    expect(applyLiveOverlays([row('r2', 'archived')], overlay, now)[0].status).toBe('archived')
    expect(applyLiveOverlays([row('r9', 'unpublished')], overlay, now)[0].status).toBe('unpublished')
    expect(staleOverlays([row('r1')], overlay)).toEqual([])
    expect(staleOverlays([row('r2')], overlay)).toEqual(['p1'])
  })
})
