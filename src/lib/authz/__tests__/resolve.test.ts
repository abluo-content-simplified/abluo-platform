/**
 * ADR-028 — effective permissions (role defaults ∪ extras), pure.
 */
import { describe, expect, it } from 'vitest'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { canManageMedia, canPerformModuleAction } from '@/lib/permissions'
import { resolveProjectPermissions, resolveTenantPermissions } from '../resolve'
import { PLATFORM_PERMISSIONS } from '../permissions'

const ALL_MODULES = MODULE_REGISTRY.map((m) => m.id)
const moduleOnly = (ids: string[]) => ids.filter((id) => id in MODULE_PERMISSION_MAP)
const platformIds = new Set(PLATFORM_PERMISSIONS.map((p) => p.id))

describe('module permissions — identical to the current resolver (no behaviour change in step 1)', () => {
  const moduleSets: string[][] = [[], ['blog'], ['forms'], ['blog', 'forms', 'gallery'], ALL_MODULES]
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    for (const enabled of moduleSets) {
      it(`${role} with [${enabled.join(',') || 'none'}]`, () => {
        const next = moduleOnly(resolveProjectPermissions({ role, enabledModuleIds: enabled }).permissions)
        // The pre-ADR-028 derivation, computed independently.
        const installs = enabled.map((moduleId) => ({ moduleId, version: '0', enabled: true, installedAt: '', config: {}, provenance: 'admin' as const }))
        const old = Object.keys(MODULE_PERMISSION_MAP).filter((id) => canPerformModuleAction(role, id, installs, MODULE_PERMISSION_MAP))
        expect(next).toEqual(old.sort())
      })
    }
  }
})

describe('Project Admin', () => {
  it('holds every module permission an Owner holds on the project', () => {
    const owner = moduleOnly(resolveProjectPermissions({ role: 'owner', enabledModuleIds: ALL_MODULES }).permissions)
    const admin = moduleOnly(resolveProjectPermissions({ role: 'admin', enabledModuleIds: ALL_MODULES }).permissions)
    expect(admin).toEqual(owner)
  })
  it('manages people and settings on the project but cannot add modules', () => {
    const p = resolveProjectPermissions({ role: 'admin', enabledModuleIds: [] }).permissions
    expect(p).toEqual(expect.arrayContaining(['users.invite', 'users.manage', 'settings.manage', 'media.library.manage']))
    expect(p).not.toContain('modules.manage')
  })
  it('never holds tenant or platform permissions on a project', () => {
    const p = resolveProjectPermissions({ role: 'admin', enabledModuleIds: ALL_MODULES }).permissions
    for (const id of ['billing.invoice.read', 'billing.manage', 'tenants.manage', 'support.access']) expect(p).not.toContain(id)
  })
})

describe('media.library.manage matches the old canManageMedia rule', () => {
  for (const role of ['owner', 'editor', 'viewer'] as const) {
    it(role, () => {
      const p = resolveProjectPermissions({ role, enabledModuleIds: [] }).permissions
      expect(p.includes('media.library.manage')).toBe(canManageMedia(role))
    })
  }
})

describe('Editor', () => {
  it('has no people, settings or module powers', () => {
    const p = resolveProjectPermissions({ role: 'editor', enabledModuleIds: ALL_MODULES }).permissions
    for (const id of ['users.invite', 'users.manage', 'settings.manage', 'modules.manage']) expect(p).not.toContain(id)
  })
})

