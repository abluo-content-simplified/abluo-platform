/**
 * ADR-028 §4 — no escalation. Every refusal path is exercised.
 */
import { describe, expect, it } from 'vitest'
import { checkGrant, leavesTenantWithoutOwner, type Granter } from '../grant-rules'
import { resolveProjectPermissions, resolveTenantPermissions } from '../resolve'

const MODULES = ['blog', 'forms', 'gallery']
const project = (role: 'owner' | 'admin' | 'editor' | 'viewer' | 'member', extras: string[] = []) =>
  resolveProjectPermissions({ role, enabledModuleIds: MODULES, projectExtras: extras }).permissions

const tenantOwner: Granter = { platformRole: 'tenant_user', tenantRole: 'owner', projectRole: 'owner', permissions: project('owner') }
const tenantOwnerAtTenant: Granter = { platformRole: 'tenant_user', tenantRole: 'owner', permissions: resolveTenantPermissions({ role: 'owner' }).permissions }
const siteAdmin: Granter = { platformRole: 'tenant_user', tenantRole: null, projectRole: 'admin', permissions: project('admin') }
const editor: Granter = { platformRole: 'tenant_user', tenantRole: null, projectRole: 'editor', permissions: project('editor') }
const member: Granter = { platformRole: 'tenant_user', tenantRole: 'member', projectRole: 'member', permissions: project('member', ['forms.submission.read']) }
const superAdmin: Granter = { platformRole: 'abluo_admin', tenantRole: null, projectRole: null, permissions: [] }

const ok = { ok: true }

describe('project level', () => {
  it('Owner may invite a Site admin or an Editor', () => {
    expect(checkGrant(tenantOwner, { scope: 'project', action: 'invite', role: 'admin' })).toEqual(ok)
    expect(checkGrant(tenantOwner, { scope: 'project', action: 'invite', role: 'editor' })).toEqual(ok)
  })
  it('Site admin may invite an Editor only', () => {
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'invite', role: 'editor' })).toEqual(ok)
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'invite', role: 'admin' })).toMatchObject({ ok: false, reason: 'role_too_high' })
  })
  it('Site admin cannot change or remove another Site admin', () => {
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'change', role: 'editor', currentRole: 'admin' })).toMatchObject({ ok: false, reason: 'target_too_high' })
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'remove', currentRole: 'admin' })).toMatchObject({ ok: false, reason: 'target_too_high' })
  })
  it('Site admin cannot promote an Editor to Site admin', () => {
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'change', role: 'admin', currentRole: 'editor' })).toMatchObject({ ok: false, reason: 'role_too_high' })
  })
  it('Site admin may change or remove an Editor, and remove a retired Viewer', () => {
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'change', role: 'editor', currentRole: 'editor', extras: [] })).toEqual(ok)
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'remove', currentRole: 'editor' })).toEqual(ok)
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'remove', currentRole: 'viewer' })).toEqual(ok)
  })
  it('Editor and Member can invite no one', () => {
    expect(checkGrant(editor, { scope: 'project', action: 'invite', role: 'editor' })).toMatchObject({ ok: false, reason: 'missing_permission' })
    expect(checkGrant(member, { scope: 'project', action: 'invite', role: 'editor' })).toMatchObject({ ok: false, reason: 'missing_permission' })
  })
  it('a granter whose permissions lack users.invite is refused even if their role looks right', () => {
    const stale: Granter = { ...siteAdmin, permissions: [] }
    expect(checkGrant(stale, { scope: 'project', action: 'invite', role: 'editor' })).toMatchObject({ ok: false, reason: 'missing_permission' })
  })
  it('Viewer is never granted, by anyone', () => {
    for (const g of [tenantOwner, siteAdmin, superAdmin]) {
      expect(checkGrant(g, { scope: 'project', action: 'invite', role: 'viewer' })).toMatchObject({ ok: false, reason: 'role_retired' })
    }
  })
  it('invite and change need a role', () => {
    expect(checkGrant(tenantOwner, { scope: 'project', action: 'invite' })).toMatchObject({ ok: false, reason: 'role_required' })
  })
})

