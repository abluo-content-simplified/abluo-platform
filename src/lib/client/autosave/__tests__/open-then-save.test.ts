/** openThenSave — the shared send of draft-based editors (Digital Cards false "Edited elsewhere", 2026-11-09). */
import { describe, expect, it, vi } from 'vitest'
import { openThenSave } from '../open-then-save'

function draftOf(has: boolean, save: (rev: string) => Promise<{ ok: true; rev: string } | { ok: false; error: string }>) {
  const state = { has }
  return {
    state,
    open: vi.fn(async () => ({ ok: true as const, rev: 'opened' })),
    save: vi.fn(save),
    hasDraft: () => state.has,
    markDraft: () => (state.has = true),
  }
}

describe('openThenSave', () => {
  it('no draft: opens it, saves against the opened revision', async () => {
    const d = draftOf(false, async (rev) => ({ ok: true, rev: `${rev}+1` }))
    expect(await openThenSave({ rev: 'stale', set: { a: 1 } }, d)).toEqual({ ok: true, rev: 'opened+1' })
    expect(d.save).toHaveBeenCalledWith('opened', { a: 1 })
    expect(d.state.has).toBe(true)
  })

  it('a refused save after the open reports the OPENED revision (the engine retries against it)', async () => {
    const d = draftOf(false, async () => ({ ok: false, error: 'invalid_value' }))
    expect(await openThenSave({ rev: 'stale', set: { a: 1 } }, d)).toEqual({ ok: false, error: 'invalid_value', rev: 'opened' })
  })

  it('a network failure after the open is a refusal with the opened revision (not a throw)', async () => {
    const d = draftOf(false, async () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await openThenSave({ rev: '', set: { a: 1 } }, d)).toEqual({ ok: false, error: 'network', rev: 'opened' })
  })

  it('draft already open: no open, failures carry no revision, network failures still throw', async () => {
    const d = draftOf(true, async () => ({ ok: false, error: 'conflict' }))
    expect(await openThenSave({ rev: 'r5', set: { a: 1 } }, d)).toEqual({ ok: false, error: 'conflict' })
    expect(d.open).not.toHaveBeenCalled()
    const n = draftOf(true, async () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(openThenSave({ rev: 'r5', set: { a: 1 } }, n)).rejects.toThrow('Failed to fetch')
  })

  it('a refused open is reported as is', async () => {
    const d = draftOf(false, async () => ({ ok: true, rev: 'x' }))
    d.open.mockResolvedValueOnce({ ok: false, error: 'archived' } as never)
    expect(await openThenSave({ rev: '', set: { a: 1 } }, d)).toEqual({ ok: false, error: 'archived' })
    expect(d.save).not.toHaveBeenCalled()
  })
})
