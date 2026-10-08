/**
 * Admin Analytics list — search, filters and sort over portfolio rows. Pure,
 * browser-safe (the list filters on the client; the rows are already loaded).
 */
import type { DataStatus, PortfolioRow, SourceState } from './view'

export const STATUS_FILTERS = ['all', 'connected', 'not_connected', 'error', 'stale'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

/** Which Google sources are set up (in Studio) for the site. */
export const CONNECTION_FILTERS = ['all', 'both', 'analyticsOnly', 'searchOnly', 'none'] as const
export type ConnectionFilter = (typeof CONNECTION_FILTERS)[number]

export const SORT_COLUMNS = ['site', 'visitors7', 'visitors28', 'trend', 'searchClicks28', 'requests28', 'status'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type PortfolioSort = { column: SortColumn; dir: 'asc' | 'desc' }

export type PortfolioFilters = { q: string; status: StatusFilter; connection: ConnectionFilter; sort: PortfolioSort }

export const DEFAULT_PORTFOLIO_FILTERS: PortfolioFilters = { q: '', status: 'all', connection: 'all', sort: { column: 'visitors28', dir: 'desc' } }

const configured = (s: SourceState) => s === 'connected' || s === 'error'

export function connectionOf(r: Pick<PortfolioRow, 'ga4' | 'gsc'>): Exclude<ConnectionFilter, 'all'> {
  const a = configured(r.ga4)
  const s = configured(r.gsc)
  return a && s ? 'both' : a ? 'analyticsOnly' : s ? 'searchOnly' : 'none'
}

const STATUS_ORDER: Record<DataStatus, number> = { error: 0, stale: 1, connected: 2, not_connected: 3 }

function value(r: PortfolioRow, c: SortColumn): string | number | null {
  switch (c) {
    case 'site':
      return r.name.toLowerCase()
    case 'status':
      return STATUS_ORDER[r.status]
    default:
      return r[c]
  }
}

export function applyPortfolioFilters(rows: readonly PortfolioRow[], f: PortfolioFilters): PortfolioRow[] {
  const q = f.q.trim().toLowerCase()
  const out = rows.filter(
    (r) =>
      (!q || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) &&
      (f.status === 'all' || r.status === f.status) &&
      (f.connection === 'all' || connectionOf(r) === f.connection),
  )
  const dir = f.sort.dir === 'asc' ? 1 : -1
  return out.sort((a, b) => {
    const va = value(a, f.sort.column)
    const vb = value(b, f.sort.column)
    // Missing numbers always last, whatever the direction.
    if (va === null && vb === null) return a.name.localeCompare(b.name)
    if (va === null) return 1
    if (vb === null) return -1
    if (va < vb) return -dir
    if (va > vb) return dir
    return a.name.localeCompare(b.name)
  })
}

/** Clicking a header: same column flips direction; a new column starts descending (names ascending). */
export function nextPortfolioSort(column: SortColumn, current: PortfolioSort): PortfolioSort {
  if (current.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { column, dir: column === 'site' ? 'asc' : 'desc' }
}

export function isDefaultPortfolioFilters(f: PortfolioFilters): boolean {
  return !f.q && f.status === 'all' && f.connection === 'all'
}
