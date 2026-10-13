import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { readContentActivity, toActivityItem } from '../activity'

const row = (o: Record<string, unknown> = {}) => ({ id: 1, occurred_at: '2026-10-13T08:00:00Z', action: 'published' as const, actor_kind: 'user', actor_id: 'u1', detail: {}, ...o })

describe('who is shown — exactly what was recorded, never inferred', () => {
  const names = new Map([['u1', 'Claudia Hoffmann']])
  it('a dashboard user by name', () => expect(toActivityItem(row(), names).actor).toEqual({ kind: 'person', name: 'Claudia Hoffmann' }))
  it('a user without a profile name', () => expect(toActivityItem(row({ actor_id: 'u2' }), names).actor).toEqual({ kind: 'member', name: null }))
  it('a deleted account', () => expect(toActivityItem(row({ actor_id: null }), names).actor).toEqual({ kind: 'formerMember', name: null }))
  it('support mode is never named, even when the admin has a profile', () => {
    expect(toActivityItem(row({ actor_id: 'u1', detail: { support: true } }), names).actor).toEqual({ kind: 'support', name: null })
  })
  it('Studio is the Abluo team; anything else is the system — never a person', () => {
    expect(toActivityItem(row({ actor_kind: 'studio', actor_id: 'u1' }), names).actor).toEqual({ kind: 'team', name: null })
    expect(toActivityItem(row({ actor_kind: 'system', actor_id: 'u1' }), names).actor).toEqual({ kind: 'system', name: null })
  })
})

describe('readContentActivity', () => {
  function fakeDb(rows: unknown[], profiles: unknown[]) {
    const calls: Array<[string, ...unknown[]]> = []
    const chain = (table: string, data: unknown[]) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
        q[m] = (...args: unknown[]) => (calls.push([`${table}.${m}`, ...args]), q)
      }
      q.then = (res: (v: unknown) => unknown) => res({ data, error: null })
      return q
    }
    return { db: { from: (t: string) => chain(t, t === 'profiles' ? profiles : rows) }, calls }
  }

  it('reads this item of this project, successful actions only, newest first, and names users', async () => {
    const { db, calls } = fakeDb([row(), row({ id: 2, actor_kind: 'studio', actor_id: null })], [{ id: 'u1', full_name: 'Tom' }])
    const items = await readContentActivity({ projectId: 'p1', contentType: 'post', contentIds: ['post-1'] }, { db })
    expect(items.map((i) => i.actor)).toEqual([{ kind: 'person', name: 'Tom' }, { kind: 'team', name: null }])
    expect(calls).toEqual(expect.arrayContaining([
      ['content_audit_log.eq', 'project_id', 'p1'],
      ['content_audit_log.eq', 'content_type', 'post'],
      ['content_audit_log.in', 'content_id', ['post-1']],
      ['content_audit_log.eq', 'outcome', 'ok'],
      ['content_audit_log.order', 'occurred_at', { ascending: false }],
      ['profiles.in', 'id', ['u1']],
    ]))
  })
})
