import { describe, expect, it } from 'vitest'
import {
  activeTestimonialFilterCount,
  applyTestimonialFilters,
  DEFAULT_TESTIMONIAL_FILTERS,
  isDefaultTestimonialFilters,
  nextTestimonialSort,
  parseTestimonialFilters,
  testimonialFiltersToParams,
  testimonialStateCounts,
  type FilterableTestimonial,
} from '../testimonials-filter'

const row = (o: Partial<FilterableTestimonial>): FilterableTestimonial => ({
  id: 'x',
  name: 'Anna',
  searchText: 'anna bellissimo',
  state: 'published',
  rating: null,
  updatedAt: '2026-11-01T10:00:00Z',
  ...o,
})
const rows = [
  row({ id: 'a', name: 'Anna', rating: 5, state: 'published', updatedAt: '2026-11-01T10:00:00Z' }),
  row({ id: 'b', name: 'Bruno', rating: null, state: 'draft', searchText: 'bruno tutto perfetto', updatedAt: '2026-11-05T10:00:00Z' }),
  row({ id: 'c', name: 'Carla', rating: 3, state: 'archived', searchText: 'carla', updatedAt: '2026-10-01T10:00:00Z' }),
  row({ id: 'd', name: 'Dora', rating: 4, state: 'changes', searchText: 'dora ottimo', updatedAt: '2026-11-03T10:00:00Z' }),
]

describe('testimonials filter', () => {
  it('"All" hides archived; the archived status shows only them', () => {
    expect(applyTestimonialFilters(rows, DEFAULT_TESTIMONIAL_FILTERS).map((r) => r.id)).toEqual(['b', 'd', 'a'])
    expect(applyTestimonialFilters(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, status: 'archived' }).map((r) => r.id)).toEqual(['c'])
  })
  it('searches names and every text, ignoring case and accents', () => {
    expect(applyTestimonialFilters(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, q: 'PERFETTO' }).map((r) => r.id)).toEqual(['b'])
    expect(applyTestimonialFilters(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, q: 'dora' }).map((r) => r.id)).toEqual(['d'])
  })
  it('sorts by rating with unrated last, and by name', () => {
    const byRating = applyTestimonialFilters(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, sort: { column: 'rating', dir: 'desc' } }).map((r) => r.id)
    expect(byRating).toEqual(['a', 'd', 'b'])
    const worstFirst = applyTestimonialFilters(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, sort: { column: 'rating', dir: 'asc' } }).map((r) => r.id)
    expect(worstFirst).toEqual(['d', 'a', 'b'])
    expect(applyTestimonialFilters(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, sort: { column: 'name', dir: 'desc' } }).map((r) => r.id)).toEqual(['d', 'b', 'a'])
  })
  it('counts per status, respecting the search', () => {
    expect(testimonialStateCounts(rows, DEFAULT_TESTIMONIAL_FILTERS)).toMatchObject({ all: 3, published: 1, changes: 1, draft: 1, archived: 1 })
    expect(testimonialStateCounts(rows, { ...DEFAULT_TESTIMONIAL_FILTERS, q: 'anna' })).toMatchObject({ all: 1, published: 1, draft: 0 })
  })
  it('clicking a header flips the same column or starts with its natural order', () => {
    expect(nextTestimonialSort('name', { column: 'updated', dir: 'desc' })).toEqual({ column: 'name', dir: 'asc' })
    expect(nextTestimonialSort('rating', { column: 'updated', dir: 'desc' })).toEqual({ column: 'rating', dir: 'desc' })
    expect(nextTestimonialSort('name', { column: 'name', dir: 'asc' })).toEqual({ column: 'name', dir: 'desc' })
  })
  it('round-trips through the address; unknown values fall back; a clean list has a clean URL', () => {
    const f = { q: 'ann', status: 'draft' as const, sort: { column: 'rating' as const, dir: 'asc' as const } }
    expect(parseTestimonialFilters(testimonialFiltersToParams(f))).toEqual(f)
    expect(parseTestimonialFilters(new URLSearchParams('status=bogus&sort=nope&dir=up'))).toEqual(DEFAULT_TESTIMONIAL_FILTERS)
    expect(testimonialFiltersToParams(DEFAULT_TESTIMONIAL_FILTERS).toString()).toBe('')
    expect(isDefaultTestimonialFilters({ ...DEFAULT_TESTIMONIAL_FILTERS, sort: { column: 'name', dir: 'asc' } })).toBe(true)
    expect(activeTestimonialFilterCount({ ...DEFAULT_TESTIMONIAL_FILTERS, status: 'draft' })).toBe(1)
  })
})
