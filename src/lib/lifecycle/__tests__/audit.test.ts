import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { audited, CONTENT_AUDIT_LOG_TAG, dashboardActor, isDashboardTransactionId, newDashboardTransactionId, recordContentActivity, toRow, type ContentAuditEntry } from '../audit'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

const entry = (o: Partial<ContentAuditEntry> = {}): ContentAuditEntry => ({
  projectId: 'p1',
  contentType: 'post',
  contentId: 'post-1',
  action: 'published',
  actorKind: 'user',
  actorId: 'u1',
  outcome: 'ok',
  transactionId: 'abluo-dash-x',
  ...o,
})

function fakeDb(results: Array<{ error: { message: string; code?: string } | null } | Error>) {
  const inserted: Record<string, unknown>[] = []
  let i = 0
  const db = {
    from: vi.fn(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserted.push(row)
        const r = results[Math.min(i++, results.length - 1)]
        if (r instanceof Error) throw r
        return r
      }),
    })),
  }
  return { db, inserted }
}

describe('transaction ids', () => {
  it('are prefixed, unique, and recognisable', () => {
    const a = newDashboardTransactionId()
    expect(a).toMatch(/^abluo-dash-[0-9a-f-]{36}$/)
    expect(newDashboardTransactionId()).not.toBe(a)
    expect(isDashboardTransactionId(a)).toBe(true)
    expect(isDashboardTransactionId('w3lFHGU9067C4GvOcGcdnU')).toBe(false)
  })
})

describe('the row', () => {
  it('maps to the 041 columns and holds no content', () => {
    expect(toRow(entry({ detail: { state: null } }))).toEqual({
      project_id: 'p1',
      content_type: 'post',
      content_id: 'post-1',
      action: 'published',
      actor_kind: 'user',
      actor_id: 'u1',
      outcome: 'ok',
      sanity_transaction_id: 'abluo-dash-x',
      detail: { state: null },
    })
  })
  it('support mode is flagged, never hidden', () => {
    expect(dashboardActor({ userId: 'admin-1', support: { sessionId: 's' } as never })).toEqual({ actorKind: 'user', actorId: 'admin-1', detail: { support: true } })
    expect(dashboardActor({ userId: 'u1' })).toEqual({ actorKind: 'user', actorId: 'u1', detail: {} })
  })
})

describe('recordContentActivity — best-effort, never silent', () => {
  it('writes once on success', async () => {
    const { db, inserted } = fakeDb([{ error: null }])
    await recordContentActivity(entry(), { db })
    expect(inserted).toHaveLength(1)
  })
  it('a duplicate of the same transaction is already recorded — not an error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, inserted } = fakeDb([{ error: { message: 'dup', code: '23505' } }])
    await recordContentActivity(entry(), { db })
    expect(inserted).toHaveLength(1)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('retries once, then logs with the tag — and never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, inserted } = fakeDb([{ error: { message: 'down' } }, new Error('still down')])
    await expect(recordContentActivity(entry(), { db })).resolves.toBeUndefined()
    expect(inserted).toHaveLength(2)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toContain(CONTENT_AUDIT_LOG_TAG)
    expect(String(spy.mock.calls[0][0])).toContain('post/post-1 published (ok) txn=abluo-dash-x')
    spy.mockRestore()
  })
  it('a retry that succeeds logs nothing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, inserted } = fakeDb([{ error: { message: 'blip' } }, { error: null }])
    await recordContentActivity(entry(), { db })
    expect(inserted).toHaveLength(2)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('audited()', () => {
  const ctx = { userId: 'u1' }
  const spec = (writer: (e: ContentAuditEntry) => Promise<void>, o: Partial<{ contentId: string | null }> = {}) => ({
    ctx,
    projectId: 'p1',
    contentType: 'post',
    contentId: 'post-1',
    intended: 'unpublished' as const,
    writer,
    ...o,
  })

  it('records the resulting action with the transaction the write used', async () => {
    const rows: ContentAuditEntry[] = []
    let used = ''
    const v = await audited(spec(async (e) => void rows.push(e)), async (txn) => {
      used = txn
      return { value: 42, action: 'unpublished', state: { publishedAt: 'a', expiresAt: 'b', archivedAt: null } }
    })
    expect(v).toBe(42)
    expect(rows).toEqual([
      expect.objectContaining({ action: 'unpublished', outcome: 'ok', actorKind: 'user', actorId: 'u1', transactionId: used, detail: { state: { publishedAt: 'a', expiresAt: 'b', archivedAt: null } } }),
    ])
    expect(used).toMatch(/^abluo-dash-/)
  })

  it('records nothing when the call changed nothing lifecycle-relevant', async () => {
    const rows: ContentAuditEntry[] = []
    await audited(spec(async (e) => void rows.push(e)), async () => ({ value: 1, action: null }))
    expect(rows).toEqual([])
  })

  it('a refusal is recorded as refused (no transaction) and re-thrown unchanged', async () => {
    const rows: ContentAuditEntry[] = []
    const err = Object.assign(new Error('nope'), { code: 'conflict' })
    await expect(audited(spec(async (e) => void rows.push(e)), async () => { throw err })).rejects.toBe(err)
    expect(rows).toEqual([expect.objectContaining({ action: 'unpublished', outcome: 'refused', transactionId: null, detail: { code: 'conflict' } })])
  })

  it('a permission refusal is refused', async () => {
    const rows: ContentAuditEntry[] = []
    await expect(audited(spec(async (e) => void rows.push(e)), async () => { throw new TenantAuthorizationError('no') })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(rows[0].outcome).toBe('refused')
  })

  it('a failure keeps its transaction id — the write may have reached Sanity', async () => {
    const rows: ContentAuditEntry[] = []
    let used = ''
    await expect(audited(spec(async (e) => void rows.push(e)), async (txn) => { used = txn; throw Object.assign(new Error('x'), { code: 'failed' }) })).rejects.toThrow()
    expect(rows).toEqual([expect.objectContaining({ outcome: 'failed', transactionId: used })])
  })

  it('an id that is not an id records nothing', async () => {
    const rows: ContentAuditEntry[] = []
    await expect(audited(spec(async (e) => void rows.push(e), { contentId: null }), async () => { throw Object.assign(new Error('x'), { code: 'not_found' }) })).rejects.toThrow()
    expect(rows).toEqual([])
  })

  it('a writer that throws never changes what the caller sees (success or error)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = async () => { throw new Error('db down') }
    expect(await audited(spec(broken), async () => ({ value: 'ok', action: 'published' }))).toBe('ok')
    const err = Object.assign(new Error('x'), { code: 'conflict' })
    await expect(audited(spec(broken), async () => { throw err })).rejects.toBe(err)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
