import { describe, expect, it } from 'vitest'
import { applyPortfolioFilters, connectionOf, DEFAULT_PORTFOLIO_FILTERS, isDefaultPortfolioFilters, nextPortfolioSort } from '../portfolio-filter'
import type { PortfolioRow } from '../view'

const row = (o: Partial<PortfolioRow>): PortfolioRow => ({
  projectId: o.slug ?? 'x',
  slug: 'x',
  name: 'X',
  status: 'connected',
  ga4: 'connected',
  gsc: 'connected',
  visitors7: 10,
  visitors28: 40,
  trend: 5,
  searchClicks28: 3,
  topChannel: 'Direct',
  requests28: 1,
  dailyVisitors: [],
  ...o,
})

const rows = [
  row({ slug: 'alpha', name: 'Alpha Dental', visitors28: 100 }),
  row({ slug: 'beta', name: 'Beta Studio', visitors28: null, status: 'not_connected', ga4: 'not_connected', gsc: 'missing' }),
  row({ slug: 'gamma', name: 'Gamma', visitors28: 500, status: 'error', gsc: 'not_connected' }),
]

describe('portfolio filters', () => {
  it('default: most visitors first, missing numbers last', () => {
    expect(applyPortfolioFilters(rows, DEFAULT_PORTFOLIO_FILTERS).map((r) => r.slug)).toEqual(['gamma', 'alpha', 'beta'])
    const asc = { ...DEFAULT_PORTFOLIO_FILTERS, sort: { column: 'visitors28' as const, dir: 'asc' as const } }
    expect(applyPortfolioFilters(rows, asc).map((r) => r.slug)).toEqual(['alpha', 'gamma', 'beta'])
  })

  it('search by name or slug; status and connection filters', () => {
    expect(applyPortfolioFilters(rows, { ...DEFAULT_PORTFOLIO_FILTERS, q: 'studio' }).map((r) => r.slug)).toEqual(['beta'])
    expect(applyPortfolioFilters(rows, { ...DEFAULT_PORTFOLIO_FILTERS, status: 'error' }).map((r) => r.slug)).toEqual(['gamma'])
    expect(applyPortfolioFilters(rows, { ...DEFAULT_PORTFOLIO_FILTERS, connection: 'analyticsOnly' }).map((r) => r.slug)).toEqual(['gamma'])
    expect(applyPortfolioFilters(rows, { ...DEFAULT_PORTFOLIO_FILTERS, connection: 'none' }).map((r) => r.slug)).toEqual(['beta'])
  })

  it('connection, sort cycling, default detection', () => {
    expect(connectionOf({ ga4: 'error', gsc: 'connected' })).toBe('both')
    expect(nextPortfolioSort('site', DEFAULT_PORTFOLIO_FILTERS.sort)).toEqual({ column: 'site', dir: 'asc' })
    expect(nextPortfolioSort('visitors28', DEFAULT_PORTFOLIO_FILTERS.sort)).toEqual({ column: 'visitors28', dir: 'asc' })
    expect(isDefaultPortfolioFilters(DEFAULT_PORTFOLIO_FILTERS)).toBe(true)
    expect(isDefaultPortfolioFilters({ ...DEFAULT_PORTFOLIO_FILTERS, q: 'a' })).toBe(false)
  })
})
