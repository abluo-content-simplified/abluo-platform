// ── Scheduling store against a REAL database — Abluo Sandbox only ─────────────
//
//   npx vitest run --config vitest.live.config.ts src/lib/scheduling
//
// Proves the store's column names, function arguments and error codes against
// migration 043 as applied (the unit tests use a fake). Writes fixture rows
// under a `zz-sched-…` tenant in the SANDBOX; rows are tombstoned, not deleted
// (no DELETE grant by design) — the sandbox is disposable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSandboxSupabase } from '@/lib/environments/supabase-target'
import { createSupabaseScheduleStore } from '../../store'
import { resolveSessionTimes } from '../../time'

// ADR-038 D8 — never the Supabase shared by dev, preview and production.
assertSandboxSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL, 'Scheduling live suite')

const store = createSupabaseScheduleStore()
const db = createAdminClient()
const tag = `zz-sched-${Date.now().toString(36)}`
let projectA = ''
let projectB = ''
const event = randomUUID()

beforeAll(async () => {
  const { data: t, error: te } = await db.from('tenants').insert({ slug: tag, display_name: 'Scheduling live suite' }).select('id').single()
  if (te) throw new Error(`fixture tenant: ${te.message}`)
  const { data: ps, error: pe } = await db
    .from('projects')
    .insert([{ slug: `${tag}-a`, tenant_id: t.id, name: 'A' }, { slug: `${tag}-b`, tenant_id: t.id, name: 'B' }])
    .select('id, slug')
  if (pe) throw new Error(`fixture projects: ${pe.message}`)
  projectA = ps.find((p) => p.slug.endsWith('-a'))!.id
  projectB = ps.find((p) => p.slug.endsWith('-b'))!.id
})

afterAll(async () => {
  if (projectA) await store.removeEventSchedule(projectA, event).catch(() => {})
  if (projectB) await store.removeEventSchedule(projectB, event).catch(() => {})
})

describe('scheduling store on migration 043 (sandbox)', () => {
  let ids: { seriesId: string; occurrenceId: string; version: number }

  it('creates a one-off schedule and reads it back in local time, zone and UTC', async () => {
    const times = resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-10-24T10:00', endLocal: '2026-10-24T12:30' })
    ids = await store.saveOneOff({ projectId: projectA, eventPublicId: event, times, place: { kind: 'location', key: 'brey' }, attendanceMode: 'inPerson', expectedVersion: null })
    expect(ids.version).toBe(1)
    const s = (await store.schedulesForEvents(projectA, [event])).get(event)!
    expect(s.series).toMatchObject({ id: ids.seriesId, timeZone: 'Europe/Brussels', startLocal: '2026-10-24T10:00', place: { kind: 'location', key: 'brey' } })
    expect(s.occurrences).toHaveLength(1)
    expect(s.occurrences[0]).toMatchObject({ id: ids.occurrenceId, startsAt: '2026-10-24T08:00:00.000Z', endsAt: '2026-10-24T10:30:00.000Z', status: 'scheduled' })
  })

  it('moving it keeps both ids; a stale version is a conflict', async () => {
    const moved = resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-10-25T02:30' }) // overlap night
    const r = await store.saveOneOff({ projectId: projectA, eventPublicId: event, times: moved, place: null, attendanceMode: 'online', expectedVersion: ids.version })
    expect(r).toEqual({ seriesId: ids.seriesId, occurrenceId: ids.occurrenceId, version: 2 })
    await expect(store.saveOneOff({ projectId: projectA, eventPublicId: event, times: moved, place: null, attendanceMode: 'online', expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict' })
    const o = (await store.schedulesForEvents(projectA, [event])).get(event)!.occurrences[0]
    expect(o).toMatchObject({ startLocal: '2026-10-25T02:30', startsAt: '2026-10-25T00:30:00.000Z', attendanceMode: 'online', place: null })
  })

  it('another project never sees it, even with the same event id', async () => {
    expect((await store.schedulesForEvents(projectB, [event])).size).toBe(0)
    expect(await store.occurrencesInWindow(projectB, { from: '2026-01-01T00:00:00Z' })).toEqual([])
    await expect(store.setOccurrenceStatus(projectB, ids.occurrenceId, 'cancelled', 2)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('window queries: present while not over, absent once over', async () => {
    expect((await store.occurrencesInWindow(projectA, { from: '2026-10-25T00:00:00Z' })).map((o) => o.id)).toEqual([ids.occurrenceId])
    expect(await store.occurrencesInWindow(projectA, { from: '2026-10-26T00:00:00Z' })).toEqual([])
    expect(await store.occurrencesInWindow(projectA, { from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toEqual([])
  })

  it('cancel bumps the version; removal tombstones and hides it', async () => {
    expect(await store.setOccurrenceStatus(projectA, ids.occurrenceId, 'cancelled', 2)).toBe(3)
    expect((await store.schedulesForEvents(projectA, [event])).get(event)!.occurrences[0].status).toBe('cancelled')
    expect(await store.removeEventSchedule(projectA, event)).toBe(1)
    expect((await store.schedulesForEvents(projectA, [event])).size).toBe(0)
  })
})
