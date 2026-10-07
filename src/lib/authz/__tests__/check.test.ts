/**
 * ADR-028 — can(): the single access check. Fail closed in every ambiguous case.
 */
import { describe, expect, it } from 'vitest'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import { can, permissionExistsInScope, type AuthzSubject } from '../check'
import { GRANTABLE_MODULE_PERMISSIONS } from '../permissions'

const P1 = { kind: 'project', projectId: 'p1' } as const
const P2 = { kind: 'project', projectId: 'p2' } as const
const T1 = { kind: 'tenant', tenantId: 't1' } as const
const T2 = { kind: 'tenant', tenantId: 't2' } as const
const PLATFORM = { kind: 'platform' } as const

const editorOnP1: AuthzSubject = {
  platformRole: 'tenant_user',
  projects: [{ projectId: 'p1', permissions: ['blog.post.write', 'forms.submission.read'] }],
  tenants: [{ tenantId: 't1', permissions: [] }],
}
const ownerOfT1: AuthzSubject = {
  platformRole: 'tenant_user',
  projects: [{ projectId: 'p1', permissions: ['users.invite'] }],
  tenants: [{ tenantId: 't1', permissions: ['billing.invoice.read', 'users.invite'] }],
}
const superAdmin: AuthzSubject = { platformRole: 'abluo_admin', projects: [], tenants: [] }

describe('can()', () => {
  it('no subject → false', () => {
    expect(can(null, 'blog.post.write', P1)).toBe(false)
    expect(can(undefined, 'blog.post.write', P1)).toBe(false)
  })
  it('granted on this project → true', () => expect(can(editorOnP1, 'blog.post.write', P1)).toBe(true))
  it('same permission on another project → false', () => expect(can(editorOnP1, 'blog.post.write', P2)).toBe(false))
  it('not in the grant → false', () => expect(can(editorOnP1, 'blog.post.delete', P1)).toBe(false))
  it('unknown permission → false even if a grant lists it', () => {
    const forged: AuthzSubject = { platformRole: 'tenant_user', projects: [{ projectId: 'p1', permissions: ['lead.read'] }] }
    expect(can(forged, 'lead.read', P1)).toBe(false)
  })
  it('a permission asked in a scope it does not exist in → false', () => {
    const forged: AuthzSubject = {
      platformRole: 'tenant_user',
      projects: [{ projectId: 'p1', permissions: ['billing.invoice.read'] }],
      tenants: [{ tenantId: 't1', permissions: ['blog.post.write'] }],
    }
    expect(can(forged, 'billing.invoice.read', P1)).toBe(false) // tenant-only
    expect(can(forged, 'blog.post.write', T1)).toBe(false) // module permissions are project-only
  })
  it('tenant permissions are per tenant', () => {
    expect(can(ownerOfT1, 'billing.invoice.read', T1)).toBe(true)
    expect(can(ownerOfT1, 'billing.invoice.read', T2)).toBe(false)
  })
  it('tenant users hold no platform permission', () => {
    expect(can(ownerOfT1, 'tenants.manage', PLATFORM)).toBe(false)
    expect(can(ownerOfT1, 'support.access', PLATFORM)).toBe(false)
  })
  it('Super Admin holds platform permissions', () => {
    expect(can(superAdmin, 'tenants.manage', PLATFORM)).toBe(true)
    expect(can(superAdmin, 'support.access', PLATFORM)).toBe(true)
  })
  it('Super Admin does NOT implicitly hold tenant or project permissions', () => {
    expect(can(superAdmin, 'blog.post.write', P1)).toBe(false)
    expect(can(superAdmin, 'forms.submission.read', P1)).toBe(false)
    expect(can(superAdmin, 'billing.invoice.read', T1)).toBe(false)
  })
  it('Super Admin with a real membership is judged on that membership', () => {
    const adminWithGrant: AuthzSubject = { ...superAdmin, projects: [{ projectId: 'p1', permissions: ['blog.post.write'] }] }
    expect(can(adminWithGrant, 'blog.post.write', P1)).toBe(true)
    expect(can(adminWithGrant, 'blog.post.write', P2)).toBe(false)
  })
  it('a missing tenants list is treated as no tenant grants', () => {
    const s: AuthzSubject = { platformRole: 'tenant_user', projects: [] }
    expect(can(s, 'billing.invoice.read', T1)).toBe(false)
  })
})

describe('permissionExistsInScope', () => {
  it('module permissions exist only at project level', () => {
    expect(permissionExistsInScope('blog.post.write', 'project')).toBe(true)
    expect(permissionExistsInScope('blog.post.write', 'tenant')).toBe(false)
    expect(permissionExistsInScope('blog.post.write', 'platform')).toBe(false)
  })
  it('users.invite exists at tenant and project level, not platform', () => {
    expect(permissionExistsInScope('users.invite', 'tenant')).toBe(true)
    expect(permissionExistsInScope('users.invite', 'project')).toBe(true)
    expect(permissionExistsInScope('users.invite', 'platform')).toBe(false)
  })
})

describe('grantable module permissions', () => {
  it('every listed id is a real module permission', () => {
    for (const id of Object.keys(GRANTABLE_MODULE_PERMISSIONS)) expect(MODULE_PERMISSION_MAP[id]).toBeDefined()
  })
  it('every prerequisite is itself grantable', () => {
    for (const rule of Object.values(GRANTABLE_MODULE_PERMISSIONS)) {
      if (rule.requires) expect(GRANTABLE_MODULE_PERMISSIONS[rule.requires]).toBeDefined()
    }
  })
})
