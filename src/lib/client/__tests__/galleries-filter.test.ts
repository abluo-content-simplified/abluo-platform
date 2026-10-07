import { describe, expect, it } from 'vitest'
import {
  activeGalleryFilterCount,
  applyGalleryFilters,
  DEFAULT_GALLERY_FILTERS,
  galleryFiltersToParams,
  galleryState,
  galleryStateCounts,
  isDefaultGalleryFilters,
  nextGallerySort,
  parseGalleryFilters,
  type FilterableGallery,
  type GalleryFilters,
} from '../galleries-filter'

const NOW = new Date(2026, 9, 7, 12) // 7 Oct 2026, local noon
const g = (o: Partial<FilterableGallery> & { id: string }): FilterableGallery => ({
  title: o.id,
  internalName: '',
  tags: [],
  state: 'live',
  used: false,
  count: 1,
  updatedAt: new Date(2026, 9, 6, 10).toISOString(),
  createdAt: new Date(2026, 0, 2, 10).toISOString(),
  ...o,
})
const ROWS = [
  g({ id: 'a', title: 'Lo studio', internalName: 'Studio Hoffmann', tags: ['interni'], used: true, count: 12 }),
  g({ id: 'b', title: 'Perché noi', state: 'changes', count: 3, updatedAt: new Date(2026, 8, 1).toISOString() }),
  g({ id: 'c', title: 'Bozza', state: 'draft', count: 0, createdAt: new Date(2026, 9, 5).toISOString(), updatedAt: new Date(2026, 9, 5).toISOString() }),
]
const f = (o: Partial<GalleryFilters> = {}): GalleryFilters => ({ ...DEFAULT_GALLERY_FILTERS, ...o })
const ids = (rows: FilterableGallery[]) => rows.map((r) => r.id)

describe('galleries-filter', () => {
  it('derives the state from the draft / published flags', () => {
    expect(galleryState({ hasDraft: true, isPublished: false })).toBe('draft')
    expect(galleryState({ hasDraft: true, isPublished: true })).toBe('changes')
    expect(galleryState({ hasDraft: false, isPublished: true })).toBe('live')
  })

  it('shows everything on page load, newest change first', () => {
    expect(ids(applyGalleryFilters(ROWS, f(), NOW))).toEqual(['a', 'c', 'b'])
  })

  it('searches title, internal name and tags, accent-insensitive', () => {
    expect(ids(applyGalleryFilters(ROWS, f({ q: 'hoffmann' }), NOW))).toEqual(['a'])
    expect(ids(applyGalleryFilters(ROWS, f({ q: 'perche' }), NOW))).toEqual(['b'])
    expect(ids(applyGalleryFilters(ROWS, f({ q: 'INTERNI' }), NOW))).toEqual(['a'])
  })

  it('filters by status, usage and tag', () => {
    expect(ids(applyGalleryFilters(ROWS, f({ status: 'changes' }), NOW))).toEqual(['b'])
    expect(ids(applyGalleryFilters(ROWS, f({ usage: 'used' }), NOW))).toEqual(['a'])
    expect(ids(applyGalleryFilters(ROWS, f({ usage: 'unused' }), NOW))).toEqual(['c', 'b'])
    expect(ids(applyGalleryFilters(ROWS, f({ tag: 'interni' }), NOW))).toEqual(['a'])
  })

  it('filters on the updated or created date, quick or custom range', () => {
    expect(ids(applyGalleryFilters(ROWS, f({ range: 'last7' }), NOW))).toEqual(['a', 'c'])
    expect(ids(applyGalleryFilters(ROWS, f({ range: 'last7', dateField: 'created' }), NOW))).toEqual(['c'])
    expect(ids(applyGalleryFilters(ROWS, f({ from: '2026-09-01', to: '2026-09-30' }), NOW))).toEqual(['b'])
    expect(ids(applyGalleryFilters(ROWS, f({ from: '2026-01-02', dateField: 'created' }), NOW))).toEqual(['a', 'b'])
  })

  it('sorts by title, photos and dates; header clicks flip or pick the natural order', () => {
    expect(ids(applyGalleryFilters(ROWS, f({ sort: { column: 'title', dir: 'asc' } }), NOW))).toEqual(['c', 'a', 'b'])
    expect(ids(applyGalleryFilters(ROWS, f({ sort: { column: 'photos', dir: 'desc' } }), NOW))).toEqual(['a', 'b', 'c'])
    expect(ids(applyGalleryFilters(ROWS, f({ sort: { column: 'created', dir: 'asc' } }), NOW))).toEqual(['a', 'b', 'c'])
    expect(nextGallerySort('title', DEFAULT_GALLERY_FILTERS.sort)).toEqual({ column: 'title', dir: 'asc' })
    expect(nextGallerySort('updated', DEFAULT_GALLERY_FILTERS.sort)).toEqual({ column: 'updated', dir: 'asc' })
    expect(nextGallerySort('photos', { column: 'title', dir: 'asc' })).toEqual({ column: 'photos', dir: 'desc' })
  })

  it('counts per status respecting the other filters', () => {
    expect(galleryStateCounts(ROWS, f(), NOW)).toEqual({ all: 3, live: 1, changes: 1, draft: 1 })
    expect(galleryStateCounts(ROWS, f({ usage: 'unused', status: 'live' }), NOW)).toEqual({ all: 2, live: 0, changes: 1, draft: 1 })
  })

  it('round-trips through the URL, writing only non-defaults', () => {
    expect(galleryFiltersToParams(f()).toString()).toBe('')
    const custom = f({ q: 'x', status: 'draft', usage: 'used', tag: 't', dateField: 'created', from: '2026-01-01', to: '2026-02-01', sort: { column: 'title', dir: 'asc' } })
    expect(parseGalleryFilters(galleryFiltersToParams(custom))).toEqual({ ...custom, range: 'all' })
    expect(parseGalleryFilters(new URLSearchParams('status=nope&usage=x&range=bad&sort=evil&from=2026-13'))).toEqual(f())
  })

  it('knows the defaults and counts active filters', () => {
    expect(isDefaultGalleryFilters(f({ sort: { column: 'title', dir: 'asc' } }))).toBe(true)
    expect(isDefaultGalleryFilters(f({ usage: 'used' }))).toBe(false)
    expect(activeGalleryFilterCount(f({ q: 'x' }))).toBe(0)
    expect(activeGalleryFilterCount(f({ status: 'live', usage: 'used', tag: 't', range: 'last30' }))).toBe(4)
  })
})
