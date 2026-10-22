import { describe, expect, it } from 'vitest'
import { canSeeTicket, ticketAccess } from '../access'
import { resolveProjectPermissions } from '@/lib/authz/resolve'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'

function ctx(role: 'owner' | 'admin' | 'editor' | 'viewer', extras: string[] = [], support = false): TenantAuthorizationContext {
  const permissions = [...resolveProjectPermissions({ role, enabledModuleIds: [] }).permissions, ...extras]
  return {
    userId: 'u1',
    platformRole: 'tenant_user',
    projects: [{ projectId: 'p1', projectSlug: 'martegani' as never, membershipId: 'm', role, permissions, enabledModuleIds: [] }],
    ...(support ? { support: { sessionId: 's', projectId: 'p1', projectSlug: 'martegani', projectName: 'M', adminUserId: 'u1', role: 'owner', status: 'allowed', writesAllowed: true, expiresAt: null, contactRequestsShown: false, purpose: 'mutation' } as never } : {}),
  }
}

describe('ticketAccess (ADR-039 D3)', () => {
  it('Owner and Site admin write and see all', () => {
    for (const r of ['owner', 'admin'] as const) expect(ticketAccess(ctx(r), 'martegani')).toMatchObject({ canWrite: true, canReadAll: true })
  })
  it('Editor writes but sees only their own; the extra widens it', () => {
    expect(ticketAccess(ctx('editor'), 'martegani')).toMatchObject({ canWrite: true, canReadAll: false })
    expect(ticketAccess(ctx('editor', ['support.tickets.read']), 'martegani')).toMatchObject({ canReadAll: true })
  })
  it('Viewer cannot write', () => {
    expect(ticketAccess(ctx('viewer'), 'martegani')).toMatchObject({ canWrite: false, canReadAll: false })
  })
  it('support mode never writes, even with edit access allowed (D15)', () => {
    expect(ticketAccess(ctx('owner', [], true), 'martegani')).toMatchObject({ canWrite: false, supportMode: true })
  })
  it('no grant for the slug → null', () => {
    expect(ticketAccess(ctx('owner'), 'hoffmann')).toBeNull()
    expect(ticketAccess(null, 'martegani')).toBeNull()
  })
  it('canSeeTicket: other project never; own always; others only with read-all', () => {
    const editor = ticketAccess(ctx('editor'), 'martegani')!
    const owner = ticketAccess(ctx('owner'), 'martegani')!
    expect(canSeeTicket(editor, { project_id: 'p1', created_by: 'u1' })).toBe(true)
    expect(canSeeTicket(editor, { project_id: 'p1', created_by: 'u2' })).toBe(false)
    expect(canSeeTicket(owner, { project_id: 'p1', created_by: 'u2' })).toBe(true)
    expect(canSeeTicket(owner, { project_id: 'p2', created_by: 'u1' })).toBe(false)
    expect(canSeeTicket(editor, { project_id: 'p1', created_by: null })).toBe(false)
  })
})
