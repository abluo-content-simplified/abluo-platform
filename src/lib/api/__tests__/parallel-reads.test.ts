import { describe, expect, it } from 'vitest'
import { readsInOrder } from '../parallel-reads'

const later = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const failLater = (ms: number, e: string) => new Promise<never>((_, j) => setTimeout(() => j(new Error(e)), ms))

describe('readsInOrder', () => {
  it('runs reads at the same time and returns results in the given order', async () => {
    const t0 = Date.now()
    const [a, b, c] = await readsInOrder<[number, string, boolean]>([later(60, 1), later(60, 'x'), later(60, true)])
    expect([a, b, c]).toEqual([1, 'x', true])
    expect(Date.now() - t0).toBeLessThan(150)
  })
  it('rethrows the first failure in the given order, not the first to fail in time', async () => {
    await expect(readsInOrder([failLater(50, 'first'), failLater(5, 'second')])).rejects.toThrow('first')
  })
  it('waits for every read before throwing (no unobserved rejection)', async () => {
    let done = false
    await expect(readsInOrder([failLater(1, 'boom'), later(40, 1).then(() => (done = true))])).rejects.toThrow('boom')
    expect(done).toBe(true)
  })
})
