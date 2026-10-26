/**
 * Access module (`members`, ADR-040 B2.1) — registration, permissions,
 * lifecycle and support mode, through the REAL registry, the REAL permission
 * resolver and the REAL assertModuleAction (no injected maps).
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { MODULE_REGISTRY } from '../registry'
import { MODULE_PERMISSION_MAP } from '../permissions'
import { MODULE_DASHBOARD_ROUTES } from '../client-navigation'
import { resolveProjectPermissions } from '@/lib/authz/resolve'
import { GRANTABLE_MODULE_PERMISSIONS, isProjectGrantable, projectGrantableIds } from '@/lib/authz/permissions'
import type { AccessRole } from '@/lib/authz/roles'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { buildSupportAuthorizationContext } from '@/lib/support/context'
import { SUPPORT_NEVER_WRITES, supportRefuses, type SupportSession } from '@/lib/support/state'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { ACCESS_MODULE_ID, ACCESS_PERMISSIONS } from '@/lib/access/model'
import { authorizeAccessManagement, createGroup } from '@/lib/access/management'
import { evaluateAccess, parseAccessPolicy } from '@/lib/access/policy'
import { createFakeStore } from '@/lib/access/__tests__/fake-store'

const READ = ACCESS_PERMISSIONS.read
const MANAGE = ACCESS_PERMISSIONS.manage
const P_A = '0a000000-0000-4000-8000-00000000000a'
const P_B = '0b000000-0000-4000-8000-00000000000b'
const manifest = MODULE_REGISTRY.find((m) => m.id === ACCESS_MODULE_ID)!

function grant(projectId: string, role: AccessRole, opts: { enabled?: boolean; extras?: string[] } = {}): ProjectGrant {
  const enabledModuleIds = opts.enabled === false ? ['blog'] : ['blog', ACCESS_MODULE_ID]
  return {
    projectId,
    projectSlug: asSupabaseProjectSlug(projectId === P_A ? 'site-a' : 'site-b'),
    membershipId: `m-${role}`,
    role,
    permissions: resolveProjectPermissions({ role, enabledModuleIds, projectExtras: opts.extras }).permissions,
    enabledModuleIds,
  }
}
const ctx = (...projects: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects })
const canManage = (c: TenantAuthorizationContext, projectId: string) => {
  try { authorizeAccessManagement(c, projectId, 'manage'); return true } catch { return false }
}
const canRead = (c: TenantAuthorizationContext, projectId: string) => {
  try { authorizeAccessManagement(c, projectId, 'read'); return true } catch { return false }
}

describe('registration', () => {
  it('is registered once as `members`, shown as "Access", reusable (no tenant specifics)', () => {
    expect(MODULE_REGISTRY.filter((m) => m.id === 'members')).toHaveLength(1)
    expect(manifest.label).toBe('Access')
    expect(manifest.status).toBe('released')
    expect(JSON.stringify(manifest).toLowerCase()).not.toMatch(/cyce|hoffmann|livener|martegani|nologo/)
  })
  it('owns no Sanity types or sections and no Sanity config; its one Studio collection is "Protected pages" (R9: page protection is set in Studio)', () => {
    const pc = manifest.platformContract
    expect(pc.schemaTypes).toEqual([])
    expect(pc.sectionTypes).toEqual([])
    expect(pc.collections.map((c) => c.id)).toEqual(['access-pages'])
    expect(pc.configSchema).toEqual([])
    expect(pc.schemaDefinitions()).toEqual([])
    expect(pc.pageType).toBeUndefined()
  })
  it('declares exactly the two permissions the access library checks', () => {
    expect(manifest.platformContract.permissions.map((p) => p.id).sort()).toEqual([MANAGE, READ].sort())
    expect(MODULE_PERMISSION_MAP[READ]).toBeDefined()
    expect(MODULE_PERMISSION_MAP[MANAGE]).toBeDefined()
  })
  it('permission ids follow {module}.{noun}.{verb} with the ADR-028 verbs', () => {
    for (const p of manifest.platformContract.permissions) expect(p.id).toMatch(/^members\.access\.(read|manage)$/)
  })
  it('has its dashboard screen at /{project}/access (B2.5)', () => {
    expect(MODULE_DASHBOARD_ROUTES[ACCESS_MODULE_ID]).toBe('access')
  })
})

describe('default permissions', () => {
  it('Owner and Site admin hold read + manage when the module is enabled', () => {
    for (const role of ['owner', 'admin'] as const) {
      const g = grant(P_A, role)
      expect(g.permissions).toEqual(expect.arrayContaining([READ, MANAGE]))
      expect(canManage(ctx(g), P_A)).toBe(true)
    }
  })
  it('Editor holds neither by default, and the retired viewer / extras-only member neither', () => {
    for (const role of ['editor', 'viewer', 'member'] as const) {
      const g = grant(P_A, role)
      expect(g.permissions).not.toContain(READ)
      expect(g.permissions).not.toContain(MANAGE)
      expect(canRead(ctx(g), P_A)).toBe(false)
      expect(canManage(ctx(g), P_A)).toBe(false)
    }
  })
})

describe('extras — the existing permission-granting mechanism', () => {
  it('both are grantable project extras; manage requires read', () => {
    expect(GRANTABLE_MODULE_PERMISSIONS[READ]).toEqual({})
    expect(GRANTABLE_MODULE_PERMISSIONS[MANAGE]).toEqual({ requires: READ })
    expect(isProjectGrantable(READ)).toBe(true)
    expect(projectGrantableIds()).toEqual(expect.arrayContaining([READ, MANAGE]))
  })
  it('an Editor given read sees, given read + manage manages', () => {
    expect(canRead(ctx(grant(P_A, 'editor', { extras: [READ] })), P_A)).toBe(true)
    expect(canManage(ctx(grant(P_A, 'editor', { extras: [READ] })), P_A)).toBe(false)
    expect(canManage(ctx(grant(P_A, 'editor', { extras: [READ, MANAGE] })), P_A)).toBe(true)
  })
  it('manage without its prerequisite is not honoured', () => {
    const r = resolveProjectPermissions({ role: 'editor', enabledModuleIds: [ACCESS_MODULE_ID], projectExtras: [MANAGE] })
    expect(r.permissions).not.toContain(MANAGE)
    expect(r.ignoredExtras).toContain(MANAGE)
  })
  it('extras are ignored while the module is not enabled on the project', () => {
    const r = resolveProjectPermissions({ role: 'editor', enabledModuleIds: ['blog'], projectExtras: [READ, MANAGE] })
    expect(r.permissions).not.toContain(READ)
    expect(r.ignoredExtras).toEqual(expect.arrayContaining([READ, MANAGE]))
  })
})

describe('tenant isolation', () => {
  it('the Owner of site A cannot manage or even read site B', () => {
    const c = ctx(grant(P_A, 'owner'))
    expect(canManage(c, P_B)).toBe(false)
    expect(canRead(c, P_B)).toBe(false)
  })
  it('an Editor with extras on A has nothing on B where they are only an Editor', () => {
    const c = ctx(grant(P_A, 'editor', { extras: [READ, MANAGE] }), grant(P_B, 'editor'))
    expect(canManage(c, P_A)).toBe(true)
    expect(canManage(c, P_B)).toBe(false)
  })
  it('a grant made for A acts on A only, whatever it is later used for', async () => {
    const store = createFakeStore()
    const g = authorizeAccessManagement(ctx(grant(P_A, 'owner')), P_A, 'manage')
    const id = await createGroup(store, g, { name: { en: 'Members' } })
    expect(store.groups.find((x) => x.id === id)?.projectId).toBe(P_A)
    expect(store.groups.some((x) => x.projectId === P_B)).toBe(false)
  })
})

describe('lifecycle — disabling never opens anything and never deletes anything', () => {
  it('module disabled: nobody can manage (not even the Owner), and restricted resources stay closed', () => {
    const owner = ctx(grant(P_A, 'owner', { enabled: false }))
    expect(canManage(owner, P_A)).toBe(false)
    expect(canRead(owner, P_A)).toBe(false)
    const chain = [parseAccessPolicy({ visibility: 'restricted', groups: ['11111111-1111-4111-8111-111111111111'] })]
    const visitor = { sessionId: 's', groupIds: new Set(['11111111-1111-4111-8111-111111111111']) }
    expect(evaluateAccess({ chain, visitor, moduleEnabled: false })).toEqual({ allowed: false, reason: 'module_unavailable' })
  })

  it('no code outside the access library touches site_access data, and the library deletes nothing', () => {
    const SRC = resolve(__dirname, '../../..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name) || p.includes(`${join('lib', 'access')}`) || p.includes('__tests__')) continue
        if (/site_access_|site-access-files/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
    const store = readFileSync(join(SRC, 'lib/access/store.ts'), 'utf8')
    expect(store).not.toMatch(/\.delete\(|site_access_purge|storage\.from/)
  })

  it('the Studio module pane only ever writes the installation record (enabled flag / config)', () => {
    const save = readFileSync(resolve(__dirname, '../../sanity/studio/module-save.ts'), 'utf8')
    expect(save).not.toMatch(/supabase|site_access/i)
  })
})

describe('support mode (ADR-028 §8)', () => {
  const NOW = Date.parse('2026-10-24T12:00:00Z')
  const iso = (min: number) => new Date(NOW + min * 60_000).toISOString()
  const session = (over: Partial<SupportSession> = {}): SupportSession => ({
    id: 'sup1', projectId: P_A, adminUserId: 'admin1', role: 'owner', status: 'viewing',
    startedAt: iso(-5), requestedAt: null, decidedAt: null, decidedBy: null, expiresAt: null,
    revokedAt: null, contactRequestsShownAt: null, endedAt: null, ...over,
  })
  const support = (s: SupportSession, purpose: 'render' | 'mutation') => buildSupportAuthorizationContext({
    actor: { userId: 'admin1', platformRole: 'abluo_admin' },
    session: s,
    project: { id: P_A, slug: asSupabaseProjectSlug('site-a'), name: 'A' },
    enabledModuleIds: [ACCESS_MODULE_ID],
    purpose,
    now: NOW,
  })

  it('viewing: support may see the Access screens but not change anything', () => {
    expect(canRead(support(session(), 'render'), P_A)).toBe(true)
    expect(canManage(support(session(), 'mutation'), P_A)).toBe(false)
  })
  it('a pending or declined request still changes nothing', () => {
    expect(canManage(support(session({ status: 'requested', requestedAt: iso(-1) }), 'mutation'), P_A)).toBe(false)
    expect(canManage(support(session({ status: 'declined', decidedAt: iso(-1) }), 'mutation'), P_A)).toBe(false)
  })
  // Tom, 2026-10-24: support never manages a tenant's shared passwords, even
  // with live edit approval — enforced server-side in the permission filter
  // AND at the point of use (supportRefuses), not only by hiding the UI.
  const allowed = () => session({ status: 'allowed', requestedAt: iso(-5), decidedAt: iso(-4), decidedBy: 'owner1', expiresAt: iso(30) })
  it('never manages Access, even with the client\'s live edit approval', () => {
    expect(SUPPORT_NEVER_WRITES).toContain(MANAGE)
    expect(canManage(support(allowed(), 'mutation'), P_A)).toBe(false)
    expect(support(allowed(), 'mutation').projects[0].permissions).not.toContain(MANAGE)
    const expired = session({ status: 'allowed', requestedAt: iso(-90), decidedAt: iso(-80), decidedBy: 'owner1', expiresAt: iso(-1) })
    expect(canManage(support(expired, 'mutation'), P_A)).toBe(false)
  })
  it('the point-of-use check refuses it too, even if a grant somehow carried it', () => {
    expect(supportRefuses({ purpose: 'mutation', writesAllowed: true }, MANAGE)).toBe(true)
    expect(supportRefuses({ purpose: 'mutation', writesAllowed: true }, READ)).toBe(false)
  })
  it('keeps the non-sensitive support capabilities: reading Access, and other approved edits', () => {
    expect(canRead(support(allowed(), 'mutation'), P_A)).toBe(true)
    const writes = support(allowed(), 'mutation').projects[0].permissions.filter((p) => !p.endsWith('.read'))
    expect(writes.length).toBeGreaterThan(0)
    expect(writes).not.toContain(MANAGE)
  })
  it('no management function bypasses the check: each needs a grant that only authorizeAccessManagement mints', () => {
    const src = readFileSync(resolve(__dirname, '../../access/management.ts'), 'utf8')
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1])
    expect(exported.length).toBeGreaterThan(0)
    for (const name of exported) {
      const body = src.slice(src.indexOf(`export async function ${name}`)).split(/\nexport /)[0]
      const needs = /^(list|get)/.test(name) ? /requireRead\(grant\)/ : /requireManage\(grant\)/
      expect(body, name).toMatch(needs)
    }
  })
  it('support for site A reaches nothing on site B', () => {
    expect(canRead(support(session(), 'render'), P_B)).toBe(false)
  })
})
