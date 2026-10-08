import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityServerReadClient: { fetch: vi.fn() } }))

import { mapLimited, refreshAllProjects, refreshProjectAnalytics, listSnapshotProjects } from '../snapshot'
import { getProjectAnalytics, isMissingTable } from '../read'
import { dataStatusOf, portfolioRow, portfolioSummary, projectAnalyticsView, projectsMissingGoodSnapshot } from '../view'
import { mapGa4Batch } from '../ga4'
import { mapGsc } from '../gsc'
import { snapshotWindows } from '../periods'
import type { SnapshotRow } from '../types'
import { GA4_BATCH, GSC_DAILY, GSC_QUERIES, jsonResponse, NOW } from './fixtures'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'

const W = snapshotWindows(NOW)
const P = { projectId: 'p1', slug: 'studio', ga4PropertyId: '412345678', gscSiteUrl: 'sc-domain:example.com' }

function googleFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('analyticsdata')) return jsonResponse(GA4_BATCH)
    const body = JSON.parse(String(init?.body))
    return jsonResponse(body.dimensions[0] === 'date' ? GSC_DAILY : GSC_QUERIES)
  })
}

describe('refreshProjectAnalytics', () => {
  it('writes one ok row per source for the window ending yesterday', async () => {
    const write = vi.fn(async () => {})
    const r = await refreshProjectAnalytics(P, { fetch: googleFetch() as unknown as typeof fetch, now: () => NOW, getToken: async () => 'tok', write })
    expect(r).toMatchObject({ ga4: 'ok', gsc: 'ok', errors: [] })
    const rows = (write.mock.calls[0] as unknown as [SnapshotRow[]])[0]
    expect(rows.map((x) => [x.source, x.status, x.period_start, x.period_end])).toEqual([
      ['ga4', 'ok', '2026-09-10', '2026-10-07'],
      ['gsc', 'ok', '2026-09-10', '2026-10-07'],
    ])
  })

  it('no IDs → not_connected rows and no Google call, not even for a token', async () => {
    const write = vi.fn(async () => {})
    const getToken = vi.fn(async () => 'tok')
    const fetch = vi.fn()
    const r = await refreshProjectAnalytics({ ...P, ga4PropertyId: null, gscSiteUrl: null }, { fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW, getToken, write })
    expect(r).toMatchObject({ ga4: 'not_connected', gsc: 'not_connected' })
    expect(getToken).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a Google refusal becomes an error row with the message; the other source still succeeds', async () => {
    const write = vi.fn(async () => {})
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
      url.includes('analyticsdata')
        ? jsonResponse({ error: { message: 'User does not have sufficient permissions for this property.', status: 'PERMISSION_DENIED' } }, 403)
        : jsonResponse(JSON.parse(String(init?.body)).dimensions[0] === 'date' ? GSC_DAILY : GSC_QUERIES),
    )
    const r = await refreshProjectAnalytics(P, { fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW, getToken: async () => 'tok', write })
    expect(r.ga4).toBe('error')
    expect(r.gsc).toBe('ok')
    const rows = (write.mock.calls[0] as unknown as [SnapshotRow[]])[0]
    expect(rows[0].error).toMatch(/GA4 403 PERMISSION_DENIED/)
  })

  it('a missing service account becomes error rows on configured sources', async () => {
    const write = vi.fn(async () => {})
    const { AnalyticsConfigError } = await import('../google-auth')
    const r = await refreshProjectAnalytics(P, {
      now: () => NOW,
      getToken: async () => {
        throw new AnalyticsConfigError('Google service account not configured')
      },
      write,
    })
    expect(r).toMatchObject({ ga4: 'error', gsc: 'error' })
  })
})

