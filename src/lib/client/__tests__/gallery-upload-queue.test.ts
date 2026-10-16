import { describe, it, expect } from 'vitest'
import { MAX_FILES_PER_BATCH, nextToStart, queueIdle, queueProgress, queueReducer, type QueueItem } from '../gallery-upload-queue'

const add = (n: number, prefix = 'f') => ({
  type: 'add' as const,
  items: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix}${i}.jpg`, size: 1000 + i })),
})
const result = { assetId: 'm1', url: 'u', optimized: true, bytesBefore: 1000, bytesAfter: 400 }

describe('upload queue', () => {
  it('sends at most three at a time, in order', () => {
    let q: QueueItem[] = queueReducer([], add(5))
    expect(nextToStart(q)).toEqual(['f0', 'f1', 'f2'])
    q = queueReducer(q, { type: 'status', id: 'f0', status: 'preparing' })
    q = queueReducer(q, { type: 'status', id: 'f1', status: 'uploading' })
    expect(nextToStart(q)).toEqual(['f2'])
    q = queueReducer(q, { type: 'status', id: 'f2', status: 'uploading' })
    expect(nextToStart(q)).toEqual([])
    q = queueReducer(q, { type: 'done', id: 'f0', result })
    expect(nextToStart(q)).toEqual(['f3'])
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

describe('upload story (ADR-035)', () => {
  it('goes uploading → processing → done; processing frees a sending slot but counts toward the server cap', async () => {
    const { queueReducer: r, nextToStart: n, processingAssetIds } = await import('../gallery-upload-queue')
    let q = r([], add(7))
    for (const id of ['f0', 'f1', 'f2']) q = r(q, { type: 'status', id, status: 'uploading' })
    expect(n(q)).toEqual([])
    // The server answered for f0 and f1: their slots free up for sending…
    q = r(q, { type: 'processing', id: 'f0', assetId: 'm0' })
    q = r(q, { type: 'processing', id: 'f1', assetId: 'm1' })
    expect(processingAssetIds(q)).toEqual(['m0', 'm1'])
    // …but 2 on the server + 1 sending leaves room for one more (cap 4).
    expect(n(q)).toEqual(['f3'])
    q = r(q, { type: 'status', id: 'f3', status: 'uploading' })
    expect(n(q)).toEqual([])
    q = r(q, { type: 'done', id: 'f0', result: { assetId: 'm0', url: 'u', optimized: true, bytesBefore: 3, bytesAfter: 1 } })
    expect(processingAssetIds(q)).toEqual(['m1'])
    expect(n(q)).toEqual(['f4'])
    q = r(q, { type: 'remove', id: 'f0' })
    expect(q.map((i) => i.id)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'])
  })

  it('a retry after a processing failure sends the file again, without the old record', async () => {
    const { queueReducer: r } = await import('../gallery-upload-queue')
    let q = r([], add(1))
    q = r(q, { type: 'processing', id: 'f0', assetId: 'm0' })
    q = r(q, { type: 'fail', id: 'f0', error: 'failed' })
    q = r(q, { type: 'retry', id: 'f0' })
    expect(q[0]).toMatchObject({ status: 'waiting', assetId: undefined })
  })
})
