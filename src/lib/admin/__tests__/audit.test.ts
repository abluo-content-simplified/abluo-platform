import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { isViewAction, recordAdminAudit, VIEW_DEDUPE_WINDOW_MS, viewDedupeSince, type AdminAuditEntry } from '../audit'

type Row = { actor_id: string; action: string; project_id: string | null; occurred_at: string }

/**
 * A tiny in-memory admin_audit_log answering exactly the two calls the logger
 * makes: the head count (eq / is / gte filters) and the insert.
 */
function fakeDb(clock: { now: number }) {
  const rows: Row[] = []
  const db = {
    from: () => {
      const filters: ((r: Row) => boolean)[] = []
      const q = {
        select: () => q,
        eq: (col: keyof Row, v: string) => (filters.push((r) => r[col] === v), q),
        is: (col: keyof Row, v: null) => (filters.push((r) => r[col] === v), q),
        gte: (col: keyof Row, v: string) => (filters.push((r) => String(r[col]) >= v), q),
        then: (res: (x: { count: number; error: null }) => unknown) => Promise.resolve({ count: rows.filter((r) => filters.every((f) => f(r))).length, error: null }).then(res),
        insert: async (r: Omit<Row, 'occurred_at'>) => {
          rows.push({ ...r, occurred_at: new Date(clock.now).toISOString() })
          return { error: null }
        },
      }
      return q
    },
  }
  return { db, rows }
}

const T0 = Date.parse('2026-10-08T10:00:00Z')
const view = (over: Partial<AdminAuditEntry> = {}): AdminAuditEntry => ({ actorId: 'admin-1', action: 'project.view', projectId: 'p1', ...over })

describe('admin audit view de-duplication', () => {
  it('records one view per admin + action + project per 10 minutes', async () => {
    const clock = { now: T0 }
    const { db, rows } = fakeDb(clock)
    const rec = (e: AdminAuditEntry) => recordAdminAudit(e, { db, now: clock.now })

    await rec(view())
    clock.now = T0 + 60_000
    await rec(view()) // re-render / reload a minute later
    clock.now = T0 + VIEW_DEDUPE_WINDOW_MS - 1000
    await rec(view())
    expect(rows).toHaveLength(1)

    clock.now = T0 + VIEW_DEDUPE_WINDOW_MS + 1000
    await rec(view()) // a new look after the window
    expect(rows).toHaveLength(2)
  })

  it('a different project, action or admin is a different view', async () => {
    const clock = { now: T0 }
    const { db, rows } = fakeDb(clock)
    const rec = (e: AdminAuditEntry) => recordAdminAudit(e, { db, now: clock.now })
    await rec(view())
    await rec(view({ projectId: 'p2' }))
    await rec(view({ action: 'project.analytics.view' }))
    await rec(view({ actorId: 'admin-2' }))
    expect(rows).toHaveLength(4)
  })

  it('cross-project views (no project) de-duplicate too', async () => {
    const clock = { now: T0 }
    const { db, rows } = fakeDb(clock)
    const rec = (e: AdminAuditEntry) => recordAdminAudit(e, { db, now: clock.now })
    await rec(view({ action: 'analytics.portfolio.view', projectId: null }))
    await rec(view({ action: 'analytics.portfolio.view', projectId: null }))
    await rec(view({ action: 'media.project.view', projectId: null }))
    expect(rows.map((r) => r.action)).toEqual(['analytics.portfolio.view', 'media.project.view'])
  })

  it('changes are always recorded', async () => {
    const clock = { now: T0 }
    const { db, rows } = fakeDb(clock)
    const rec = (e: AdminAuditEntry) => recordAdminAudit(e, { db, now: clock.now })
    await rec(view({ action: 'media.asset.update' }))
    await rec(view({ action: 'media.asset.update' }))
    expect(rows).toHaveLength(2)
  })

  it('pure helpers', () => {
    expect(isViewAction('project.view')).toBe(true)
    expect(isViewAction('media.asset.delete')).toBe(false)
    expect(viewDedupeSince(T0)).toBe('2026-10-08T09:50:00.000Z')
  })

  it('never throws, even when the database does', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = { from: () => { throw new Error('down') } }
    await expect(recordAdminAudit(view(), { db })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
