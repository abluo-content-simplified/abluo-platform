/**
 * Lazy creation must not orphan the journal (the lost German/Italian edits,
 * 2026-10-06), a network outage must never lose pending fields, and one value
 * the server refuses must never block every later save.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { createAutosave, type SendResult } from '../engine'
import { createMemoryJournal, type PendingSet } from '../journal'

const tick = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('journal re-key on lazy creation', () => {
  it('memory journal rekey() moves the entry and merges over an existing one', async () => {
    const j = createMemoryJournal({ tmp: { 'title.de': 'Hallo' }, real: { 'title.en': 'Hi', 'title.de': 'old' } })
    await j.rekey!('tmp', 'real')
    expect(j.entries.has('tmp')).toBe(false)
    expect(j.entries.get('real')).toEqual({ 'title.en': 'Hi', 'title.de': 'Hallo' })
  })

  it('temp key → create → rekey → a reopen with the real id replays the unsaved fields', async () => {
    const storage = createMemoryJournal()
    let draftId = ''
    let online = true
    let engine: ReturnType<typeof createAutosave> | null = null
    const send = async (input: { rev: string; set: PendingSet }): Promise<SendResult> => {
      if (!draftId) {
        draftId = 'post-123'
        await engine!.rekey(draftId)
        return { ok: true, rev: 'r1' }
      }
      if (!online) throw new Error('fetch failed')
      return { ok: true, rev: `${input.rev}+` }
    }
    engine = createAutosave({ draftId: 'new-post:abc', rev: '', send, storage })

    engine.set({ 'title.en': 'Hello' })
    await tick(800)
    expect(engine.key).toBe('post-123')
    expect(engine.state).toBe('saved')

    // The dev server goes away; Tom keeps writing the translations.
    online = false
    engine.set({ 'title.de': 'Hallo', 'body.it': [{ _type: 'block' }], gallery: 'g1' })
    await tick(800)
    expect(engine.state).toBe('offline')
    expect(storage.entries.has('new-post:abc')).toBe(false)
    expect(storage.entries.get('post-123')).toEqual({ 'title.de': 'Hallo', 'body.it': [{ _type: 'block' }], gallery: 'g1' })
    engine.dispose()

    // Reopen /posts/write/post-123: the journal is found under the real id and replayed.
    online = true
    const calls: PendingSet[] = []
    const reopened = createAutosave({
      draftId: 'post-123',
      rev: 'r1',
      storage,
      send: async (i) => (calls.push(i.set), { ok: true, rev: 'r9' }),
    })
    expect(await reopened.replay()).toEqual({ 'title.de': 'Hallo', 'body.it': [{ _type: 'block' }], gallery: 'g1' })
    await tick(0)
    expect(calls).toEqual([{ 'title.de': 'Hallo', 'body.it': [{ _type: 'block' }], gallery: 'g1' }])
    expect(storage.entries.has('post-123')).toBe(false)
  })

  it('entries written under the temp key before creation move with the rekey', async () => {
    const storage = createMemoryJournal()
    const engine = createAutosave({ draftId: 'new-post:t', rev: '', storage, send: () => new Promise(() => undefined) })
    engine.set({ 'title.en': 'A' })
    await tick(0)
    expect(storage.entries.get('new-post:t')).toEqual({ 'title.en': 'A' })
    await engine.rekey('post-9')
    expect(storage.entries.has('new-post:t')).toBe(false)
    expect(storage.entries.get('post-9')).toEqual({ 'title.en': 'A' })
    engine.set({ 'title.de': 'B' })
    await tick(0)
    expect(storage.entries.get('post-9')).toEqual({ 'title.en': 'A', 'title.de': 'B' })
    expect(storage.entries.has('new-post:t')).toBe(false)
  })
})

describe('network errors', () => {
  it('keeps retrying without losing pending fields, then saves them once reconnected', async () => {
    let online = false
    const sent: PendingSet[] = []
    const storage = createMemoryJournal()
    const a = createAutosave({
      draftId: 'd',
      rev: 'r1',
      storage,
      retryDelaysMs: [1000],
      send: async (i) => {
        if (!online) throw new Error('ECONNREFUSED')
        sent.push(i.set)
        return { ok: true, rev: 'r2' }
      },
    })
    a.set({ 'title.it': 'Ciao' })
    await tick(800)
    a.set({ 'title.de': 'Hallo' })
    for (let i = 0; i < 5; i++) await tick(1000)
    expect(a.state).toBe('offline')
    expect(a.pending).toEqual({ 'title.it': 'Ciao', 'title.de': 'Hallo' })
    expect(storage.entries.get('d')).toEqual({ 'title.it': 'Ciao', 'title.de': 'Hallo' })

    online = true
    await tick(1000)
    expect(a.state).toBe('saved')
    expect(sent).toEqual([{ 'title.it': 'Ciao', 'title.de': 'Hallo' }])
    expect(storage.entries.has('d')).toBe(false)
  })
})

describe('a value the server refuses', () => {
  it('isolates the bad field, saves the rest, reports it, and keeps saving later typing', async () => {
    const sent: PendingSet[] = []
    const rejectedSeen: string[][] = []
    let n = 1
    const a = createAutosave({
      draftId: 'd',
      rev: 'r1',
      storage: createMemoryJournal(),
      onRejected: (p) => rejectedSeen.push(p),
      send: async (i) => {
        if ('gallery' in i.set) return { ok: false, error: 'invalid_value' }
        sent.push(i.set)
        return { ok: true, rev: `r${++n}` }
      },
    })
    a.set({ 'title.de': 'Hallo', gallery: 'not-a-gallery', 'body.it': 'x' })
    await tick(800)
    expect(a.state).toBe('saved')
    expect(sent).toEqual([{ 'title.de': 'Hallo' }, { 'body.it': 'x' }])
    expect(a.rejected).toEqual(['gallery'])
    expect(rejectedSeen.at(-1)).toEqual(['gallery'])

    a.set({ 'title.it': 'Ciao' })
    await tick(800)
    expect(sent.at(-1)).toEqual({ 'title.it': 'Ciao' })
    expect(a.state).toBe('saved')

    // Choosing another gallery clears the error for that field.
    a.set({ gallery: 'still-bad' })
    expect(a.rejected).toEqual([])
    await tick(800)
    expect(a.rejected).toEqual(['gallery'])
  })
})
