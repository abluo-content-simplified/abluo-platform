/**
 * ADR-025 D1/D2 — the autosave engine. Fake timers + in-memory journal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPatch, createAutosave, type SendResult } from '../engine'
import { createMemoryJournal } from '../journal'

type Call = { rev: string; set: Record<string, unknown> }

function harness(results: Array<SendResult | Error | 'hang'> = []) {
  const calls: Call[] = []
  const states: string[] = []
  let n = 0
  let release: (() => void) | null = null
  const send = vi.fn(async (input: Call) => {
    calls.push({ rev: input.rev, set: { ...input.set } })
    const r = results[calls.length - 1] ?? { ok: true as const, rev: `r${++n + 1}` }
    if (r === 'hang') {
      await new Promise<void>((res) => (release = res))
      return { ok: true as const, rev: 'after-hang' }
    }
    if (r instanceof Error) throw r
    return r
  })
  const storage = createMemoryJournal()
  const a = createAutosave({ draftId: 'd1', rev: 'r1', send, storage, onState: (s) => states.push(s) })
  return { a, calls, states, storage, send, release: () => release?.() }
}

const tick = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('autosave engine', () => {
  it('debounces 800 ms and merges queued paths into one request (latest value wins)', async () => {
    const h = harness()
    h.a.set({ 'title.en': 'H' })
    await tick(500)
    h.a.set({ 'title.en': 'Hello', 'subtitle.en': 'Sub' })
    await tick(799)
    expect(h.calls).toHaveLength(0)
    expect(h.a.state).toBe('saving')
    await tick(1)
    expect(h.calls).toEqual([{ rev: 'r1', set: { 'title.en': 'Hello', 'subtitle.en': 'Sub' } }])
    expect(h.a.state).toBe('saved')
    expect(h.a.rev).toBe('r2')
  })

  it('keeps one request in flight; edits made meanwhile go next with the NEW rev', async () => {
    const h = harness(['hang'])
    h.a.set({ 'title.en': 'A' })
    await tick(800)
    expect(h.calls).toHaveLength(1)
    h.a.set({ 'title.en': 'AB' })
    await tick(5000)
    expect(h.calls).toHaveLength(1) // still waiting on the first
    h.release()
    await tick(0)
    await tick(800)
    expect(h.calls[1]).toEqual({ rev: 'after-hang', set: { 'title.en': 'AB' } })
    expect(h.a.state).toBe('saved')
  })

  it('journals pending paths at once and clears the journal after confirmation', async () => {
    const h = harness()
    h.a.set({ 'body.en': [1] })
    await tick(0)
    expect(h.storage.entries.get('d1')).toEqual({ 'body.en': [1] })
    await tick(800)
    expect(h.storage.entries.has('d1')).toBe(false)
  })

  it('a network error → offline, the batch is kept, retried with backoff, then saved', async () => {
    const h = harness([new Error('fetch failed'), { ok: false, error: 'failed' }])
    h.a.set({ 'title.en': 'X' })
    await tick(800)
    expect(h.a.state).toBe('offline')
    expect(h.storage.entries.get('d1')).toEqual({ 'title.en': 'X' })
    await tick(999)
    expect(h.calls).toHaveLength(1)
    await tick(1)
    expect(h.calls).toHaveLength(2) // first retry after 1 s, fails again
    expect(h.a.state).toBe('offline')
    await tick(2000) // second delay is 2 s
    expect(h.calls).toHaveLength(3)
    expect(h.calls[2]).toEqual({ rev: 'r1', set: { 'title.en': 'X' } })
    expect(h.a.state).toBe('saved')
    expect(h.storage.entries.has('d1')).toBe(false)
  })

  it('typing while offline is merged on top of the failed batch', async () => {
    const h = harness([new Error('offline')])
    h.a.set({ 'title.en': 'X', 'subtitle.en': 'S' })
    await tick(800)
    h.a.set({ 'title.en': 'XY' })
    expect(h.storage.entries.get('d1')).toEqual({ 'title.en': 'XY', 'subtitle.en': 'S' })
    await tick(1000)
    expect(h.calls.at(-1)?.set).toEqual({ 'title.en': 'XY', 'subtitle.en': 'S' })
  })

  it('a conflict stops saving ("edited elsewhere"), keeps the change and never retries', async () => {
    const h = harness([{ ok: false, error: 'conflict' }])
    h.a.set({ 'title.en': 'Mine' })
    await tick(800)
    expect(h.a.state).toBe('conflict')
    h.a.set({ 'title.en': 'Mine 2' })
    await tick(60_000)
    expect(h.calls).toHaveLength(1)
    expect(h.a.pending).toEqual({ 'title.en': 'Mine 2' })
    expect(await h.a.flush()).toBe(false)
    await h.a.discard()
    expect(h.storage.entries.has('d1')).toBe(false)
  })

  it('a refusal other than failed/conflict stops with "error" and keeps the journal', async () => {
    const h = harness([{ ok: false, error: 'invalid_value' }])
    h.a.set({ 'title.en': 'x' })
    await tick(800)
    expect(h.a.state).toBe('error')
    expect(h.storage.entries.get('d1')).toEqual({ 'title.en': 'x' })
  })

  it('flush() sends immediately and resolves once confirmed', async () => {
    const h = harness()
    h.a.set({ 'title.en': 'Now' })
    const ok = await h.a.flush()
    expect(ok).toBe(true)
    expect(h.calls).toEqual([{ rev: 'r1', set: { 'title.en': 'Now' } }])
    await tick(5000)
    expect(h.calls).toHaveLength(1) // the debounce timer was cancelled
  })

  it('flush() waits for the request in flight and the follow-up', async () => {
    const h = harness(['hang'])
    h.a.set({ a: 1 })
    await tick(800)
    h.a.set({ b: 2 })
    const done = h.a.flush()
    h.release()
    expect(await done).toBe(true)
    expect(h.calls.map((c) => c.set)).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('flush() reports false when offline', async () => {
    const h = harness([new Error('net')])
    h.a.set({ a: 1 })
    expect(await h.a.flush()).toBe(false)
    expect(h.a.state).toBe('offline')
  })

  it('replay() returns the journal (for the UI to apply first) and sends it', async () => {
    const calls: Call[] = []
    const storage = createMemoryJournal({ d1: { 'title.en': 'From before the crash' } })
    const a = createAutosave({
      draftId: 'd1',
      rev: 'r5',
      storage,
      send: async (i) => (calls.push(i), { ok: true, rev: 'r6' }),
    })
    expect(await a.replay()).toEqual({ 'title.en': 'From before the crash' })
    await tick(0)
    expect(calls).toEqual([{ rev: 'r5', set: { 'title.en': 'From before the crash' } }])
    expect(storage.entries.has('d1')).toBe(false)
  })

  it('replay() with nothing journaled (or a broken storage) is a no-op', async () => {
    const broken = { load: async () => Promise.reject(new Error('blocked')), save: async () => {}, clear: async () => {} }
    const a = createAutosave({ draftId: 'd1', rev: 'r', storage: broken, send: async () => ({ ok: true, rev: 'x' }) })
    expect(await a.replay()).toBeNull()
    expect(a.state).toBe('idle')
  })

  it('retryNow() skips the backoff wait', async () => {
    const h = harness([new Error('net')])
    h.a.set({ a: 1 })
    await tick(800)
    expect(h.a.state).toBe('offline')
    h.a.retryNow()
    await tick(0)
    expect(h.calls).toHaveLength(2)
    expect(h.a.state).toBe('saved')
  })

  it('a storage that throws never breaks saving', async () => {
    const storage = { load: async () => null, save: () => Promise.reject(new Error('quota')), clear: () => Promise.reject(new Error('x')) }
    const a = createAutosave({ draftId: 'd', rev: 'r', storage, send: async () => ({ ok: true, rev: 'r2' }) })
    a.set({ a: 1 })
    await tick(800)
    expect(a.state).toBe('saved')
  })
})

describe('applyPatch', () => {
  it('sets dotted paths immutably', () => {
    const src = { title: { en: 'a' }, categories: ['x'] }
    const out = applyPatch(src, { 'title.it': 'b', categories: [], 'wizard.step': 'story' })
    expect(out).toEqual({ title: { en: 'a', it: 'b' }, categories: [], wizard: { step: 'story' } })
    expect(src.title).toEqual({ en: 'a' })
  })
})
