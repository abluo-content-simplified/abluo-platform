/**
 * The two server actions added with the setup checklist and the editable name:
 * who may call them, what they write and where, and that a refusal touches
 * nothing. Only the I/O boundaries are faked (session context, Supabase).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][]; opts?: unknown }
const calls: Call[] = []
const adminCalls: Call[] = []
let ctx: unknown = null
let updateRows: { id: string }[] = [{ id: 'u1' }]
let upsertError: { message: string } | null = null
const updateUser = vi.fn(async () => ({ data: {}, error: null }))

function table(log: Call[], name: string) {
  const c: Call = { table: name, op: 'select', filters: [] }
  log.push(c)
  const b = {
    select: () => b,
    eq: (k: string, v: unknown) => (c.filters.push([k, v]), b),
    update: (p: unknown) => ((c.op = 'update'), (c.payload = p), b),
    upsert: async (p: unknown, opts?: unknown) => ((c.op = 'upsert'), (c.payload = p), (c.opts = opts), { error: upsertError }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: c.op === 'update' ? updateRows : [], error: null }),
  }
  return b
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: async () => ctx }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => table(calls, t), auth: { updateUser } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: (t: string) => table(adminCalls, t) }) }))

const grant = (projectSlug: string, projectId: string) => ({
  projectId,
  projectSlug,
  membershipId: 'm',
  role: 'editor',
  permissions: ['blog.post.write'],
  enabledModuleIds: ['blog'],
})

beforeEach(() => {
  calls.length = 0
  adminCalls.length = 0
  ctx = null
  updateRows = [{ id: 'u1' }]
  upsertError = null
  updateUser.mockClear()
})

describe('hideSetupChecklistAction', () => {
  const load = () => import('@/app/[locale]/(client)/[tenant]/home/actions')

  it('signed out → refused, nothing touched', async () => {
    const { hideSetupChecklistAction } = await load()
    expect(await hideSetupChecklistAction({ projectSlug: 'site-a' })).toEqual({ ok: false, error: 'forbidden' })
    expect(calls).toEqual([])
  })

  it('a site the person has no grant on → refused before any I/O', async () => {
    ctx = { userId: 'u1', projects: [grant('site-a', 'p-a')] }
    const { hideSetupChecklistAction } = await load()
    expect(await hideSetupChecklistAction({ projectSlug: 'site-b' })).toEqual({ ok: false, error: 'forbidden' })
    expect(await hideSetupChecklistAction({ projectSlug: '' })).toEqual({ ok: false, error: 'forbidden' })
    expect(calls).toEqual([])
  })

  it('writes one row for the session user and the granted project (never ids from the request)', async () => {
    ctx = { userId: 'u1', projects: [grant('site-a', 'p-a')] }
    const { hideSetupChecklistAction } = await load()
    expect(await hideSetupChecklistAction({ projectSlug: 'site-a', userId: 'someone-else' } as never)).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        table: 'dashboard_dismissals',
        op: 'upsert',
        payload: { user_id: 'u1', project_id: 'p-a', key: 'setupChecklist' },
        filters: [],
        opts: { onConflict: 'user_id,project_id,key', ignoreDuplicates: true },
      },
    ])
    expect(adminCalls).toEqual([])
  })

  it('a failed write (e.g. migration 039 not applied) is reported, not thrown', async () => {
    ctx = { userId: 'u1', projects: [grant('site-a', 'p-a')] }
    upsertError = { message: 'relation "dashboard_dismissals" does not exist' }
    const { hideSetupChecklistAction } = await load()
    expect(await hideSetupChecklistAction({ projectSlug: 'site-a' })).toEqual({ ok: false, error: 'failed' })
  })
})

describe('updateDisplayNameAction', () => {
  const load = () => import('@/app/[locale]/(client)/account/actions')

  it('signed out → refused, nothing touched', async () => {
    const { updateDisplayNameAction } = await load()
    expect(await updateDisplayNameAction('Paolo')).toEqual({ ok: false, error: 'unauthenticated' })
    expect(calls).toEqual([])
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('an invalid name is refused before any write', async () => {
    ctx = { userId: 'u1', projects: [] }
    const { updateDisplayNameAction } = await load()
    expect(await updateDisplayNameAction('   ')).toEqual({ ok: false, error: 'empty' })
    expect(await updateDisplayNameAction('x'.repeat(81))).toEqual({ ok: false, error: 'tooLong' })
    expect(await updateDisplayNameAction('a\u202Eb')).toEqual({ ok: false, error: 'invalid' })
    expect(calls).toEqual([])
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('saves the normalized name on the person’s own profile, as the person, and keeps the metadata in step', async () => {
    ctx = { userId: 'u1', projects: [] }
    const { updateDisplayNameAction } = await load()
    expect(await updateDisplayNameAction('  Paolo   Martegani ')).toEqual({ ok: true, name: 'Paolo Martegani' })
    expect(calls).toEqual([{ table: 'profiles', op: 'update', payload: { full_name: 'Paolo Martegani' }, filters: [['id', 'u1']] }])
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: 'Paolo Martegani' } })
    expect(adminCalls).toEqual([])
  })

  it('creates the missing profile row for the session user only', async () => {
    ctx = { userId: 'u1', projects: [] }
    updateRows = []
    const { updateDisplayNameAction } = await load()
    expect(await updateDisplayNameAction('Anna')).toEqual({ ok: true, name: 'Anna' })
    expect(adminCalls).toEqual([
      { table: 'profiles', op: 'upsert', payload: { id: 'u1', full_name: 'Anna' }, filters: [], opts: { onConflict: 'id' } },
    ])
  })
})
