import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { clearDismissal, SETUP_CHECKLIST_DISMISSAL } from '../dismissals'

function fakeDb(error: { message: string } | null = null) {
  const eqs: Array<[string, unknown]> = []
  const chain: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    eq: (c: string, v: unknown) => {
      eqs.push([c, v])
      return eqs.length === 3 ? Promise.resolve({ error }) : chain
    },
  }
  const del = vi.fn(() => chain)
  return { db: { from: vi.fn(() => ({ delete: del })) }, eqs, del }
}

describe('clearDismissal', () => {
  it('deletes exactly this person\'s row for this project and key', async () => {
    const f = fakeDb()
    expect(await clearDismissal('u1', 'p1', SETUP_CHECKLIST_DISMISSAL, { client: f.db })).toBe(true)
    expect(f.db.from).toHaveBeenCalledWith('dashboard_dismissals')
    expect(f.eqs).toEqual([['user_id', 'u1'], ['project_id', 'p1'], ['key', SETUP_CHECKLIST_DISMISSAL]])
  })
  it('refuses a key that is not a code constant, without touching the database', async () => {
    const f = fakeDb()
    expect(await clearDismissal('u1', 'p1', "x'; drop", { client: f.db })).toBe(false)
    expect(f.db.from).not.toHaveBeenCalled()
  })
  it('reports a database error as false', async () => {
    const f = fakeDb({ message: 'boom' })
    expect(await clearDismissal('u1', 'p1', SETUP_CHECKLIST_DISMISSAL, { client: f.db })).toBe(false)
  })
})
