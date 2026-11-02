/**
 * ADR-041 D8 — billing locks on the authorization context.
 *
 * The permission lists are GENERATED from the registries, so a permission
 * added by a future module is covered without touching this file.
 */
import { describe, expect, it } from 'vitest'
import { can, permissionExistsInScope, type AuthzSubject } from '@/lib/authz/check'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { CONFIGURATION_PERMISSIONS } from '@/lib/client/surfaces'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import { isWritePermission } from '@/lib/support/state'
import { BILLING_LOCK_ALLOWED, applyBillingLocks, applyBillingLocksToContext, lockedPermissions } from '../locks'
import type { BillingState, ProjectBillingStatus } from '../lifecycle'

/** Every permission that can exist on a project grant. */
const PROJECT_PERMISSIONS = [
  ...PLATFORM_PERMISSIONS.filter((p) => p.defaults.project).map((p) => p.id),
  ...Object.keys(MODULE_PERMISSION_MAP),
].sort()
const PROJECT_WRITES = PROJECT_PERMISSIONS.filter(isWritePermission)
const PROJECT_READS = PROJECT_PERMISSIONS.filter((p) => !isWritePermission(p))
const TENANT_PERMISSIONS = PLATFORM_PERMISSIONS.filter((p) => p.defaults.tenant).map((p) => p.id)

const status = (state: BillingState): ProjectBillingStatus => ({ state, reason: 'payment_failed', clockStartedAt: new Date(0), day: 1, daysLeft: null })
const grant = (projectId: string, permissions = PROJECT_PERMISSIONS) => ({ projectId, permissions: [...permissions], role: 'owner' as const })

describe('the allowlist', () => {
  it('is exactly support tickets + received-inquiry handling (Tom, 2026-10-30)', () => {
    expect([...BILLING_LOCK_ALLOWED].sort()).toEqual(['forms.submission.delete', 'forms.submission.update', 'support.tickets.write'])
  })
  it('every allowlisted permission really exists in project scope (no typo can silently widen or narrow it)', () => {
    for (const p of BILLING_LOCK_ALLOWED) expect(permissionExistsInScope(p, 'project'), p).toBe(true)
  })
  it('contains no configuration permission — form setup, settings and modules stay locked', () => {
    for (const p of BILLING_LOCK_ALLOWED) {
      expect(CONFIGURATION_PERMISSIONS).not.toContain(p)
      expect(p.startsWith('forms.definition.')).toBe(false)
      expect(['site.details.write', 'settings.manage', 'modules.manage', 'connections.manage']).not.toContain(p)
    }
  })
})

describe('a locked project (generated over every registered permission)', () => {
  for (const state of ['locked', 'review'] as const) {
    it(`${state}: every write is removed except the allowlist; every read is kept`, () => {
      const [locked] = applyBillingLocks([grant('p1')], new Map([['p1', status(state)]]))
      const kept = new Set(locked.permissions)
      for (const p of PROJECT_WRITES) expect(kept.has(p), p).toBe(BILLING_LOCK_ALLOWED.has(p))
      for (const p of PROJECT_READS) expect(kept.has(p), p).toBe(true)
    })
  }
  for (const state of ['ok', 'reminder'] as const) {
    it(`${state}: nothing is removed`, () => {
      const [g] = applyBillingLocks([grant('p1')], new Map([['p1', status(state)]]))
      expect(g.permissions).toEqual(PROJECT_PERMISSIONS)
      expect(g.billing?.state).toBe(state)
    })
  }
  it('there are writes to strip at all (guards against an empty registry making this vacuous)', () => {
    expect(PROJECT_WRITES.length).toBeGreaterThan(10)
    expect(PROJECT_READS.length).toBeGreaterThan(5)
  })
  it('form configuration vs received inquiries, through can()', () => {
    const subject: AuthzSubject = {
      platformRole: 'tenant_user',
      projects: applyBillingLocks([grant('p1')], new Map([['p1', status('locked')]])),
      tenants: [{ tenantId: 't1', permissions: TENANT_PERMISSIONS }],
    }
    const P1 = { kind: 'project', projectId: 'p1' } as const
    expect(can(subject, 'forms.submission.read', P1)).toBe(true)
    expect(can(subject, 'forms.submission.update', P1)).toBe(true)
    expect(can(subject, 'forms.submission.delete', P1)).toBe(true)
    expect(can(subject, 'support.tickets.write', P1)).toBe(true)
    expect(can(subject, 'forms.definition.manage', P1)).toBe(false)
    expect(can(subject, 'site.details.write', P1)).toBe(false) // form notification recipients live here
    expect(can(subject, 'settings.manage', P1)).toBe(false)
    expect(can(subject, 'users.invite', P1)).toBe(false)
    expect(can(subject, 'billing.manage', { kind: 'tenant', tenantId: 't1' })).toBe(true)
  })
})

