/**
 * getDashboardSubmissions — ADR-018 slice 6. Proves the enforcement chain binds
 * (assertModuleAction first: forms installed + forms.submission.read), and the
 * row → DashboardSubmission mapping, with an injected Supabase client — no live DB.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  getDashboardSubmissions,
  mapSubmissionRow,
  type SubmissionsReader,
} from '../client-dashboard'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'

function ctxWith(grants: ProjectGrant[]): TenantAuthorizationContext {
  return { userId: 'user-1', platformRole: 'tenant_user', projects: grants }
}

// Forms module installed + forms.submission.read held (owner/editor/viewer all hold it).
const formsGrant: ProjectGrant = {
  projectId: 'project-a1',
  projectSlug: 'livener-main',
  membershipId: 'pm-editor-a1',
  role: 'editor',
  permissions: ['forms.submission.read'],
  enabledModuleIds: ['forms'],
}

// Same project, forms NOT installed.
const noFormsGrant: ProjectGrant = { ...formsGrant, enabledModuleIds: ['blog'] }

/** A fluent Supabase mock: every builder method returns the (thenable) builder. */
function mockClient(result: { data: unknown; error: unknown }): { reader: SubmissionsReader; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn()
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'order', 'limit']) {
    builder[m] = (...args: unknown[]) => { spy(m, ...args); return builder }
  }
  ;(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result)
  const reader: SubmissionsReader = { from: (t: string) => { spy('from', t); return builder } }
  return { reader, spy }
}

describe('mapSubmissionRow', () => {
  it('extracts name/email from submission_data and normalizes status', () => {
    expect(mapSubmissionRow({
      id: 's1', form_id: 'contact', status: 'processed', created_at: '2026-08-11T10:00:00Z',
      submission_data: { name: 'John', email: 'john@x.test', message: 'hi' },
    })).toEqual({ id: 's1', formId: 'contact', name: 'John', email: 'john@x.test', status: 'processed', createdAt: '2026-08-11T10:00:00Z' })
  })
  it('defaults an unknown/missing status to "new" and missing name/email to null', () => {
    const r = mapSubmissionRow({ id: 's2', form_id: 'early-access', status: 'weird', created_at: 'x', submission_data: {} })
    expect(r.status).toBe('new')
    expect(r.name).toBeNull()
    expect(r.email).toBeNull()
  })
})

describe('getDashboardSubmissions', () => {
  it('throws when the forms module is not installed — before any DB read', async () => {
    const { reader, spy } = mockClient({ data: [], error: null })
    await expect(
      getDashboardSubmissions(ctxWith([noFormsGrant]), 'project-a1', {}, { client: reader }),
    ).rejects.toThrow(TenantAuthorizationError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('throws when the caller holds no grant on the requested project', async () => {
    const { reader, spy } = mockClient({ data: [], error: null })
    await expect(
      getDashboardSubmissions(ctxWith([formsGrant]), 'project-OTHER', {}, { client: reader }),
    ).rejects.toThrow(TenantAuthorizationError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns mapped submissions for a valid grant, scoped to the project', async () => {
    const rows = [
      { id: 's1', form_id: 'contact', status: 'new', created_at: '2026-08-11T10:00:00Z', submission_data: { name: 'A', email: 'a@x.test' } },
      { id: 's2', form_id: 'contact', status: 'archived', created_at: '2026-08-10T10:00:00Z', submission_data: { email: 'b@x.test' } },
    ]
    const { reader, spy } = mockClient({ data: rows, error: null })
    const out = await getDashboardSubmissions(ctxWith([formsGrant]), 'project-a1', {}, { client: reader })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 's1', name: 'A', email: 'a@x.test', status: 'new' })
    expect(out[1]).toMatchObject({ id: 's2', name: null, status: 'archived' })
    // Read is scoped to the project id and filters spam/partials.
    expect(spy).toHaveBeenCalledWith('from', 'form_submissions')
    expect(spy).toHaveBeenCalledWith('eq', 'project_id', 'project-a1')
    expect(spy).toHaveBeenCalledWith('eq', 'completion_state', 'complete')
    expect(spy).toHaveBeenCalledWith('neq', 'status', 'spam')
  })

  it('returns an empty array (never null) when the query yields null', async () => {
    const { reader } = mockClient({ data: null, error: null })
    const out = await getDashboardSubmissions(ctxWith([formsGrant]), 'project-a1', {}, { client: reader })
    expect(out).toEqual([])
  })

  it('throws when the query returns an error', async () => {
    const { reader } = mockClient({ data: null, error: { message: 'boom' } })
    await expect(
      getDashboardSubmissions(ctxWith([formsGrant]), 'project-a1', {}, { client: reader }),
    ).rejects.toThrow(/boom/)
  })
})
