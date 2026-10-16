import { describe, expect, it } from 'vitest'
import type { LifecycleState } from '@/lib/lifecycle/status'
import {
  availableBatchOps,
  batchStep,
  canPublishChanges,
  containThumbUrl,
  formatListSort,
  nextListSort,
  parseListSort,
  publicPageUrl,
  catalogueImageShape,
  sortListRows,
  summarizeBatch,
  type SortableRow,
} from '../list-model'

const st = (status: LifecycleState['status'], hasChanges = false): LifecycleState => ({ status, hasChanges, publishOn: null, unpublishOn: null })
const row = (name: string, o: Partial<SortableRow> = {}): SortableRow => ({ name, status: st('published'), publishOn: null, unpublishOn: null, price: null, updatedAt: '2026-01-01T00:00:00Z', ...o })

describe('catalogueImageShape', () => {
  it('is portrait for the Bookshop preset and landscape for everything else', () => {
    expect(catalogueImageShape({ presetId: 'bookshop' })).toBe('portrait')
    expect(catalogueImageShape({ presetId: 'restaurant' })).toBe('landscape')
    expect(catalogueImageShape({ presetId: null })).toBe('landscape')
    expect(catalogueImageShape({})).toBe('landscape')
  })
})

describe('sort state', () => {
  it('round-trips and falls back to name ascending', () => {
    expect(parseListSort('updated:desc')).toEqual({ key: 'updated', dir: 'desc' })
    expect(formatListSort({ key: 'price', dir: 'asc' })).toBe('price:asc')
    expect(parseListSort('nope:desc')).toEqual({ key: 'name', dir: 'asc' })
    expect(parseListSort(null)).toEqual({ key: 'name', dir: 'asc' })
  })
  it('flips the same column and starts dates newest first', () => {
    expect(nextListSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextListSort({ key: 'name', dir: 'asc' }, 'updated')).toEqual({ key: 'updated', dir: 'desc' })
    expect(nextListSort({ key: 'updated', dir: 'desc' }, 'price')).toEqual({ key: 'price', dir: 'asc' })
  })
})

