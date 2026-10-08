/**
 * Support mode, end to end through a real server action (ADR-028 §8): the
 * contact-request actions with the real guard, given the context the resolver
 * builds for a support visit. View only → refused with NO database call;
 * allowed → the write runs on the visited project only, through the
 * project-scoped data client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { buildSupportAuthorizationContext } from '../context'
import type { SupportSession } from '../state'

const ADMIN = '00000000-0000-4000-8000-00000000000a'
const PROJECT = '00000000-0000-4000-8000-000000000101'
const ROW = '00000000-0000-4000-8000-0000000000aa'

const calls: Array<{ table: string; op: string; filters: Array<[string, unknown]> }> = []
function fakeDb() {
  return {
    from(table: string) {
      const rec = { table, op: '', filters: [] as Array<[string, unknown]> }
      calls.push(rec)
      const chain: Record<string, unknown> = {}
      for (const op of ['update', 'delete', 'select']) chain[op] = () => ((rec.op ||= op), chain)
      for (const f of ['eq', 'neq', 'in']) chain[f] = (col: string, v: unknown) => (rec.filters.push([`${f}:${col}`, v]), chain)
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: ROW }], error: null })
      return chain
    },
  }
}

const dataClient = vi.hoisted(() => ({ projectDataClient: vi.fn() }))
vi.mock('@/lib/support/data-client', () => dataClient)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => fakeDb(),
  runAsTrustedSystemOperation: async (_r: string, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb()),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let tenantCtx: TenantAuthorizationContext | null = null
vi.mock('@/lib/api/tenant-context', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return { ...real, getTenantAuthorizationContext: async () => tenantCtx }
})

import {
  deleteSubmissionsAction,
  setSubmissionStatusAction,
} from '@/app/[locale]/(client)/[tenant]/submissions/actions'

function supportCtx(over: Partial<SupportSession>): TenantAuthorizationContext {
  const now = Date.now()
  return buildSupportAuthorizationContext({
    actor: { userId: ADMIN, platformRole: 'abluo_admin' },
    session: {
      id: '00000000-0000-4000-8000-000000000001',
      projectId: PROJECT,
      adminUserId: ADMIN,
      role: 'owner',
      status: 'viewing',
      startedAt: new Date(now - 60_000).toISOString(),
      requestedAt: null,
      decidedAt: null,
      decidedBy: null,
      expiresAt: null,
      revokedAt: null,
      contactRequestsShownAt: new Date(now - 30_000).toISOString(),
      endedAt: null,
      ...over,
    },
    project: { id: PROJECT, slug: asSupabaseProjectSlug('studio'), name: 'Studio' },
    enabledModuleIds: ['forms'],
    purpose: 'mutation',
  })
}

const input = { projectSlug: 'studio', submissionId: ROW, status: 'processed' as const, locale: 'en' }

beforeEach(() => {
  calls.length = 0
  dataClient.projectDataClient.mockReset()
  dataClient.projectDataClient.mockImplementation(async () => fakeDb())
})

describe('contact-request actions in a support visit', () => {
  it('view only: status change refused before any database call', async () => {
    tenantCtx = supportCtx({})
    expect(await setSubmissionStatusAction(input)).toEqual({ ok: false, error: 'update_failed' })
    expect(dataClient.projectDataClient).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('view only: delete refused before any database call', async () => {
    tenantCtx = supportCtx({})
    expect(await deleteSubmissionsAction({ projectSlug: 'studio', submissionIds: [ROW], locale: 'en' })).toEqual({ ok: false, error: 'failed' })
    expect(calls).toEqual([])
  })

  it('pending request: still refused', async () => {
    tenantCtx = supportCtx({ status: 'requested', requestedAt: new Date().toISOString() })
    expect((await setSubmissionStatusAction(input)).ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('allowed: the update runs on the visited project through the project-scoped client', async () => {
    tenantCtx = supportCtx({
      status: 'allowed',
      requestedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy: '00000000-0000-4000-8000-00000000000c',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    })
    expect(await setSubmissionStatusAction(input)).toEqual({ ok: true })
    expect(dataClient.projectDataClient).toHaveBeenCalledWith(tenantCtx, PROJECT)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'form_submissions', op: 'update' })
    expect(calls[0].filters).toContainEqual(['eq:project_id', PROJECT])
  })

  it('expired approval: refused again', async () => {
    tenantCtx = supportCtx({
      status: 'allowed',
      requestedAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedBy: '00000000-0000-4000-8000-00000000000c',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    expect((await setSubmissionStatusAction(input)).ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('another project slug is not reachable from a visit', async () => {
    tenantCtx = supportCtx({})
    expect(await setSubmissionStatusAction({ ...input, projectSlug: 'someone-else' })).toEqual({ ok: false, error: 'forbidden' })
  })
})
