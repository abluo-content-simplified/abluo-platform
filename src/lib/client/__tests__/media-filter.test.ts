import { describe, expect, it } from 'vitest'
import {
  activeMediaFilterCount,
  applyMediaFilters,
  DEFAULT_MEDIA_FILTERS,
  isDefaultMediaFilters,
  mediaName,
  mediaTags,
  nextMediaSort,
  type FilterableMedia,
  type MediaFilters,
} from '@/lib/client/media-filter'
import { formatBytes } from '@/lib/client/format-bytes'

const NOW = new Date(2026, 9, 7, 12, 0, 0)

const photo = (p: Partial<FilterableMedia> & { assetId: string }): FilterableMedia => ({
  name: '',
  alt: {},
  tags: [],
  usedIn: [],
  ...p,
})

const LIB: FilterableMedia[] = [
  photo({ assetId: 'a', name: 'Studio', alt: { it: 'La città di Varese' }, tags: ['studio', 'esterni'], createdAt: '2026-10-06T10:00:00', bytes: 120_000, usedIn: [{}] }),
  photo({ assetId: 'b', name: 'Ritratto Claudia', alt: { it: 'Ritratto' }, tags: ['ritratti'], createdAt: '2026-09-20T10:00:00', bytes: 2_400_000 }),
  photo({ assetId: 'c', filename: 'beach.jpg', caption: { en: 'Summer sea' }, tags: ['studio'], createdAt: '2025-12-31T10:00:00', usedIn: [{}, {}] }),
  photo({ assetId: 'd', name: 'zeta', alt: { it: 'zeta' }, createdAt: '2026-01-02T10:00:00', bytes: 50 }),
]

const f = (patch: Partial<MediaFilters> = {}): MediaFilters => ({ ...DEFAULT_MEDIA_FILTERS, ...patch })
const ids = (patch: Partial<MediaFilters> = {}) => applyMediaFilters(LIB, f(patch), 'it', NOW).map((m) => m.assetId)

describe('applyMediaFilters', () => {
  it('defaults: everything, newest uploaded first', () => {
    expect(ids()).toEqual(['a', 'b', 'd', 'c'])
  })

  it('searches name, file name, description, caption and tags, accent- and case-insensitive, every word', () => {
    expect(ids({ q: 'citta' })).toEqual(['a'])
    expect(ids({ q: 'BEACH' })).toEqual(['c'])
    expect(ids({ q: 'summer' })).toEqual(['c'])
    expect(ids({ q: 'ritratti' })).toEqual(['b'])
    expect(ids({ q: 'studio esterni' })).toEqual(['a'])
    expect(ids({ q: 'studio nowhere' })).toEqual([])
  })

  it('filters by one tag (case-insensitive)', () => {
    expect(ids({ tag: 'STUDIO' })).toEqual(['a', 'c'])
  })

  it('filters by usage', () => {
    expect(ids({ usage: 'used' })).toEqual(['a', 'c'])
    expect(ids({ usage: 'unused' })).toEqual(['b', 'd'])
  })

  it('filters photos missing a description in the default language', () => {
    expect(ids({ description: 'missing' })).toEqual(['c'])
    expect(applyMediaFilters(LIB, f({ description: 'missing' }), 'de', NOW).map((m) => m.assetId)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('filters by the uploaded date: quick ranges and custom days', () => {
    expect(ids({ range: 'last7' })).toEqual(['a'])
    expect(ids({ range: 'last30' })).toEqual(['a', 'b'])
    expect(ids({ range: 'thisYear' })).toEqual(['a', 'b', 'd'])
    expect(ids({ from: '2025-12-31', to: '2026-01-02' })).toEqual(['d', 'c'])
    // A custom range wins over the quick range.
    expect(ids({ range: 'last7', from: '2025-12-31', to: null })).toEqual(['c'])
  })

  it('photos without an upload date never match a date filter', () => {
    const lib = [...LIB, photo({ assetId: 'x' })]
    expect(applyMediaFilters(lib, f({ range: 'thisYear' }), 'it', NOW).map((m) => m.assetId)).not.toContain('x')
    expect(applyMediaFilters(lib, f(), 'it', NOW).map((m) => m.assetId)).toContain('x')
  })

  it('sorts by name (unnamed last), size (unknown last) and uploaded', () => {
    expect(ids({ sort: { column: 'name', dir: 'asc' } })).toEqual(['c', 'b', 'a', 'd'])
    expect(ids({ sort: { column: 'name', dir: 'desc' } })).toEqual(['d', 'a', 'b', 'c'])
    expect(ids({ sort: { column: 'size', dir: 'desc' } })).toEqual(['b', 'a', 'd', 'c'])
    expect(ids({ sort: { column: 'size', dir: 'asc' } })).toEqual(['d', 'a', 'b', 'c'])
    expect(ids({ sort: { column: 'uploaded', dir: 'asc' } })).toEqual(['c', 'd', 'b', 'a'])
  })

  it('does not change the input', () => {
    const copy = [...LIB]
    applyMediaFilters(LIB, f({ sort: { column: 'name', dir: 'asc' } }), 'it', NOW)
    expect(LIB).toEqual(copy)
  })
})

describe('media filter helpers', () => {
  it('mediaName: name, then file name, then description', () => {
    expect(mediaName(LIB[0], 'it')).toBe('Studio')
    expect(mediaName(LIB[2], 'it')).toBe('beach.jpg')
    expect(mediaName(photo({ assetId: 'z', alt: { it: 'Mare' } }), 'it')).toBe('Mare')
    expect(mediaName(photo({ assetId: 'z' }), 'it')).toBe('')
  })

  it('mediaTags: most used first, then A–Z', () => {
    expect(mediaTags(LIB)).toEqual(['studio', 'esterni', 'ritratti'])
  })

  it('default / active counts', () => {
    expect(isDefaultMediaFilters(f())).toBe(true)
    expect(isDefaultMediaFilters(f({ sort: { column: 'name', dir: 'asc' } }))).toBe(true)
    expect(isDefaultMediaFilters(f({ q: 'x' }))).toBe(false)
    expect(activeMediaFilterCount(f({ q: 'x' }))).toBe(0)
    expect(activeMediaFilterCount(f({ tag: 'a', usage: 'used', description: 'missing', range: 'last7' }))).toBe(4)
    expect(activeMediaFilterCount(f({ from: '2026-01-01' }))).toBe(1)
  })

  it('nextMediaSort: name starts A–Z, others newest / largest first; same column flips', () => {
    const cur = DEFAULT_MEDIA_FILTERS.sort
    expect(nextMediaSort('name', cur)).toEqual({ column: 'name', dir: 'asc' })
    expect(nextMediaSort('size', cur)).toEqual({ column: 'size', dir: 'desc' })
    expect(nextMediaSort('uploaded', cur)).toEqual({ column: 'uploaded', dir: 'asc' })
  })

  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(120_000)).toBe('120 KB')
    expect(formatBytes(2_400_000)).toBe('2.4 MB')
    expect(formatBytes(2_400_000, 'it')).toBe('2,4 MB')
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(-1)).toBe('')
  })
})