describe('isolation between projects (property test)', () => {
  // Small seeded PRNG — deterministic, no extra dependency.
  function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
  const STATES: BillingState[] = ['ok', 'reminder', 'locked', 'review']

  it('locking any subset of projects never changes any other project or any tenant grant (500 random cases)', () => {
    const r = rng(41)
    for (let run = 0; run < 500; run++) {
      const n = 1 + Math.floor(r() * 6)
      const projects = Array.from({ length: n }, (_, i) =>
        grant(`p${i}`, PROJECT_PERMISSIONS.filter(() => r() < 0.5)))
      const tenants = [{ tenantId: 't1', permissions: TENANT_PERMISSIONS.filter(() => r() < 0.7) }]
      const statuses = new Map<string, ProjectBillingStatus>()
      for (const p of projects) if (r() < 0.7) statuses.set(p.projectId, status(STATES[Math.floor(r() * 4)]))
      const before = JSON.stringify({ projects, tenants })

      const ctx = applyBillingLocksToContext({ platformRole: 'tenant_user', projects, tenants }, statuses)

      expect(JSON.stringify({ projects, tenants })).toBe(before) // input never mutated
      expect(ctx.tenants).toBe(tenants)                            // tenant grants untouched
      for (const p of projects) {
        const out = ctx.projects.find((x) => x.projectId === p.projectId)!
        const st = statuses.get(p.projectId)?.state
        const locked = st === 'locked' || st === 'review'
        expect(out.permissions).toEqual(locked ? lockedPermissions(p.permissions) : p.permissions)
        for (const perm of PROJECT_PERMISSIONS) {
          const scope = { kind: 'project', projectId: p.projectId } as const
          const original = can({ platformRole: 'tenant_user', projects, tenants }, perm, scope)
          const now = can(ctx, perm, scope)
          if (!locked) expect(now, `${p.projectId} ${perm}`).toBe(original)
          else expect(now).toBe(original && (!isWritePermission(perm) || BILLING_LOCK_ALLOWED.has(perm)))
        }
      }
      for (const perm of TENANT_PERMISSIONS) {
        const scope = { kind: 'tenant', tenantId: 't1' } as const
        expect(can(ctx, perm, scope)).toBe(can({ platformRole: 'tenant_user', projects, tenants }, perm, scope))
      }
    }
  })
})

describe('fail open, support mode, shape', () => {
  it('a project with no status (not billed or unknown) is returned unchanged, without a billing field', () => {
    const g = grant('p1')
    const [out] = applyBillingLocks([g], new Map())
    expect(out).toBe(g)
    expect('billing' in out).toBe(false)
  })
  it('an Abluo admin in a support visit is not billing-locked; the status is still attached for the banner', () => {
    const ctx = applyBillingLocksToContext(
      { platformRole: 'abluo_admin', projects: [grant('p1')], support: { purpose: 'render', writesAllowed: true } },
      new Map([['p1', status('review')]])
    )
    expect(ctx.projects[0].permissions).toEqual(PROJECT_PERMISSIONS)
    expect(ctx.projects[0].billing?.state).toBe('review')
  })
  it('keeps every other grant field (role, ids, modules)', () => {
    const g = { ...grant('p1'), membershipId: 'm1', enabledModuleIds: ['blog'] }
    const [out] = applyBillingLocks([g], new Map([['p1', status('locked')]]))
    expect(out).toMatchObject({ projectId: 'p1', membershipId: 'm1', enabledModuleIds: ['blog'], role: 'owner' })
  })
})