describe('refreshAllProjects / mapLimited', () => {
  it('limits concurrency and keeps order', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 2))
      inFlight--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14])
    expect(peak).toBe(3)
  })

  it('isolates a failed write to its project', async () => {
    const write = vi.fn(async (rows: SnapshotRow[]) => {
      if (rows[0].project_id === 'p2') throw new Error('db down')
    })
    const res = await refreshAllProjects({
      list: async () => [P, { ...P, projectId: 'p2', slug: 'other' }],
      fetch: googleFetch() as unknown as typeof fetch,
      now: () => NOW,
      getToken: async () => 'tok',
      write,
    })
    expect(res.projects).toBe(2)
    expect(res.withData).toBe(1)
    expect(res.errors).toEqual([{ slug: 'other', errors: ['write: db down'] }])
  })

  it('lists projects with their reporting IDs from Sanity', async () => {
    const list = await listSnapshotProjects({
      projects: async () => [{ id: 'p1', slug: 'studio' }, { id: 'p2', slug: 'bare' }],
      ids: async () => new Map([['studio', { ga4PropertyId: '412345678', gscSiteUrl: null }]]),
    })
    expect(list).toEqual([
      { projectId: 'p1', slug: 'studio', ga4PropertyId: '412345678', gscSiteUrl: null },
      { projectId: 'p2', slug: 'bare', ga4PropertyId: null, gscSiteUrl: null },
    ])
  })
})

// ── View ──────────────────────────────────────────────────────────────────────

const at = (iso: string) => `${iso}T04:30:00.000Z`
function snap(source: 'ga4' | 'gsc', status: SnapshotRow['status'], end = '2026-10-07', extra: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    project_id: 'p1',
    source,
    period_start: '2026-09-10',
    period_end: end,
    status,
    metrics: status === 'ok' ? (source === 'ga4' ? mapGa4Batch(GA4_BATCH, W) : mapGsc(GSC_DAILY, GSC_QUERIES, W)) : {},
    error: status === 'error' ? 'GA4 403 PERMISSION_DENIED: nope' : null,
    fetched_at: at(extra.period_end ?? end),
    ...extra,
  }
}

describe('projectAnalyticsView', () => {
  const now = NOW.getTime()

  it('nothing yet → missing, no data', () => {
    const v = projectAnalyticsView([], now)
    expect(v).toMatchObject({ ga4: 'missing', gsc: 'missing', hasData: false, visitors: null })
    expect(dataStatusOf(v)).toBe('not_connected')
  })

  it('both connected: values and changes vs the previous window', () => {
    const v = projectAnalyticsView([snap('ga4', 'ok'), snap('gsc', 'ok')], now)
    expect(v.visitors).toEqual({ value: 1200, previous: 1000, change: 20 })
    expect(v.visitors7).toEqual({ value: 330, previous: 0, change: null })
    expect(v.searchClicks).toEqual({ value: 50, previous: 10, change: 400 })
    expect(v.position).toEqual({ value: 7, previous: 12, change: -42 })
    expect(v.dailyVisitors).toHaveLength(28)
    expect(v.topPages[0]).toEqual({ label: '/', value: 2000 })
    expect(dataStatusOf(v)).toBe('connected')
  })

  it('latest error keeps showing the last good numbers, and reports the error', () => {
    const v = projectAnalyticsView([snap('ga4', 'ok', '2026-10-06'), snap('ga4', 'error', '2026-10-07')], now)
    expect(v.ga4).toBe('error')
    expect(v.visitors?.value).toBe(1200)
    expect(v.errors).toEqual([{ source: 'ga4', message: 'GA4 403 PERMISSION_DENIED: nope' }])
    expect(dataStatusOf(v)).toBe('error')
  })

  it('stale after two days without a good snapshot', () => {
    const v = projectAnalyticsView([snap('ga4', 'ok', '2026-10-04')], now)
    expect(v.stale).toBe(true)
    expect(dataStatusOf(v)).toBe('stale')
    expect(v.outOfDate).toBe(false)
  })

  it('out of date after seven days without a good snapshot — not "not connected"', () => {
    const v = projectAnalyticsView([snap('ga4', 'ok', '2026-09-25'), snap('gsc', 'ok', '2026-09-25')], now)
    expect(v).toMatchObject({ stale: true, outOfDate: true, hasData: true })
    expect(dataStatusOf(v)).toBe('out_of_date')
  })

  it('IDs removed since the last good snapshot → not connected, whatever the old data', () => {
    const v = projectAnalyticsView([snap('ga4', 'ok', '2026-09-25'), snap('ga4', 'not_connected', '2026-10-07'), snap('gsc', 'not_connected', '2026-10-07')], now)
    expect(v.hasData).toBe(true)
    expect(dataStatusOf(v)).toBe('not_connected')
  })

  it('one fresh source is enough for connected; an error anywhere wins', () => {
    const fresh = projectAnalyticsView([snap('ga4', 'ok'), snap('gsc', 'not_connected')], now)
    expect(dataStatusOf(fresh)).toBe('connected')
    const err = projectAnalyticsView([snap('ga4', 'ok', '2026-09-20'), snap('gsc', 'error')], now)
    expect(dataStatusOf(err)).toBe('error')
  })

  it('portfolio rows and summary: totals, risers, fallers, counts', () => {
    const rows = [
      portfolioRow({ id: 'p1', slug: 'a', name: 'A' }, [snap('ga4', 'ok'), snap('gsc', 'ok')], 4, now),
      portfolioRow({ id: 'p2', slug: 'b', name: 'B' }, [], null, now),
    ]
    expect(rows[0]).toMatchObject({ status: 'connected', visitors28: 1200, visitors7: 330, trend: 20, searchClicks28: 50, topChannel: 'Organic Search', requests28: 4 })
    expect(rows[1]).toMatchObject({ status: 'not_connected', visitors28: null, requests28: null })
    const views = new Map([
      ['p1', projectAnalyticsView([snap('ga4', 'ok')], now)],
      ['p2', projectAnalyticsView([], now)],
    ])
    const s = portfolioSummary(rows, views)
    expect(s.visitors).toEqual({ value: 1200, previous: 1000, change: 20 })
    expect(s).toMatchObject({ sites: 2, connected: 1, notConnected: 1, erroring: 0 })
    expect(s.risers).toEqual([{ slug: 'a', name: 'A', change: 20, visitors: 1200 }])
    expect(s.fallers).toEqual([])
  })
})

