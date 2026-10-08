import { describe, expect, it } from 'vitest'
import { readAllRows, readAllRowsOrThrow, SUPABASE_PAGE_SIZE } from '../read-all'

/** A fake PostgREST: `total` rows, answers `.range(from, to)` but never more than `maxRows` per request. */
function fakeTable(total: number, maxRows = SUPABASE_PAGE_SIZE) {
  const calls: [number, number][] = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    const end = Math.min(to + 1, total, from + maxRows)
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null }
  }
  return { page, calls }
}

describe('readAllRows', () => {
  it('reads past the 1000-row cap', async () => {
    const t = fakeTable(2500)
    const r = await readAllRows(t.page)
    expect(r.rows).toHaveLength(2500)
    expect(r.rows.at(-1)).toBe(2499)
    expect(r).toMatchObject({ error: null, capped: false })
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('a full last page costs one more (empty) request, never a wrong count', async () => {
    const t = fakeTable(2000)
    const r = await readAllRows(t.page)
    expect(r.rows).toHaveLength(2000)
    expect(t.calls).toHaveLength(3)
  })

  it('reads an empty table in one request', async () => {
    const t = fakeTable(0)
    expect((await readAllRows(t.page)).rows).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  it('stops at maxRows and says so', async () => {
    const t = fakeTable(5000)
    const r = await readAllRows(t.page, { maxRows: 1500 })
    expect(r.rows).toHaveLength(1500)
    expect(r.capped).toBe(true)
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1499],
    ])
  })

  it('returns what it read and the error when a page fails', async () => {
    let n = 0
    const r = await readAllRows(async () =>
      n++ === 0 ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null } : { data: null, error: { message: 'boom', code: '500' } },
    )
    expect(r.rows).toHaveLength(1000)
    expect(r.error).toEqual({ message: 'boom', code: '500' })
    await expect(readAllRowsOrThrow('things', async () => ({ data: null, error: { message: 'nope' } }))).rejects.toThrow('things: nope')
  })
})
