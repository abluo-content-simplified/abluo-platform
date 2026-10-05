import { describe, it, expect } from 'vitest'
import {
  activeFilterCount,
  applyFilters,
  DEFAULT_FILTERS,
  filtersToParams,
  normalizeSearch,
  parseFilters,
  postYears,
  statusCounts,
  type FilterablePost,
} from '../posts-filter'

const now = new Date('2026-10-15T12:00:00Z')
const post = (o: Partial<FilterablePost> & { _id: string }): FilterablePost => ({
  status: 'published',
  searchText: '',
  categoryKeys: [],
  languages: ['it', 'de'],
  primaryDate: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...o,
})

const posts = [
  post({ _id: 'a', searchText: normalizeSearch('Perché la gentilezza'), categoryKeys: ['riflessioni'], primaryDate: '2026-10-05T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' }),
  post({ _id: 'b', searchText: 'kintsugi', categoryKeys: ['cura'], primaryDate: '2026-08-01T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', languages: ['it'] }),
  post({ _id: 'c', status: 'draft', searchText: 'bozza', primaryDate: '2025-03-01T00:00:00Z', updatedAt: '2025-03-01T00:00:00Z' }),
  post({ _id: 'd', status: 'scheduled', searchText: 'domani', categoryKeys: ['cura'], primaryDate: '2026-11-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }),
]
const ids = (f = {}) => applyFilters(posts, { ...DEFAULT_FILTERS, ...f }, now).map((p) => p._id)

describe('posts filter', () => {
  it('search ignores accents and case', () => {
    expect(ids({ q: 'PERCHE' })).toEqual(['a'])
  })
  it('status, category (any of), missing language', () => {
    expect(ids({ status: 'draft' })).toEqual(['c'])
    expect(ids({ categories: ['cura'] })).toEqual(['d', 'b'])
    expect(ids({ missing: 'de' })).toEqual(['b'])
  })
  it('date filters', () => {
    expect(ids({ when: 'month' })).toEqual(['a'])
    expect(ids({ when: '3m' })).toEqual(['a', 'b'])
    expect(ids({ when: '2025' })).toEqual(['c'])
    expect(ids({ when: 'year' })).toEqual(['d', 'a', 'b'])
  })
  it('sorts newest, oldest, recently edited', () => {
    expect(ids()).toEqual(['d', 'a', 'b', 'c'])
    expect(ids({ sort: 'oldest' })).toEqual(['c', 'b', 'a', 'd'])
    expect(ids({ sort: 'edited' })).toEqual(['b', 'a', 'd', 'c'])
  })
  it('status counts respect the other filters', () => {
    const c = statusCounts(posts, { ...DEFAULT_FILTERS, categories: ['cura'], status: 'draft' }, now)
    expect(c).toEqual({ all: 2, published: 1, scheduled: 1, draft: 0, offline: 0 })
  })
  it('URL round-trip; defaults give a clean URL; junk falls back', () => {
    const f = { ...DEFAULT_FILTERS, q: 'x', status: 'offline' as const, categories: ['a', 'b'], when: '2025', missing: 'de', sort: 'oldest' as const }
    expect(parseFilters(filtersToParams(f))).toEqual(f)
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('')
    expect(parseFilters(new URLSearchParams('status=evil&sort=x&when=soon'))).toEqual(DEFAULT_FILTERS)
    expect(activeFilterCount(f)).toBe(5)
  })
  it('years with posts, newest first', () => {
    expect(postYears(posts)).toEqual(['2026', '2025'])
  })
})
