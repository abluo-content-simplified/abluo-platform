import { describe, expect, it } from 'vitest'
import {
  activePersonFilterCount,
  applyPersonFilters,
  canReorderPersons,
  DEFAULT_PERSON_FILTERS,
  isDefaultPersonFilters,
  nextPersonSort,
  parsePersonFilters,
  personFiltersToParams,
  personStateCounts,
  type FilterablePerson,
} from '../persons-filter'

const p = (id: string, name: string, over: Partial<FilterablePerson> = {}): FilterablePerson => ({
  id,
  name,
  searchText: name.toLowerCase(),
  state: 'published',
  groups: [],
  visibility: 'listed',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
})

const rows = [
  p('a', 'Zoe Rossi', { groups: ['teachers'], updatedAt: '2026-03-01T00:00:00Z' }),
  p('b', 'Anna Bianchi', { groups: ['teachers', 'board'], searchText: 'anna bianchi yoga teacher', visibility: 'page' }),
  p('c', 'Marco Verdi', { state: 'archived' }),
  p('d', 'Luca Neri', { state: 'draft', visibility: 'off', updatedAt: '2026-02-01T00:00:00Z' }),
]
const names = (f = DEFAULT_PERSON_FILTERS) => applyPersonFilters(rows, f).map((x) => x.id)

describe('people filters', () => {
  it('keeps the site order by default and hides archived people', () => {
    expect(names()).toEqual(['a', 'b', 'd'])
  })
  it('shows archived people only under their own status', () => {
    expect(names({ ...DEFAULT_PERSON_FILTERS, status: 'archived' })).toEqual(['c'])
  })
  it('searches names, titles and groups, ignoring case and accents', () => {
    expect(names({ ...DEFAULT_PERSON_FILTERS, q: 'YOGA' })).toEqual(['b'])
    expect(names({ ...DEFAULT_PERSON_FILTERS, q: 'zoé' })).toEqual(['a'])
  })
  it('filters by group and visibility', () => {
    expect(names({ ...DEFAULT_PERSON_FILTERS, group: 'board' })).toEqual(['b'])
    expect(names({ ...DEFAULT_PERSON_FILTERS, visibility: 'off' })).toEqual(['d'])
  })
  it('sorts by name and by updated, and reverses the site order', () => {
    expect(names({ ...DEFAULT_PERSON_FILTERS, sort: { column: 'name', dir: 'asc' } })).toEqual(['b', 'd', 'a'])
    expect(names({ ...DEFAULT_PERSON_FILTERS, sort: { column: 'updated', dir: 'desc' } })).toEqual(['a', 'd', 'b'])
    expect(names({ ...DEFAULT_PERSON_FILTERS, sort: { column: 'order', dir: 'desc' } })).toEqual(['d', 'b', 'a'])
  })
  it('counts statuses with the other filters applied', () => {
    expect(personStateCounts(rows, DEFAULT_PERSON_FILTERS)).toEqual({ all: 3, published: 2, changes: 0, draft: 1, archived: 1 })
    expect(personStateCounts(rows, { ...DEFAULT_PERSON_FILTERS, group: 'teachers' }).all).toBe(2)
  })
  it('round-trips through the URL and writes nothing for the defaults', () => {
    expect(personFiltersToParams(DEFAULT_PERSON_FILTERS).toString()).toBe('')
    const f = { ...DEFAULT_PERSON_FILTERS, q: 'x', status: 'draft' as const, group: 'board', visibility: 'page' as const, sort: { column: 'name' as const, dir: 'desc' as const } }
    expect(parsePersonFilters(personFiltersToParams(f))).toEqual(f)
    expect(parsePersonFilters(new URLSearchParams('status=nope&visibility=zzz&sort=bad&dir=up'))).toEqual(DEFAULT_PERSON_FILTERS)
    expect(isDefaultPersonFilters({ ...DEFAULT_PERSON_FILTERS, sort: { column: 'name', dir: 'desc' } })).toBe(true)
    expect(activePersonFilterCount(f)).toBe(3)
  })
  it('flips the sort on the same column and starts newest-first for updated', () => {
    expect(nextPersonSort('name', { column: 'name', dir: 'asc' })).toEqual({ column: 'name', dir: 'desc' })
    expect(nextPersonSort('updated', { column: 'name', dir: 'asc' })).toEqual({ column: 'updated', dir: 'desc' })
  })
  it('allows dragging only with the whole list in site order', () => {
    expect(canReorderPersons(DEFAULT_PERSON_FILTERS)).toBe(true)
    expect(canReorderPersons({ ...DEFAULT_PERSON_FILTERS, q: 'a' })).toBe(false)
    expect(canReorderPersons({ ...DEFAULT_PERSON_FILTERS, group: 'board' })).toBe(false)
    expect(canReorderPersons({ ...DEFAULT_PERSON_FILTERS, status: 'archived' })).toBe(false)
    expect(canReorderPersons({ ...DEFAULT_PERSON_FILTERS, sort: { column: 'name', dir: 'asc' } })).toBe(false)
  })
})
