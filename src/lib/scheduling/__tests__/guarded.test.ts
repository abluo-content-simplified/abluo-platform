/**
 * ADR-043 D9 — schedule writes that name instructors check each person belongs
 * to the GRANT's project before anything reaches Supabase.
 */
import { describe, it, expect, vi } from 'vitest'

const fetch = vi.fn()
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: { fetch: (...a: unknown[]) => fetch(...a) } }))

import { guardInstructors, guardInstructorOverride, saveOneOffGuarded } from '../guarded.server'
import { createSupabaseScheduleStore } from '../store'
import { resolveSessionTimes } from '../time'
import { ScheduleError } from '../types'

const P = '00000000-0000-4000-8000-0000000000a1'
const EV = '00000000-0000-4000-8000-0000000000e1'
const MINE = '00000000-0000-4000-8000-00000000000a'
const FOREIGN = '00000000-0000-4000-8000-00000000000c'
const times = resolveSessionTimes({ timeZone: 'Europe/Brussels', startLocal: '2026-10-24T10:00', endLocal: '2026-10-24T12:30' })

function db() {
  const rpcCalls: Array<[string, Record<string, unknown>]> = []
  const calls: string[] = []
  return {
    rpcCalls,
    calls,
    db: {
      from: (t: string) => (calls.push(t), {}),
      rpc: async (fn: string, args: Record<string, unknown>) => (rpcCalls.push([fn, args]), { data: [{ series_id: 's', occurrence_id: 'o', version: 1 }], error: null }),
    },
  }
}

describe('saveOneOffGuarded', () => {
  it('rejects a person of another project BEFORE any Supabase write', async () => {
    fetch.mockImplementation(async (_q: string, p: { projectSlug: string; ids: string[] }) => (p.projectSlug === 'cyce' ? [MINE] : [FOREIGN]).filter((id) => p.ids.includes(id)))
    const f = db()
    const input = { projectId: P, eventPublicId: EV, times, place: null, attendanceMode: 'inPerson' as const, expectedVersion: null, instructorPublicIds: [MINE, FOREIGN] }
    await expect(saveOneOffGuarded('cyce', input, { store: createSupabaseScheduleStore(f.db) })).rejects.toMatchObject({ name: 'ScheduleError', code: 'invalid' })
    expect(f.rpcCalls).toEqual([])
    expect(f.calls).toEqual([])
  })

  it('saves when every instructor is a person of the grant\'s project', async () => {
    fetch.mockImplementation(async (_q: string, p: { ids: string[] }) => p.ids.filter((id) => id === MINE))
    const f = db()
    const r = await saveOneOffGuarded('cyce', { projectId: P, eventPublicId: EV, times, place: null, attendanceMode: 'inPerson', expectedVersion: null, instructorPublicIds: [MINE] }, { store: createSupabaseScheduleStore(f.db) })
    expect(r).toEqual({ seriesId: 's', occurrenceId: 'o', version: 1 })
    expect(f.rpcCalls[0][1]).toMatchObject({ p_instructors: [MINE] })
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), { projectSlug: 'cyce', ids: [MINE] }, { perspective: 'raw' })
  })

  it('no instructors: nothing to check, no Sanity read', async () => {
    fetch.mockClear()
    const f = db()
    await saveOneOffGuarded('cyce', { projectId: P, eventPublicId: EV, times, place: null, attendanceMode: 'inPerson', expectedVersion: null }, { store: createSupabaseScheduleStore(f.db) })
    expect(fetch).not.toHaveBeenCalled()
    expect(f.rpcCalls).toHaveLength(1)
  })
})

describe('guardInstructors / guardInstructorOverride', () => {
  it('override null ("same as the course") and [] ("nobody") need no check; a list is checked', async () => {
    fetch.mockClear()
    await guardInstructorOverride('cyce', null)
    await guardInstructorOverride('cyce', [])
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockImplementation(async () => [])
    await expect(guardInstructorOverride('cyce', [FOREIGN])).rejects.toMatchObject({ code: 'invalid' })
  })

  it('a Sanity outage is "unavailable", never a pass; a malformed id is "invalid"', async () => {
    fetch.mockImplementation(async () => { throw new Error('down') })
    await expect(guardInstructors('cyce', [MINE])).rejects.toMatchObject({ code: 'unavailable' })
    await expect(guardInstructors('cyce', ['not-a-uuid'])).rejects.toBeInstanceOf(ScheduleError)
  })
})
