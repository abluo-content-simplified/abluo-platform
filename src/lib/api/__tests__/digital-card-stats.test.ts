import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { clickThroughRate, createDigitalCardStatsStore, parseDigitalCardStats, statsRange, type DigitalCardStatsDb } from '../digital-card-stats'

const fakeDb = (result: { data?: unknown; error?: { code?: string; message?: string } | null } = {}) => {
  const rpc = vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null }))
  return { db: { rpc } as unknown as DigitalCardStatsDb, rpc }
}

describe('recordHit', () => {
  it('calls digital_card_hit with a visit (no link) and a click (link key)', async () => {
    const { db, rpc } = fakeDb()
    const s = createDigitalCardStatsStore(db)
    expect(await s.recordHit({ projectSlug: 'cyce', cardId: '0b9c6f0e-1111-4222-8333-444455556666', kind: 'visit', linkKey: 'ignored', source: 'qr' })).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith('digital_card_hit', { p_project: 'cyce', p_card: '0b9c6f0e-1111-4222-8333-444455556666', p_link: null, p_source: 'qr', p_kind: 'visit' })
    expect(await s.recordHit({ projectSlug: 'cyce', cardId: 'c1', kind: 'click', linkKey: 'k1', source: 'Bad Source!' })).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith('digital_card_hit', { p_project: 'cyce', p_card: 'c1', p_link: 'k1', p_source: 'direct', p_kind: 'click' })
  })

  it('refuses invalid input without calling the database, and never throws', async () => {
    const { db, rpc } = fakeDb()
    const s = createDigitalCardStatsStore(db)
    expect(await s.recordHit({ projectSlug: 'Bad Slug', cardId: 'c1', kind: 'visit' })).toBe(false)
    expect(await s.recordHit({ projectSlug: 'cyce', cardId: 'c 1', kind: 'visit' })).toBe(false)
    expect(await s.recordHit({ projectSlug: 'cyce', cardId: 'c1', kind: 'click' })).toBe(false)
    expect(await s.recordHit({ projectSlug: 'cyce', cardId: 'c1', kind: 'other' as never })).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
    const broken = createDigitalCardStatsStore({ rpc: async () => { throw new Error('down') } })
    expect(await broken.recordHit({ projectSlug: 'cyce', cardId: 'c1', kind: 'visit' })).toBe(false)
    const missing = createDigitalCardStatsStore(fakeDb({ error: { code: 'PGRST202' } }).db)
    expect(await missing.recordHit({ projectSlug: 'cyce', cardId: 'c1', kind: 'visit' })).toBe(false)
  })
})

describe('readStats', () => {
  const q = { projectSlug: 'cyce', cardId: null, from: '2026-10-11', to: '2026-11-09' }

  it('parses the aggregated jsonb', async () => {
    const data = {
      totals: { visits: 10, clicks: '4' },
      cards: [{ cardId: 'c1', visits: 10, clicks: 4 }],
      links: [{ cardId: 'c1', linkKey: 'k1', clicks: 4 }],
      sources: [{ source: 'qr', visits: 6, clicks: 1 }],
      days: [{ day: '2026-11-09', visits: 10, clicks: 4 }],
    }
    const { db, rpc } = fakeDb({ data })
    const r = await createDigitalCardStatsStore(db).readStats(q)
    expect(rpc).toHaveBeenCalledWith('digital_card_stats', { p_project: 'cyce', p_card: null, p_from: '2026-10-11', p_to: '2026-11-09' })
    expect(r).toEqual({ available: true, stats: { ...data, totals: { visits: 10, clicks: 4 } } })
  })

  it('migration missing → unavailable; bad range → invalid; db error → failed', async () => {
    expect(await createDigitalCardStatsStore(fakeDb({ error: { code: '42883' } }).db).readStats(q)).toEqual({ available: false })
    const s = createDigitalCardStatsStore(fakeDb().db)
    await expect(s.readStats({ ...q, from: '2026-11-10' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(s.readStats({ ...q, from: '2024-01-01' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(s.readStats({ ...q, projectSlug: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(createDigitalCardStatsStore(fakeDb({ error: { code: 'XX000' } }).db).readStats(q)).rejects.toMatchObject({ code: 'failed' })
  })

  it('tolerates an empty result', () => {
    expect(parseDigitalCardStats(null)).toEqual({ totals: { visits: 0, clicks: 0 }, cards: [], links: [], sources: [], days: [] })
  })
})

describe('sweep and helpers', () => {
  it('sweep returns the deleted count, null when missing', async () => {
    expect(await createDigitalCardStatsStore(fakeDb({ data: 12 }).db).sweep()).toBe(12)
    expect(await createDigitalCardStatsStore(fakeDb({ error: { code: 'PGRST202' } }).db).sweep()).toBeNull()
  })

  it('statsRange counts today (Europe/Rome) as the last day', () => {
    // 23:30 UTC on 9 Nov is already 10 Nov in Rome.
    expect(statsRange(7, new Date('2026-11-09T23:30:00Z'))).toEqual({ from: '2026-11-04', to: '2026-11-10' })
    expect(statsRange(1, new Date('2026-11-09T10:00:00Z'))).toEqual({ from: '2026-11-09', to: '2026-11-09' })
    expect(statsRange(365, new Date('2026-11-09T10:00:00Z')).from).toBe('2025-11-10')
  })

  it('click-through rate', () => {
    expect(clickThroughRate({ visits: 0, clicks: 3 })).toBe(0)
    expect(clickThroughRate({ visits: 3, clicks: 1 })).toBe(33.3)
  })
})

describe('migration 068', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/068_digital_card_stats.sql'), 'utf8')
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

  it('creates the contract table, idempotently, with RLS on and no policies', () => {
    expect(code).toContain('create table if not exists public.digital_card_daily')
    expect(code).toContain('primary key (project_slug, card_id, link_key, source, day)')
    expect(code).toContain('alter table public.digital_card_daily enable row level security')
    expect(code).not.toMatch(/create policy/i)
  })

  it('the three functions are security definer, empty search_path, service_role only', () => {
    for (const fn of ['digital_card_hit', 'digital_card_stats', 'digital_card_sweep']) {
      expect(code).toContain(`create or replace function public.${fn}(`)
      expect(code).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`))
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`))
    }
    expect(code.match(/security definer/g)).toHaveLength(3)
    expect(code.match(/set search_path = ''/g)).toHaveLength(3)
    expect(code).not.toMatch(/grant [^;]* to (anon|authenticated)/)
  })

  it('keeps 13 months', () => {
    expect(code).toContain("interval '13 months'")
  })
})
