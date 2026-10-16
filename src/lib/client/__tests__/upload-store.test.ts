import { describe, expect, it, vi } from 'vitest'
import { UploadStore, type UploadApi } from '../upload-store'

const photo = (assetId: string) => ({ assetId, url: `https://cdn/${assetId}.jpg`, name: assetId, optimized: true, bytesBefore: 1000, bytesAfter: 300 })
const file = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/jpeg' })
const tick = () => new Promise((r) => setTimeout(r, 0))

function harness(statusOf: (assetId: string) => 'processing' | 'ready' | 'failed' = () => 'ready') {
  let n = 0
  const timers: Array<() => void> = []
  const api: UploadApi = {
    upload: vi.fn(async () => ({ ok: true as const, status: 'processing' as const, ...photo(`m${++n}`), url: '' })),
    status: vi.fn(async (_scope, { assetIds }) => ({ ok: true as const, items: assetIds.map((id: string) => ({ ...photo(id), status: statusOf(id) })) })),
  }
  let clock = 0
  const store = new UploadStore({
    api,
    prepare: async (f) => f,
    now: () => clock,
    setTimer: (fn) => {
      timers.push(fn)
      return timers.length
    },
  })
  /** Run every timer queued so far (polls, linger removals). */
  const fire = async () => {
    const due = timers.splice(0)
    for (const fn of due) fn()
    await tick()
    await tick()
  }
  return { store, api, fire, advance: (ms: number) => (clock += ms) }
}

const meta = (owner: string) => ({ owner, projectSlug: 'hoffmann', scope: 'media' as const })

describe('UploadStore (ADR-035 slice 2)', () => {
  it('sends in the background, polls, and hands the ready photo to its screen', async () => {
    const h = harness()
    const landed = vi.fn()
    h.store.listen('screen-a', { onLanded: landed })
    h.store.enqueue([file('a.jpg')], meta('screen-a'))
    await tick()
    await tick()
    expect((h.api.upload as ReturnType<typeof vi.fn>).mock.calls[0][1].get('background')).toBe('1')
    expect(h.store.getSnapshot()[0]).toMatchObject({ status: 'processing', assetId: 'm1' })
    expect(h.store.inFlight('screen-a')).toBe(1)
    await h.fire() // poll
    expect(landed).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'm1', url: 'https://cdn/m1.jpg' }), expect.any(String))
    expect(h.store.inFlight()).toBe(0)
  })

  it('a photo whose screen is gone stays in the library and is counted', async () => {
    const h = harness()
    const off = h.store.listen('screen-a', { onLanded: vi.fn() })
    h.store.enqueue([file('a.jpg')], meta('screen-a'))
    await tick()
    await tick()
    off() // the person moved on
    await h.fire()
    expect(h.store.getOrphanLanded()).toBe(1)
    h.store.clearOrphanLanded()
    expect(h.store.getOrphanLanded()).toBe(0)
  })

  it('the fallback (a wizard) receives photos once the Add Photos block is gone, never both', async () => {
    const h = harness()
    const primary = vi.fn()
    const fallback = vi.fn()
    h.store.listen('item-1', { onLanded: fallback }, 'fallback')
    const off = h.store.listen('item-1', { onLanded: primary })
    h.store.enqueue([file('a.jpg'), file('b.jpg')], meta('item-1'))
    await tick()
    await tick()
    await h.fire()
    expect(primary).toHaveBeenCalledTimes(2)
    expect(fallback).not.toHaveBeenCalled()

    h.store.enqueue([file('c.jpg')], meta('item-1'))
    await tick()
    await tick()
    off() // next wizard step
    await h.fire()
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(primary).toHaveBeenCalledTimes(2)
  })

  it('reports failure (and lets Retry send the file again)', async () => {
    const h = harness(() => 'failed')
    const settled = vi.fn()
    h.store.listen('s', { onLanded: vi.fn(), onSettled: settled })
    const [id] = h.store.enqueue([file('a.jpg')], meta('s'))
    await tick()
    await tick()
    await h.fire()
    expect(h.store.getSnapshot()[0]).toMatchObject({ status: 'error', error: 'failed' })
    expect(settled).toHaveBeenCalledWith(id, null)
    h.store.retry(id)
    await tick()
    await tick()
    expect(h.api.upload).toHaveBeenCalledTimes(2)
  })

  it('gives up on a record that stays processing too long', async () => {
    const h = harness(() => 'processing')
    h.store.listen('s', { onLanded: vi.fn() })
    h.store.enqueue([file('a.jpg')], meta('s'))
    await tick()
    await tick()
    await h.fire()
    expect(h.store.getSnapshot()[0].status).toBe('processing')
    h.advance(2 * 60 * 1000 + 1)
    await h.fire()
    expect(h.store.getSnapshot()[0].status).toBe('error')
  })

  it('knows when bytes are still only in this tab', async () => {
    const h = harness()
    h.store.enqueue([file('a.jpg')], meta('s'))
    expect(h.store.unsent()).toBe(true)
    await tick()
    await tick()
    expect(h.store.unsent()).toBe(false) // on the server now (processing)
  })
})
