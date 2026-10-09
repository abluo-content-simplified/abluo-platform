import { describe, expect, it } from 'vitest'
import { requestStats } from '../request-stats'
import { niceMax } from '@/components/app/ui/TrendChart'
import { projectAnalyticsView } from '../view'
import { mapGa4Batch } from '../ga4'
import { mapGsc } from '../gsc'
import { snapshotWindows } from '../periods'
import { GA4_BATCH, GSC_DAILY, GSC_QUERIES, NOW } from './fixtures'
import type { SnapshotRow } from '../types'

describe('requestStats (analytics v2)', () => {
  const now = NOW.getTime() // windows: current 2026-09-10…10-07, previous 08-13…09-09
  it('counts both windows per day, ignores today, ranks the pages of the current window', () => {
    const s = requestStats(
      [
        { created_at: '2026-10-07T10:00:00Z', page_path: '/it/contatti' },
        { created_at: '2026-10-07T11:00:00Z', page_path: '/it/contatti' },
        { created_at: '2026-09-15T09:00:00Z', page_path: '/' },
        { created_at: '2026-09-15T09:30:00Z', page_path: null },
        { created_at: '2026-08-20T09:00:00Z', page_path: '/old' },
        { created_at: '2026-10-08T01:00:00Z', page_path: '/today' }, // after the window
      ],
      now,
    )
    expect(s.since).toBe('2026-08-13')
    expect(s.current).toBe(4)
    expect(s.previous).toBe(1)
    expect(s.change).toBe(300)
    expect(s.daily).toHaveLength(28)
    expect(s.dailyPrevious).toHaveLength(28)
    expect(s.daily.at(-1)).toEqual({ date: '2026-10-07', value: 2 })
    expect(s.topPages).toEqual([
      { label: '/', value: 2 },
      { label: '/it/contatti', value: 2 },
    ])
  })
  it('nothing → zeros, no change', () => {
    const s = requestStats([], now)
    expect([s.current, s.previous, s.change, s.topPages.length]).toEqual([0, 0, null, 0])
  })
})

describe('view (analytics v2 fields)', () => {
  const w = snapshotWindows(NOW)
  const row = (source: 'ga4' | 'gsc', metrics: SnapshotRow['metrics']): SnapshotRow => ({
    project_id: 'p', source, period_start: w.current.start, period_end: w.current.end, status: 'ok', metrics, error: null, fetched_at: NOW.toISOString(),
  })
  it('exposes the comparison series, lists and device shares', () => {
    const v = projectAnalyticsView([row('ga4', mapGa4Batch(GA4_BATCH, w)), row('gsc', mapGsc(GSC_DAILY, GSC_QUERIES, w))], NOW.getTime())
    expect(v.dailyVisitorsPrevious).toHaveLength(28)
    expect(v.dailyClicks).toHaveLength(28)
    expect(v.dailyClicksPrevious).toHaveLength(28)
    expect(v.topReferrers[0]).toEqual({ label: 'ordine-medici.it', value: 65 })
    expect(v.aiSources.map((a) => a.label)).toEqual(['chatgpt.com', 'perplexity.ai'])
    expect(v.devices[0]).toEqual({ label: 'mobile', value: 1000, share: 1000 / 1500 })
    expect(v.opportunities[0]).toMatchObject({ label: 'impianti dentali costo', value: 400 })
  })
  it('a snapshot from before v2 still renders: the new lists are just empty', () => {
    const old = mapGa4Batch(GA4_BATCH, w)
    delete old.daily_previous; delete old.top_referrers; delete old.ai_sources; delete old.devices
    const v = projectAnalyticsView([row('ga4', old)], NOW.getTime())
    expect([v.dailyVisitorsPrevious, v.topReferrers, v.aiSources, v.devices, v.opportunities]).toEqual([[], [], [], [], []])
    expect(v.visitors?.value).toBe(1200)
  })
})

describe('TrendChart niceMax', () => {
  it('rounds the axis top up to 1 / 2 / 2.5 / 5 × 10ⁿ', () => {
    expect([0, 1, 3, 7, 12, 24, 55, 121, 1000].map(niceMax)).toEqual([1, 1, 5, 10, 20, 25, 100, 200, 1000])
  })
})
