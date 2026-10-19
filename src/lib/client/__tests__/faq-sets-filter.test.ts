import { describe, expect, it } from 'vitest'
import {
  activeFaqFilterCount,
  applyFaqFilters,
  DEFAULT_FAQ_FILTERS,
  faqFiltersToParams,
  faqStateCounts,
  isDefaultFaqFilters,
  matchesFaqStatus,
  nextFaqSort,
  parseFaqFilters,
  type FaqSetFilters,
  type FilterableFaqSet,
} from '../faq-sets-filter'

const s = (o: Partial<FilterableFaqSet> & { id: string }): FilterableFaqSet => ({
  name: o.id,
  searchText: '',
  state: 'published',
  used: false,
  count: 1,
  updatedAt: new Date(2026, 9, 6, 10).toISOString(),
  ...o,
})
const ROWS = [
  s({ id: 'a', name: 'Implantologia', searchText: 'implantologia quanto dura un impianto? wie lange hält ein implantat?', used: true, count: 6 }),
  s({ id: 'b', name: 'Igiene', state: 'changes', count: 3, updatedAt: new Date(2026, 8, 1).toISOString() }),
  s({ id: 'c', name: 'Bozza', state: 'draft', count: 0, updatedAt: new Date(2026, 9, 7).toISOString() }),
  s({ id: 'd', name: 'Vecchie domande', state: 'archived', count: 2 }),
]
const f = (o: Partial<FaqSetFilters> = {}): FaqSetFilters => ({ ...DEFAULT_FAQ_FILTERS, ...o })
const ids = (rows: FilterableFaqSet[]) => rows.map((r) => r.id)

describe('faq-sets-filter', () => {
  it('"All" hides archived sets; a status shows exactly that status', () => {
    expect(matchesFaqStatus('archived', 'all')).toBe(false)
    expect(matchesFaqStatus('draft', 'all')).toBe(true)
    expect(ids(applyFaqFilters(ROWS, f({ status: 'archived' })))).toEqual(['d'])
    expect(ids(applyFaqFilters(ROWS, f()))).toEqual(['c', 'a', 'b'])
  })

  it('search matches the name and question text in every language, accent- and case-insensitive', () => {
    expect(ids(applyFaqFilters(ROWS, f({ q: 'IMPLANTAT' })))).toEqual(['a'])
    expect(ids(applyFaqFilters(ROWS, f({ q: 'igiene' })))).toEqual(['b'])
    expect(ids(applyFaqFilters(ROWS, f({ q: 'nothing like this' })))).toEqual([])
  })

  it('filters by usage', () => {
    expect(ids(applyFaqFilters(ROWS, f({ usage: 'used' })))).toEqual(['a'])
    expect(ids(applyFaqFilters(ROWS, f({ usage: 'unused' })))).toEqual(['c', 'b'])
  })

  it('sorts by name, questions and updated', () => {
    expect(ids(applyFaqFilters(ROWS, f({ sort: { column: 'name', dir: 'asc' } })))).toEqual(['c', 'b', 'a'])
    expect(ids(applyFaqFilters(ROWS, f({ sort: { column: 'questions', dir: 'desc' } })))).toEqual(['a', 'b', 'c'])
    expect(nextFaqSort('name', DEFAULT_FAQ_FILTERS.sort)).toEqual({ column: 'name', dir: 'asc' })
    expect(nextFaqSort('updated', DEFAULT_FAQ_FILTERS.sort)).toEqual({ column: 'updated', dir: 'asc' })
  })

  it('counts per status respect the other filters', () => {
    expect(faqStateCounts(ROWS, f())).toEqual({ all: 3, published: 1, changes: 1, draft: 1, archived: 1 })
    expect(faqStateCounts(ROWS, f({ usage: 'used' }))).toEqual({ all: 1, published: 1, changes: 0, draft: 0, archived: 0 })
  })

  it('round-trips through the URL and ignores unknown values', () => {
    const custom = f({ q: 'dura', status: 'draft', usage: 'unused', sort: { column: 'name', dir: 'desc' } })
    expect(parseFaqFilters(faqFiltersToParams(custom))).toEqual(custom)
    expect(faqFiltersToParams(DEFAULT_FAQ_FILTERS).toString()).toBe('')
    expect(parseFaqFilters(new URLSearchParams('status=nope&usage=x&sort=zzz&new=1'))).toEqual(DEFAULT_FAQ_FILTERS)
  })

  it('knows when the filters are the defaults and how many narrow the list', () => {
    expect(isDefaultFaqFilters(f({ sort: { column: 'name', dir: 'asc' } }))).toBe(true)
    expect(isDefaultFaqFilters(f({ q: 'x' }))).toBe(false)
    expect(activeFaqFilterCount(f({ status: 'draft', usage: 'used', q: 'x' }))).toBe(2)
  })
})
