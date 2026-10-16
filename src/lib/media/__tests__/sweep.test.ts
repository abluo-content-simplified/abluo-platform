import { describe, expect, it, vi } from 'vitest'
import { sweepMediaUploads } from '../sweep'

describe('sweepMediaUploads (ADR-035 slice 2)', () => {
  it('marks stuck uploads failed and deletes old unreferenced failed placeholders', async () => {
    const sets: Array<[string, Record<string, unknown>]> = []
    const client = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the signature the sweep calls
      fetch: vi.fn(async (query: string, params: Record<string, unknown>) => (query.includes('"processing"') ? ['stuck-1', 'stuck-2'] : ['old-failed'])),
      patch: vi.fn((id: string) => ({ set: (v: Record<string, unknown>) => ({ commit: async () => void sets.push([id, v]) }) })),
      delete: vi.fn(async () => ({})),
    }
    const now = new Date('2026-10-16T05:45:00Z')
    const r = await sweepMediaUploads(client as never, now)
    expect(r).toEqual({ markedFailed: 2, deleted: 1 })
    expect(sets[0]).toEqual(['stuck-1', { 'processing.status': 'failed', 'processing.finishedAt': now.toISOString() }])
    expect(client.delete).toHaveBeenCalledWith('old-failed')
    // Cut-offs: one hour for stuck, a week for deletion; deletion only without references and without an image.
    expect(client.fetch.mock.calls[0][1]).toEqual({ before: '2026-10-16T04:45:00.000Z' })
    expect(client.fetch.mock.calls[1][1]).toEqual({ before: '2026-10-09T05:45:00.000Z' })
    expect(client.fetch.mock.calls[1][0]).toContain('count(*[references(^._id)]) == 0')
    expect(client.fetch.mock.calls[1][0]).toContain('!defined(image.asset)')
  })
})
