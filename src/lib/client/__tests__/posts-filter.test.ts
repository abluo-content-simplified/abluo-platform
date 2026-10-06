import { describe, it, expect } from 'vitest'
import {
  activeFilterCount,
  applyFilters,
  BODY_SEARCH_CAP,
  dateWindow,
  DEFAULT_FILTERS,
  filtersToParams,
  isDefaultFilters,
  localDay,
  nextSort,
  normalizeSearch,
  parseFilters,
  postSearchText,
  postYears,
  sortState,
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
/** The page-load default narrows to "updated, last 7 days"; most cases here want any date. */
const ANY_DATE = { ...DEFAULT_FILTERS, range: 'all' as const, dateField: 'published' as const }
const ids = (f = {}) => applyFilters(posts, { ...ANY_DATE, ...f }, now).map((p) => p._id)

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
    const c = statusCounts(posts, { ...ANY_DATE, categories: ['cura'], status: 'draft' }, now)
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

  it('translations complete / missing, featured only', () => {
    const list = [
      post({ _id: 'x', translationsComplete: true, featured: true }),
      post({ _id: 'y', translationsComplete: false }),
      post({ _id: 'z' }),
    ]
    const pick = (f = {}) => applyFilters(list, { ...ANY_DATE, ...f }, now).map((p) => p._id)
    expect(pick({ translations: 'complete' })).toEqual(['x', 'z'])
    expect(pick({ translations: 'missing' })).toEqual(['y'])
    expect(pick({ featured: 'yes' })).toEqual(['x'])
  })
  it('date range on the chosen date (published, updated, ends), inclusive, local days', () => {
    const day = (iso: string) => localDay(iso)!
    expect(ids({ from: day('2026-10-05T00:00:00Z'), to: day('2026-10-05T00:00:00Z') })).toEqual(['a'])
    expect(ids({ dateField: 'updated', from: day('2026-10-06T00:00:00Z'), to: day('2026-10-10T00:00:00Z') })).toEqual(['a', 'b'])
    // Drafts have no publish date; ends needs an end date.
    expect(ids({ from: '2025-01-01', to: '2025-12-31' })).toEqual([])
    expect(ids({ dateField: 'ends', from: '2026-01-01', to: '2026-12-31' })).toEqual([])
    expect(activeFilterCount({ ...DEFAULT_FILTERS, from: '2026-01-01', to: '2026-01-31', featured: 'yes', translations: 'missing' })).toBe(3)
  })
  it('column sorts: title A→Z / Z→A, ends with empty last, header toggling', () => {
    const list = [
      post({ _id: 'b', title: 'Banana' }),
      post({ _id: 'a', title: 'apple', expiresAt: '2026-12-01T00:00:00Z' }),
      post({ _id: 'c', title: 'Cherry', expiresAt: '2026-11-01T00:00:00Z' }),
    ]
    const pick = (sort: Parameters<typeof nextSort>[1]) => applyFilters(list, { ...ANY_DATE, sort }, now).map((p) => p._id)
    expect(pick('title')).toEqual(['a', 'b', 'c'])
    expect(pick('title_desc')).toEqual(['c', 'b', 'a'])
    expect(pick('ends')).toEqual(['c', 'a', 'b'])
    expect(pick('ends_desc')).toEqual(['a', 'c', 'b'])
    expect(nextSort('title', 'newest')).toBe('title')
    expect(nextSort('title', 'title')).toBe('title_desc')
    expect(nextSort('published', 'newest')).toBe('oldest')
    expect(nextSort('updated', 'newest')).toBe('edited')
    expect(sortState('edited_asc')).toEqual({ column: 'updated', dir: 'asc' })
  })
  it('new filters round-trip through the URL', () => {
    const f = { ...DEFAULT_FILTERS, translations: 'missing' as const, featured: 'yes' as const, from: '2026-01-01', to: '2026-02-01', dateField: 'ends' as const, range: 'all' as const, sort: 'title_desc' as const }
    expect(parseFilters(filtersToParams(f))).toEqual(f)
    expect(filtersToParams(f).get('field')).toBe('ends')
    expect(filtersToParams(f).has('range')).toBe(false)
    expect(parseFilters(new URLSearchParams('tr=x&feat=no&from=soon&field=evil&range=forever'))).toEqual(DEFAULT_FILTERS)
  })

  it('page-load default is "updated, last 7 days"; field / range in the URL', () => {
    expect(DEFAULT_FILTERS.dateField).toBe('updated')
    expect(DEFAULT_FILTERS.range).toBe('last7')
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true)
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, sort: 'title' })).toBe(true)
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, range: 'all' })).toBe(false)
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, range: 'last30' })).toBe(1)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, range: 'all' })).toBe(0)
    // Deselecting the chip = any date, kept in the URL.
    const any = { ...DEFAULT_FILTERS, range: 'all' as const, dateField: 'published' as const }
    expect(filtersToParams(any).toString()).toBe('field=published&range=all')
    expect(parseFilters(filtersToParams(any))).toEqual(any)
    // A custom range wins over a quick range.
    expect(parseFilters(new URLSearchParams('range=last30&from=2026-01-01&to=2026-01-31')).range).toBe('all')
  })

  it('quick ranges are relative to today, on the chosen date', () => {
    expect(dateWindow({ from: '', to: '', range: 'last7' }, now)).toEqual({ from: '2026-10-09', to: '2026-10-15' })
    expect(dateWindow({ from: '', to: '', range: 'thisYear' }, now)).toEqual({ from: '2026-01-01', to: '2026-10-15' })
    expect(dateWindow({ from: '', to: '', range: 'all' }, now)).toBeNull()
    expect(dateWindow({ from: '2026-01-01', to: '', range: 'last7' }, now)).toEqual({ from: '2026-01-01', to: '2026-01-01' })
    // Default: updated in the last 7 days (b was edited 10 Oct; a on 6 Oct is older).
    expect(applyFilters(posts, DEFAULT_FILTERS, now).map((p) => p._id)).toEqual(['b'])
    expect(ids({ dateField: 'updated', range: 'last30' })).toEqual(['d', 'a', 'b'])
    // This year runs up to today: the scheduled post (1 Nov) is not in it yet.
    expect(ids({ range: 'thisYear' })).toEqual(['a', 'b'])
  })

  it('search text: titles, subtitles and body in every language, capped', () => {
    const text = postSearchText({
      titles: { it: 'Perché la gentilezza', de: 'Warum Freundlichkeit', _type: 'x' },
      subtitles: { it: 'Un sottotitolo' },
      bodies: { it: 'Il corpo   del testo, con l’ÀCCENTO', de: 'Der Körper', en: null },
    })
    expect(text).toContain('perche la gentilezza')
    expect(text).toContain('warum freundlichkeit')
    expect(text).toContain('un sottotitolo')
    expect(text).toContain('il corpo del testo, con l’accento')
    expect(text).toContain('der korper')
    expect(text).not.toContain('x')
    const list = [post({ _id: 'body', searchText: text })]
    expect(applyFilters(list, { ...ANY_DATE, q: 'KÖRPER' }, now).map((p) => p._id)).toEqual(['body'])
    // The body share is capped (split evenly between languages); titles are always kept.
    const long = postSearchText({ titles: { en: 'Title' }, bodies: { en: 'a'.repeat(50_000), it: 'b'.repeat(50_000) } })
    expect(long.length).toBeLessThan(BODY_SEARCH_CAP + 50)
    expect(long).toContain('b'.repeat(BODY_SEARCH_CAP / 2))
    expect(long.startsWith('title')).toBe(true)
  })
})
