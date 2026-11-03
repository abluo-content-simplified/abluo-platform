/**
 * ADR-043 D9 — assertPeopleBelongToProject: every id must be a UUID and the
 * publicId of a person (published or draft) of THIS project; one opaque error
 * otherwise. Plus the private store (table missing ⇒ unavailable) and the
 * schedule-usage reader the delete check relies on.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { assertPeopleBelongToProject, PEOPLE_GUARD_QUERY } from '../persons-guard'
import { createSupabasePersonPrivateStore, isMissingPersonPrivateTable } from '../persons-private'
import { createScheduleUsage, PersonError } from '../persons-lifecycle'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const PID = '11111111-1111-4111-8111-111111111111'

/** People by project: cyce has A (published) and B (draft only); livener has C. */
const STORE: Record<string, string[]> = { cyce: [A, B], livener: [C] }
const client = () => ({
  fetch: vi.fn(async (q: string, p: Record<string, unknown>, o?: Record<string, unknown>) => {
    expect(q).toBe(PEOPLE_GUARD_QUERY)
    expect(o).toEqual({ perspective: 'raw' })
    return (STORE[p.projectSlug as string] ?? []).filter((id) => (p.ids as string[]).includes(id))
  }),
})

describe('assertPeopleBelongToProject', () => {
  it('accepts people of the project (published or draft), in any case and with repeats', async () => {
    await expect(assertPeopleBelongToProject('cyce', [A, B, A.toUpperCase()], { client: client() })).resolves.toBeUndefined()
  })

  it('accepts an empty list without reading anything', async () => {
    const c = client()
    await assertPeopleBelongToProject('cyce', [], { client: c })
    expect(c.fetch).not.toHaveBeenCalled()
  })

  it('refuses a person of another project with the same opaque error as an unknown id', async () => {
    const foreign = await assertPeopleBelongToProject('cyce', [A, C], { client: client() }).catch((e) => e)
    const unknown = await assertPeopleBelongToProject('cyce', ['00000000-0000-4000-8000-0000000000ff'], { client: client() }).catch((e) => e)
    for (const e of [foreign, unknown]) {
      expect(e).toBeInstanceOf(PersonError)
      expect(e.code).toBe('invalid_value')
    }
    expect(foreign.message).toBe(unknown.message)
  })

  it('refuses non-UUIDs before any read', async () => {
    for (const bad of ['anna', '', 'drafts.x', `${A} `, 42 as unknown as string]) {
      const c = client()
      await expect(assertPeopleBelongToProject('cyce', [bad], { client: c })).rejects.toMatchObject({ code: 'invalid_value' })
      expect(c.fetch).not.toHaveBeenCalled()
    }
    await expect(assertPeopleBelongToProject('', [A], { client: client() })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(assertPeopleBelongToProject('cyce', Array.from({ length: 201 }, () => A), { client: client() })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('the query is scoped by project and person type', () => {
    expect(PEOPLE_GUARD_QUERY).toContain('_type == "person"')
    expect(PEOPLE_GUARD_QUERY).toContain('projectSlug == $projectSlug')
  })

  it('a read failure is "failed", never a pass', async () => {
    const c = { fetch: vi.fn(async () => { throw new Error('down') }) }
    await expect(assertPeopleBelongToProject('cyce', [A], { client: c })).rejects.toMatchObject({ code: 'failed' })
  })
})

// ── Private store ─────────────────────────────────────────────────────────────

function db(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const ops: Array<[string, ...unknown[]]> = []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'update', 'delete', 'single', 'maybeSingle']) {
    chain[m] = (...a: unknown[]) => (ops.push([m, ...a]), chain)
  }
  chain.then = (res: (v: unknown) => unknown) => res({ data: result.data ?? null, error: result.error ?? null })
  return { ops, db: { from: (t: string) => (ops.push(['from', t]), chain) } }
}

describe('person_private store', () => {
  it('a missing table reads as unavailable and refuses writes', async () => {
    const missing = { code: 'PGRST205', message: "Could not find the table 'public.person_private' in the schema cache" }
    expect(isMissingPersonPrivateTable(missing)).toBe(true)
    const { db: d } = db({ error: missing })
    const store = createSupabasePersonPrivateStore(d as never)
    await expect(store.read(PID, A)).resolves.toEqual({ available: false })
    await expect(store.save(PID, A, { notes: 'x' }, null)).rejects.toMatchObject({ code: 'private_unavailable' })
    await expect(store.remove(PID, A)).resolves.toBe(false)
  })

  it('every call is scoped by project and person', async () => {
    const { db: d, ops } = db({ data: { contacts: [{ _key: 'k', kind: 'phone', value: '+39', label: '', preferred: false }, { bad: true }], birthday: '1980-02-03', notes: null, version: 2 } })
    const store = createSupabasePersonPrivateStore(d as never)
    const r = await store.read(PID, A)
    expect(r).toEqual({ available: true, row: { contacts: [{ _key: 'k', kind: 'phone', value: '+39', label: '', preferred: false }], birthday: '1980-02-03', notes: null, version: 2, updatedAt: null } })
    expect(ops).toContainEqual(['eq', 'project_id', PID])
    expect(ops).toContainEqual(['eq', 'person_public_id', A])
  })

  it('an update names the version it read; no row back = conflict', async () => {
    const { db: d, ops } = db({ data: [] })
    const store = createSupabasePersonPrivateStore(d as never)
    await expect(store.save(PID, A, { notes: 'x' }, 3)).rejects.toMatchObject({ code: 'conflict' })
    expect(ops).toContainEqual(['eq', 'version', 3])
    await expect(store.read('not-a-uuid', A)).rejects.toMatchObject({ code: 'not_found' })
  })
})

// ── Schedule usage ────────────────────────────────────────────────────────────

describe('schedule usage (instructors by publicId)', () => {
  function sdb(series: unknown[], sessions: unknown[], error: { code?: string } | null = null) {
    const make = (data: unknown[]) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'not', 'limit']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => unknown) => res({ data: error ? null : data, error })
      return chain
    }
    return { from: (t: string) => make(t === 'event_series' ? series : sessions) }
  }

  it('counts series and session overrides naming each wanted person', async () => {
    const usage = createScheduleUsage(sdb([{ instructor_public_ids: [A, B] }, { instructor_public_ids: [] }], [{ instructor_override: [A] }]) as never)
    const m = await usage(PID, [A, C])
    expect(m?.get(A)).toBe(2)
    expect(m?.get(C)).toBeUndefined()
  })

  it('missing tables count as none; any other error is null (callers refuse)', async () => {
    expect(await createScheduleUsage(sdb([], [], { code: '42P01' }) as never)(PID, [A])).toEqual(new Map())
    expect(await createScheduleUsage(sdb([], [], { code: 'XX000' }) as never)(PID, [A])).toBeNull()
  })
})
