import { describe, it, expect, vi } from 'vitest'
import { translationUsageView, NEAR_LIMIT_SHARE } from '@/lib/translate/usage-view'

const NOV = new Date('2026-11-08T10:00:00Z')

describe('translationUsageView', () => {
  it('no limit → unlimited, no share', () => {
    expect(translationUsageView(12400, null, NOV)).toEqual({ used: 12400, limit: null, share: null, state: 'unlimited', resetsOn: '2026-12-01' })
  })
  it('under 80 % → ok', () => {
    expect(translationUsageView(12500, 50000, NOV)).toMatchObject({ share: 0.25, state: 'ok' })
  })
  it('from 80 % → near', () => {
    expect(NEAR_LIMIT_SHARE).toBe(0.8)
    expect(translationUsageView(40000, 50000, NOV).state).toBe('near')
    expect(translationUsageView(39999, 50000, NOV).state).toBe('ok')
  })
  it('at or over the limit → reached, share capped at 1', () => {
    expect(translationUsageView(50000, 50000, NOV)).toMatchObject({ state: 'reached', share: 1 })
    expect(translationUsageView(61000, 50000, NOV)).toMatchObject({ state: 'reached', share: 1 })
  })
  it('resets on the first of next month (UTC), also across the year', () => {
    expect(translationUsageView(0, 10, new Date('2026-12-31T23:30:00Z')).resetsOn).toBe('2027-01-01')
  })
  it('bad numbers never go negative', () => {
    expect(translationUsageView(-5, 100, NOV).used).toBe(0)
    expect(translationUsageView(Number.NaN, 0, NOV)).toMatchObject({ used: 0, state: 'unlimited' })
  })
})

vi.mock('@/lib/translate/config', () => ({
  loadTranslateConfig: vi.fn(async (slug: string) => {
    if (slug === 'off') return { enabled: false, projectId: 'p-off', quota: null, provider: 'google', supportedLocales: [] }
    if (slug === 'broken') throw new Error('boom')
    return { enabled: true, projectId: null, quota: slug === 'limited' ? 50000 : null, provider: 'google', supportedLocales: [] }
  }),
}))
vi.mock('@/lib/translate/usage', () => ({ getMonthToDateCharacters: vi.fn(async (id: string) => (id === 'p-lim' ? 45000 : 1200)) }))

describe('loadTranslationUsageSummaries', () => {
  it('one project failing never hides the others; off is off', async () => {
    const { loadTranslationUsageSummaries } = await import('@/lib/translate/usage-summary')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = await loadTranslationUsageSummaries(
      [
        { id: 'p-lim', slug: 'limited' },
        { id: 'p-free', slug: 'free' },
        { id: 'p-off', slug: 'off' },
        { id: 'p-x', slug: 'broken' },
      ],
      NOV,
    )
    expect(m.get('p-lim')).toMatchObject({ kind: 'usage', used: 45000, limit: 50000, state: 'near' })
    expect(m.get('p-free')).toMatchObject({ kind: 'usage', used: 1200, limit: null, state: 'unlimited' })
    expect(m.get('p-off')).toEqual({ kind: 'off' })
    expect(m.get('p-x')).toEqual({ kind: 'unavailable' })
    err.mockRestore()
  })
})
