/**
 * ADR-028 steps 3–5 — grants with extras, Site admins and tenant Members.
 * Uses the real module registry: contact requests (forms.submission.*) are
 * Owner / Site admin by default and otherwise only an extra.
 */
import { describe, expect, it } from 'vitest'
import { assembleProjectGrants, type RawProjectMembership } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const slug = asSupabaseProjectSlug
const READ = 'forms.submission.read'
const UPDATE = 'forms.submission.update'
const modules = { pA1: ['forms', 'blog'], pA2: ['forms'], pA3: ['blog'] }
const membership = (o: Partial<RawProjectMembership> & Pick<RawProjectMembership, 'projectId' | 'role'>): RawProjectMembership => ({
  membershipId: `m-${o.projectId}-${o.role}`,
  projectSlug: slug(`s-${o.projectId}`),
  tenantId: 'tA',
  extraPermissions: [],
  ...o,
})
const grants = (memberships: RawProjectMembership[], tenantExtrasByTenantId: Record<string, string[]> = {}) =>
  assembleProjectGrants({ ownedProjects: [], memberships, enabledModuleIdsByProjectId: modules, tenantExtrasByTenantId })
const perms = (g: ReturnType<typeof grants>, projectId: string) => g.find((x) => x.projectId === projectId)?.permissions ?? null

describe('contact requests by default', () => {
  it('an Owner reads and updates them', () => {
    const g = assembleProjectGrants({ ownedProjects: [{ projectId: 'pA1', projectSlug: slug('a1'), tenantId: 'tA' }], memberships: [], enabledModuleIdsByProjectId: modules })
    expect(perms(g, 'pA1')).toEqual(expect.arrayContaining([READ, UPDATE, 'forms.submission.delete']))
  })
  it('a Site admin reads, updates and deletes them on its site', () => {
    expect(perms(grants([membership({ projectId: 'pA1', role: 'admin' })]), 'pA1')).toEqual(expect.arrayContaining([READ, UPDATE, 'forms.submission.delete']))
  })
  it('an Editor does not see them', () => {
    const p = perms(grants([membership({ projectId: 'pA1', role: 'editor' })]), 'pA1')!
    expect(p).not.toContain(READ)
    expect(p).not.toContain(UPDATE)
    expect(p).toContain('blog.post.write') // still edits content
  })
})

describe('extras on the project membership', () => {
  it('Editor + read sees them, cannot change status', () => {
    const p = perms(grants([membership({ projectId: 'pA1', role: 'editor', extraPermissions: [READ] })]), 'pA1')!
    expect(p).toContain(READ)
    expect(p).not.toContain(UPDATE)
  })
  it('Editor + read + update can change status, never delete', () => {
    const p = perms(grants([membership({ projectId: 'pA1', role: 'editor', extraPermissions: [READ, UPDATE] })]), 'pA1')!
    expect(p).toEqual(expect.arrayContaining([READ, UPDATE]))
    expect(p).not.toContain('forms.submission.delete')
  })
  it('a forged non-grantable extra is ignored', () => {
    const p = perms(grants([membership({ projectId: 'pA1', role: 'editor', extraPermissions: ['forms.submission.delete', 'users.manage'] })]), 'pA1')!
    expect(p).not.toContain('forms.submission.delete')
    expect(p).not.toContain('users.manage')
  })
})

describe('tenant-level extras', () => {
  it('apply to the person’s real project membership', () => {
    const p = perms(grants([membership({ projectId: 'pA1', role: 'editor' })], { tA: [READ] }), 'pA1')!
    expect(p).toContain(READ)
  })
  it('a tenant Member reaches every site of the client where the module is on', () => {
    const g = grants(['pA1', 'pA2', 'pA3'].map((projectId) => membership({ projectId, role: 'member', membershipId: 'tenant-member:tA' })), { tA: [READ] })
    expect(perms(g, 'pA1')).toEqual([READ])
    expect(perms(g, 'pA2')).toEqual([READ])
    expect(perms(g, 'pA3')).toEqual([]) // forms not installed there
  })
  it('a synthetic Member grant never replaces a real project membership', () => {
    const g = grants([
      membership({ projectId: 'pA1', role: 'member', membershipId: 'tenant-member:tA' }),
      membership({ projectId: 'pA1', role: 'editor', membershipId: 'pm-1' }),
    ], { tA: [READ] })
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ role: 'editor', membershipId: 'pm-1' })
    expect(g[0].permissions).toEqual(expect.arrayContaining([READ, 'blog.post.write']))
  })
  it('another client’s extras never apply', () => {
    const p = perms(grants([membership({ projectId: 'pA1', role: 'editor' })], { tB: [READ] }), 'pA1')!
    expect(p).not.toContain(READ)
  })
})