describe('Member (tenant role carrying extras only)', () => {
  it('has nothing by default', () => {
    expect(resolveProjectPermissions({ role: 'member', enabledModuleIds: ALL_MODULES }).permissions).toEqual([])
  })
  it('a tenant extra applies on the project when its module is enabled', () => {
    const r = resolveProjectPermissions({
      role: 'member',
      enabledModuleIds: ['forms'],
      tenantExtras: ['forms.submission.read'],
    })
    expect(r.permissions).toEqual(['forms.submission.read'])
    expect(r.ignoredExtras).toEqual([])
  })
  it('an extra never resurrects a disabled module', () => {
    const r = resolveProjectPermissions({ role: 'member', enabledModuleIds: [], tenantExtras: ['forms.submission.read'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual(['forms.submission.read'])
  })
})

describe('extras are honoured only when valid — fail closed', () => {
  const base = { role: 'member' as const, enabledModuleIds: ['forms', 'blog'] }
  it('unknown ids are ignored', () => {
    const r = resolveProjectPermissions({ ...base, projectExtras: ['lead.read', 'forms.submission.reed'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual(['forms.submission.reed', 'lead.read'])
  })
  it('non-grantable permissions written into the column are ignored', () => {
    const r = resolveProjectPermissions({
      ...base,
      projectExtras: ['forms.submission.delete', 'blog.post.write', 'users.manage', 'modules.manage', 'tenants.manage'],
    })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toHaveLength(5)
  })
  it('a tenant-only permission on a PROJECT membership is ignored', () => {
    const r = resolveProjectPermissions({ ...base, projectExtras: ['billing.invoice.read'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual(['billing.invoice.read'])
  })
  it('a tenant-only permission on the TENANT membership is not reported as ignored at project level', () => {
    const r = resolveProjectPermissions({ ...base, tenantExtras: ['billing.invoice.read'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual([])
  })
  it('update without read is not honoured', () => {
    const r = resolveProjectPermissions({ ...base, projectExtras: ['forms.submission.update'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual(['forms.submission.update'])
  })
  it('read + update together are honoured', () => {
    const r = resolveProjectPermissions({ ...base, projectExtras: ['forms.submission.read', 'forms.submission.update'] })
    expect(r.permissions).toEqual(['forms.submission.read', 'forms.submission.update'])
  })
  it('extras only add — they never remove a role default', () => {
    const without = resolveProjectPermissions({ role: 'owner', enabledModuleIds: ALL_MODULES }).permissions
    const withExtras = resolveProjectPermissions({
      role: 'owner',
      enabledModuleIds: ALL_MODULES,
      projectExtras: ['forms.submission.read', 'nonsense'],
    }).permissions
    expect(withExtras).toEqual(without)
  })
})

describe('tenant permissions', () => {
  it('Owner holds people and money', () => {
    expect(resolveTenantPermissions({ role: 'owner' }).permissions).toEqual(
      ['billing.invoice.read', 'billing.manage', 'users.invite', 'users.manage'].sort()
    )
  })
  it('Member holds nothing by default', () => {
    expect(resolveTenantPermissions({ role: 'member' }).permissions).toEqual([])
  })
  it('Member + invoices extra sees invoices only', () => {
    const r = resolveTenantPermissions({ role: 'member', tenantExtras: ['billing.invoice.read'] })
    expect(r.permissions).toEqual(['billing.invoice.read'])
  })
  it('non-grantable tenant permissions as extras are ignored', () => {
    const r = resolveTenantPermissions({ role: 'member', tenantExtras: ['billing.manage', 'users.invite', 'x.y'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual(['billing.manage', 'users.invite', 'x.y'])
  })
  it('project-scoped extras on the tenant membership are not tenant permissions (resolved per project)', () => {
    const r = resolveTenantPermissions({ role: 'member', tenantExtras: ['forms.submission.read'] })
    expect(r.permissions).toEqual([])
    expect(r.ignoredExtras).toEqual([])
  })
})

describe('registry hygiene', () => {
  it('platform and module permission ids never collide', () => {
    for (const id of platformIds) expect(MODULE_PERMISSION_MAP[id]).toBeUndefined()
  })
  it('platform permissions do not use a module id as their prefix', () => {
    for (const id of platformIds) expect(ALL_MODULES).not.toContain(id.split('.')[0])
  })
  it('the members.* prefix is reserved for the Members area module (ADR-024)', () => {
    for (const id of platformIds) expect(id.startsWith('members.')).toBe(false)
  })
  it('every platform permission ends in a vocabulary verb', () => {
    const verbs = new Set(['read', 'write', 'update', 'delete', 'manage', 'invite', 'use', 'access'])
    for (const id of platformIds) expect(verbs.has(id.split('.').pop()!)).toBe(true)
  })
  it('platform-scope permissions are never grantable', () => {
    for (const p of PLATFORM_PERMISSIONS) if (p.defaults.platform) expect(p.grantable).toBe(false)
  })
})