describe('getProjectAnalytics (client read)', () => {
  const ctx = (permissions: string[]) =>
    ({ userId: 'u', projects: [{ projectId: 'p1', projectSlug: 'studio', role: 'editor', permissions, enabledModuleIds: [] }] }) as unknown as TenantAuthorizationContext

  function reader(rows: SnapshotRow[], error: { code?: string; message?: string } | null = null) {
    const calls: unknown[][] = []
    const b: Record<string, (...a: unknown[]) => unknown> = {}
    for (const m of ['select', 'eq', 'order']) b[m] = (...a: unknown[]) => (calls.push([m, ...a]), b)
    b.limit = async () => ({ data: error ? null : rows, error })
    return { client: { from: (t: string) => (calls.push(['from', t]), b) }, calls }
  }

  it('refuses without analytics.read before any read', async () => {
    const r = reader([])
    await expect(getProjectAnalytics(ctx(['blog.post.read']), 'p1', { client: r.client })).rejects.toThrow(/analytics.read refused/)
    await expect(getProjectAnalytics(ctx(['analytics.read']), 'other', { client: r.client })).rejects.toThrow()
    expect(r.calls).toEqual([])
  })

  it('reads this project only, through the given (RLS) client', async () => {
    const r = reader([snap('ga4', 'ok')])
    const v = await getProjectAnalytics(ctx(['analytics.read']), 'p1', { client: r.client, now: NOW.getTime() })
    expect(v.visitors?.value).toBe(1200)
    expect(r.calls).toContainEqual(['eq', 'project_id', 'p1'])
  })

  it('a missing table (036 not applied) reads as nothing yet', async () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.analytics_snapshots' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42501', message: 'permission denied' })).toBe(false)
    const r = reader([], { code: '42P01', message: 'relation "analytics_snapshots" does not exist' })
    const v = await getProjectAnalytics(ctx(['analytics.read']), 'p1', { client: r.client })
    expect(v.hasData).toBe(false)
  })
})

describe('projectsMissingGoodSnapshot (admin portfolio: who needs a longer read)', () => {
  it('lists projects lacking a good row for either source', () => {
    const rows = [
      { project_id: 'a', source: 'ga4' as const, status: 'ok' as const },
      { project_id: 'a', source: 'gsc' as const, status: 'ok' as const },
      { project_id: 'b', source: 'ga4' as const, status: 'ok' as const },
      { project_id: 'b', source: 'gsc' as const, status: 'error' as const },
    ]
    expect(projectsMissingGoodSnapshot(['a', 'b', 'c'], rows)).toEqual(['b', 'c'])
    expect(projectsMissingGoodSnapshot([], rows)).toEqual([])
  })
})