describe('sortListRows', () => {
  it('sorts names with the locale collator', () => {
    const r = sortListRows([row('beta'), row('Alpha'), row('àcorn')], { key: 'name', dir: 'asc' }, 'it')
    expect(r.map((x) => x.name)).toEqual(['Alpha', 'àcorn', 'beta'].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' })))
  })
  it('puts rows without a value last in both directions', () => {
    const rows = [row('a', { price: null }), row('b', { price: 5 }), row('c', { price: 2 })]
    expect(sortListRows(rows, { key: 'price', dir: 'asc' }, 'en').map((x) => x.name)).toEqual(['c', 'b', 'a'])
    expect(sortListRows(rows, { key: 'price', dir: 'desc' }, 'en').map((x) => x.name)).toEqual(['b', 'c', 'a'])
  })
  it('sorts by status order, changes and dates', () => {
    const rows = [row('p', { status: st('published') }), row('d', { status: st('draft') }), row('a', { status: st('archived') })]
    expect(sortListRows(rows, { key: 'status', dir: 'asc' }, 'en').map((x) => x.name)).toEqual(['d', 'p', 'a'])
    const ch = [row('x'), row('y', { status: st('published', true) })]
    expect(sortListRows(ch, { key: 'changes', dir: 'desc' }, 'en')[0].name).toBe('y')
    const dates = [row('old', { publishOn: '2026-01-01T00:00:00Z' }), row('new', { publishOn: '2026-05-01T00:00:00Z' }), row('none')]
    expect(sortListRows(dates, { key: 'publishOn', dir: 'desc' }, 'en').map((x) => x.name)).toEqual(['new', 'old', 'none'])
  })
})

describe('publicPageUrl', () => {
  const ok = { status: 'published' as const, hasPage: true, visibility: 'public', slug: 'dune', segment: 'books', domain: 'example.com', defaultLocale: 'en' }
  it('builds the default-language URL for a live page', () => {
    expect(publicPageUrl(ok)).toBe('https://example.com/en/books/dune')
    expect(publicPageUrl({ ...ok, visibility: 'unlisted' })).toBe('https://example.com/en/books/dune')
  })
  it('stays on a path-served platform host when given one (wins over the domain)', () => {
    expect(publicPageUrl({ ...ok, pathBase: 'https://dev.abluo.app/tmz' })).toBe('https://dev.abluo.app/tmz/books/dune')
    expect(publicPageUrl({ ...ok, domain: null, pathBase: 'https://dev.abluo.app/tmz/' })).toBe('https://dev.abluo.app/tmz/books/dune')
    expect(publicPageUrl({ ...ok, pathBase: 'https://dev.abluo.app/tmz', status: 'draft' })).toBeNull()
  })
  it.each([
    ['not live', { status: 'scheduled' as const }],
    ['draft', { status: 'draft' as const }],
    ['archived', { status: 'archived' as const }],
    ['unpublished', { status: 'unpublished' as const }],
    ['no page', { hasPage: false }],
    ['no slug', { slug: '' }],
    ['no slug (null)', { slug: null }],
    ['no segment', { segment: null }],
    ['no domain', { domain: null }],
  ])('is null when %s', (_n, patch) => {
    expect(publicPageUrl({ ...ok, ...patch })).toBeNull()
  })
})

describe('batch', () => {
  it('maps each operation to the existing per-item action', () => {
    expect(batchStep(st('draft'), 'publish', true)).toEqual({ via: 'publish', mode: 'now' })
    expect(batchStep(st('unpublished'), 'publish', true)).toEqual({ via: 'lifecycle', op: 'publishAgain' })
    expect(batchStep(st('published', true), 'publish', true)).toEqual({ via: 'publish', mode: 'keep' })
    expect(batchStep(st('published'), 'publish', true)).toBeNull()
    expect(batchStep(st('published'), 'unpublish', true)).toEqual({ via: 'lifecycle', op: 'unpublish' })
    expect(batchStep(st('draft'), 'unpublish', true)).toBeNull()
    expect(batchStep(st('unpublished'), 'archive', true)).toEqual({ via: 'lifecycle', op: 'archive' })
    expect(batchStep(st('draft'), 'archive', true)).toBeNull()
    expect(batchStep(st('archived'), 'restore', true)).toEqual({ via: 'lifecycle', op: 'restore' })
    expect(batchStep(st('archived'), 'publish', true)).toBeNull()
  })
  it('offers nothing to a viewer', () => {
    expect(availableBatchOps([st('draft'), st('published')], false)).toEqual([])
  })
  it('offers an operation only when valid for at least one selected row', () => {
    expect(availableBatchOps([st('archived')], true)).toEqual(['restore'])
    expect(availableBatchOps([st('published'), st('archived')], true)).toEqual(['unpublish', 'archive', 'restore'])
    expect(availableBatchOps([st('draft')], true)).toEqual(['publish'])
  })
  it('publishes changes only on documents that have a live or paused version', () => {
    expect(canPublishChanges(st('published', true))).toBe(true)
    expect(canPublishChanges(st('draft', false))).toBe(false)
    expect(canPublishChanges(st('archived', true))).toBe(false)
    expect(canPublishChanges(st('published', false))).toBe(false)
  })
  it('summarises outcomes with named failures', () => {
    const s = summarizeBatch([
      { id: '1', name: 'A', ok: true },
      { id: '2', name: 'B', ok: true },
      { id: '3', name: 'C', ok: false, reason: 'Add a name first.' },
    ])
    expect(s.done).toBe(2)
    expect(s.failed).toEqual([{ id: '3', name: 'C', reason: 'Add a name first.' }])
  })
})

describe('containThumbUrl', () => {
  it('never crops: fit=max, no crop params', () => {
    const u = containThumbUrl('https://cdn.sanity.io/images/p/d/x.jpg', 480)!
    expect(u).toContain('fit=max')
    expect(u).not.toContain('crop')
    expect(containThumbUrl('https://evil.example/x.jpg')).toBeNull()
    expect(containThumbUrl(null)).toBeNull()
  })
})
