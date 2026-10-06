import { describe, it, expect } from 'vitest'
import { MAX_FILES_PER_BATCH, nextToStart, queueIdle, queueProgress, queueReducer, type QueueItem } from '../gallery-upload-queue'

const add = (n: number, prefix = 'f') => ({
  type: 'add' as const,
  items: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}.jpg`, size: 1000 + i })),
})
const result = { assetId: 'm1', url: 'u', optimized: true, bytesBefore: 1000, bytesAfter: 400 }

describe('upload queue', () => {
  it('starts at most two at a time, in order', () => {
    let q: QueueItem[] = queueReducer([], add(4))
    expect(nextToStart(q)).toEqual(['f0', 'f1'])
    q = queueReducer(q, { type: 'status', id: 'f0', status: 'preparing' })
    expect(nextToStart(q)).toEqual(['f1'])
    q = queueReducer(q, { type: 'status', id: 'f1', status: 'uploading' })
    expect(nextToStart(q)).toEqual([])
    q = queueReducer(q, { type: 'done', id: 'f0', result })
    expect(nextToStart(q)).toEqual(['f2'])
  })

  it('tracks progress, failures, retries and idleness', () => {
    let q = queueReducer([], add(2))
    expect(queueIdle(q)).toBe(false)
    q = queueReducer(q, { type: 'status', id: 'f0', status: 'uploading' })
    expect(queueProgress(q[0])).toBeGreaterThan(0)
    q = queueReducer(q, { type: 'fail', id: 'f0', error: 'too_large' })
    q = queueReducer(q, { type: 'done', id: 'f1', result })
    expect(q[0]).toMatchObject({ status: 'error', error: 'too_large' })
    expect(queueIdle(q)).toBe(true)
    q = queueReducer(q, { type: 'retry', id: 'f0' })
    expect(q[0]).toMatchObject({ status: 'waiting', error: undefined })
    q = queueReducer(q, { type: 'clearFinished' })
    expect(q.map((i) => i.id)).toEqual(['f0'])
  })

  it('never re-adds a known file and caps a batch', () => {
    let q = queueReducer([], add(2))
    q = queueReducer(q, add(2))
    expect(q).toHaveLength(2)
    q = queueReducer([], add(MAX_FILES_PER_BATCH + 10, 'x'))
    expect(q).toHaveLength(MAX_FILES_PER_BATCH)
  })

  it('a finished item is not reset by a late status', () => {
    let q = queueReducer([], add(1))
    q = queueReducer(q, { type: 'done', id: 'f0', result })
    q = queueReducer(q, { type: 'status', id: 'f0', status: 'uploading' })
    expect(q[0].status).toBe('done')
  })
})

describe('upload story', () => {
  it('goes uploading → compressing → done, and a finished row can be removed', async () => {
    const { queueReducer: r, nextToStart: n, uploadEstimateMs } = await import('../gallery-upload-queue')
    let q = r([], { type: 'add', items: [{ id: 'a', name: 'a.jpg', size: 3_000_000 }, { id: 'b', name: 'b.jpg', size: 10 }, { id: 'c', name: 'c.jpg', size: 10 }] })
    q = r(q, { type: 'status', id: 'a', status: 'uploading' })
    q = r(q, { type: 'status', id: 'a', status: 'compressing' })
    q = r(q, { type: 'status', id: 'b', status: 'compressing' })
    expect(n(q)).toEqual([]) // compressing still counts as busy
    q = r(q, { type: 'done', id: 'a', result: { assetId: 'm', url: 'u', optimized: true, bytesBefore: 3, bytesAfter: 1 } })
    expect(n(q)).toEqual(['c'])
    q = r(q, { type: 'remove', id: 'a' })
    expect(q.map((i) => i.id)).toEqual(['b', 'c'])
    expect(uploadEstimateMs(10)).toBe(600)
    expect(uploadEstimateMs(3_000_000)).toBe(2000)
  })
})