describe('project extras', () => {
  it('Site admin may give an Editor contact requests (read + update)', () => {
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'invite', role: 'editor', extras: ['forms.submission.read', 'forms.submission.update'] })).toEqual(ok)
  })
  it('update without read is refused', () => {
    expect(checkGrant(siteAdmin, { scope: 'project', action: 'invite', role: 'editor', extras: ['forms.submission.update'] })).toMatchObject({ ok: false, reason: 'extra_missing_prerequisite' })
  })
  it('an extra the granter does not hold is refused', () => {
    const adminWithoutForms: Granter = { ...siteAdmin, permissions: resolveProjectPermissions({ role: 'admin', enabledModuleIds: ['blog'] }).permissions }
    expect(checkGrant(adminWithoutForms, { scope: 'project', action: 'invite', role: 'editor', extras: ['forms.submission.read'] })).toMatchObject({ ok: false, reason: 'extra_not_held' })
  })
  it('non-grantable or unknown extras are refused', () => {
    for (const id of ['forms.submission.delete', 'users.manage', 'blog.post.write', 'billing.invoice.read', 'lead.read']) {
      expect(checkGrant(tenantOwner, { scope: 'project', action: 'invite', role: 'editor', extras: [id] })).toMatchObject({ ok: false, reason: 'extra_unknown_or_not_grantable' })
    }
  })
})

describe('tenant level', () => {
  it('only an Owner grants at tenant level', () => {
    expect(checkGrant(tenantOwnerAtTenant, { scope: 'tenant', action: 'invite', role: 'member', extras: ['billing.invoice.read'] })).toEqual(ok)
    expect(checkGrant(tenantOwnerAtTenant, { scope: 'tenant', action: 'invite', role: 'owner' })).toEqual(ok)
    const memberAtTenant: Granter = { platformRole: 'tenant_user', tenantRole: 'member', permissions: ['users.invite', 'users.manage'] }
    expect(checkGrant(memberAtTenant, { scope: 'tenant', action: 'invite', role: 'member' })).toMatchObject({ ok: false, reason: 'role_too_high' })
  })
  it('a Site admin cannot act at tenant level', () => {
    expect(checkGrant(siteAdmin, { scope: 'tenant', action: 'invite', role: 'member' })).toMatchObject({ ok: false, reason: 'role_too_high' })
  })
  it('tenant extras may include project-scoped grantables (apply to every site)', () => {
    expect(checkGrant(tenantOwnerAtTenant, { scope: 'tenant', action: 'invite', role: 'member', extras: ['forms.submission.read'] })).toEqual(ok)
  })
  it('non-grantable tenant permissions are refused as extras', () => {
    expect(checkGrant(tenantOwnerAtTenant, { scope: 'tenant', action: 'invite', role: 'member', extras: ['billing.manage'] })).toMatchObject({ ok: false, reason: 'extra_unknown_or_not_grantable' })
  })
})

describe('Super Admin', () => {
  it('may create a tenant’s first Owner without holding a membership', () => {
    expect(checkGrant(superAdmin, { scope: 'tenant', action: 'invite', role: 'owner' })).toEqual(ok)
  })
  it('still cannot grant unknown extras', () => {
    expect(checkGrant(superAdmin, { scope: 'project', action: 'invite', role: 'editor', extras: ['everything'] })).toMatchObject({ ok: false, reason: 'extra_unknown_or_not_grantable' })
  })
})

describe('last Owner', () => {
  it('removing or demoting the only Owner is refused', () => {
    expect(leavesTenantWithoutOwner({ ownerUserIds: ['u1'], userId: 'u1', newRole: null })).toBe(true)
    expect(leavesTenantWithoutOwner({ ownerUserIds: ['u1'], userId: 'u1', newRole: 'member' })).toBe(true)
  })
  it('allowed when another Owner remains, or the change keeps them Owner', () => {
    expect(leavesTenantWithoutOwner({ ownerUserIds: ['u1', 'u2'], userId: 'u1', newRole: null })).toBe(false)
    expect(leavesTenantWithoutOwner({ ownerUserIds: ['u1'], userId: 'u1', newRole: 'owner' })).toBe(false)
    expect(leavesTenantWithoutOwner({ ownerUserIds: ['u1'], userId: 'u9', newRole: null })).toBe(false)
  })
})
