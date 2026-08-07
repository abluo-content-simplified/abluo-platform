/**
 * Cross-tenant isolation harness — ADR-017 slice 2.
 *
 * ── This suite is the release-blocking cross-tenant isolation gate ──────────
 * Per ADR-015 decision 10 (the cross-tenant isolation matrix commitment) and
 * ADR-017's Implementation Order step 2, this file is the canonical,
 * always-green isolation test suite for the platform's authorization model.
 * It MUST stay green. A failing test here means a user can see or act on
 * data outside their own tenant/project membership — treat any red test in
 * this file as a release blocker, not a flake to retry past.
 *
 * Scope of THIS slice: the pure, I/O-free assembly logic already exported
 * from `tenant-context.ts` — `assembleProjectGrants` and `permissionsForRole`
 * — exercised against an explicit two-tenant fixture world. It extends (does
 * not replace) `tenant-context.test.ts`'s per-function unit tests: this file
 * is organized around isolation INVARIANTS (named so a future regression is
 * immediately legible), not around function call shape.
 *
 * Deliberately NOT covered yet (scaffolded below as skipped placeholders,
 * to be filled in by later slices — see ADR-017 Implementation Order):
 *   - slice 3a: the Sanity chokepoint (tenant-scoped Sanity client) —
 *     rejecting a cross-tenant `projectSlug` or a cross-tenant document
 *     reference at the query layer.
 *   - slice 3b: the entitlement guard — a module-disabled project blocking
 *     an action even if the role would otherwise permit it, and per-
 *     membership permission isolation once real route wiring exists.
 * Neither the chokepoint nor the guard exist in the codebase yet; the
 * placeholder blocks below exist only to keep this file's shape ready so
 * those slices add cases here rather than starting a parallel suite.
 */
import { describe, expect, it } from 'vitest'
import {
  assembleProjectGrants,
  permissionsForRole,
  type RawOwnedProject,
  type RawProjectMembership,
} from '../tenant-context'
import type { ModulePermissionMap } from '@/lib/modules/types'

// ─── Fixture world: two tenants, five users ────────────────────────────────
//
// Tenant A ("livener"):
//   - project A1 ("livener-main")
//   - project A2 ("livener-events")
// Tenant B ("studiomartegani"):
//   - project B1 ("studiomartegani-main")
//
// Users:
//   - userOwnerA   — owns tenant A (tenant_members role='owner') → gets A1+A2 as owner
//   - userEditorA1 — project_members editor on A1 only → gets A1 as editor, nothing else
//   - userViewerB1 — project_members viewer on B1 only → gets B1 as viewer, nothing else
//   - userSpanning — owns tenant A AND holds a project_members viewer grant on B1
//                    → gets A1+A2 as owner, B1 as viewer (union across tenants)
//   - userNoMemberships — no tenant_members, no project_members rows anywhere
//                    → gets nothing

const fixturePermissionMap: ModulePermissionMap = {
  'blog.post.write': {
    id: 'blog.post.write',
    label: 'Write blog posts',
    description: 'Create and edit blog posts.',
    defaultRoles: ['owner', 'editor'],
  },
  'blog.post.read': {
    id: 'blog.post.read',
    label: 'Read blog posts',
    description: 'View blog posts.',
    defaultRoles: ['owner', 'editor', 'viewer'],
  },
  'events.event.write': {
    id: 'events.event.write',
    label: 'Write events',
    description: 'Create and edit events.',
    defaultRoles: ['owner'],
  },
}

const enabledModuleIdsByProjectId: Record<string, string[]> = {
  'project-a1': ['blog'],
  'project-a2': ['blog', 'events'],
  'project-b1': ['blog'],
}

const TENANT_A = 'tenant-livener'
const TENANT_B = 'tenant-studiomartegani'

const projectA1: RawOwnedProject = {
  projectId: 'project-a1',
  projectSlug: 'livener-main',
  tenantId: TENANT_A,
}
const projectA2: RawOwnedProject = {
  projectId: 'project-a2',
  projectSlug: 'livener-events',
  tenantId: TENANT_A,
}

const membershipEditorA1: RawProjectMembership = {
  membershipId: 'pm-editor-a1',
  projectId: 'project-a1',
  projectSlug: 'livener-main',
  role: 'editor',
}
const membershipViewerB1: RawProjectMembership = {
  membershipId: 'pm-viewer-b1',
  projectId: 'project-b1',
  projectSlug: 'studiomartegani-main',
  role: 'viewer',
}

/** Helper: assemble grants for a given user shape against the fixture world. */
function grantsFor(params: {
  ownedProjects: RawOwnedProject[]
  memberships: RawProjectMembership[]
}) {
  return assembleProjectGrants({
    ownedProjects: params.ownedProjects,
    memberships: params.memberships,
    enabledModuleIdsByProjectId,
    modulePermissionMap: fixturePermissionMap,
  })
}

// ─── Isolation invariants ───────────────────────────────────────────────────

describe('cross-tenant isolation invariants', () => {
  it('INVARIANT: a user never receives a project outside their memberships', () => {
    // userEditorA1: only an explicit project_members editor row on A1.
    const grants = grantsFor({
      ownedProjects: [],
      memberships: [membershipEditorA1],
    })

    const grantedProjectIds = grants.map((g) => g.projectId)
    expect(grantedProjectIds).toEqual(['project-a1'])
    // Explicitly assert the negative — A2 and B1 must never appear.
    expect(grantedProjectIds).not.toContain('project-a2')
    expect(grantedProjectIds).not.toContain('project-b1')
  })

  it('INVARIANT: a tenant-A-only user gets zero tenant-B projects', () => {
    // userOwnerA: owns tenant A only, no project_members rows anywhere.
    const grants = grantsFor({
      ownedProjects: [projectA1, projectA2],
      memberships: [],
    })

    expect(grants.map((g) => g.projectId).sort()).toEqual(['project-a1', 'project-a2'])
    expect(grants.some((g) => g.projectId === 'project-b1')).toBe(false)
  })

  it('INVARIANT: a project-only editor gets exactly their one project, as editor', () => {
    // userEditorA1 again, asserted from the role/permission angle this time.
    const grants = grantsFor({
      ownedProjects: [],
      memberships: [membershipEditorA1],
    })

    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      projectId: 'project-a1',
      role: 'editor',
      membershipId: 'pm-editor-a1',
    })
  })

  it('INVARIANT: a project-only viewer on tenant B gets exactly their one project, as viewer, and nothing from tenant A', () => {
    // userViewerB1: project_members viewer on B1 only, no tenant_members
    // row for tenant A or tenant B.
    const grants = grantsFor({
      ownedProjects: [],
      memberships: [membershipViewerB1],
    })

    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      projectId: 'project-b1',
      role: 'viewer',
      membershipId: 'pm-viewer-b1',
    })
    expect(grants.some((g) => g.projectId === 'project-a1' || g.projectId === 'project-a2')).toBe(
      false
    )
  })

  it('INVARIANT: a user spanning tenant A (owner) and tenant B (project viewer) gets exactly the union — nothing more, nothing less', () => {
    // userSpanning: owns tenant A, holds a project_members viewer grant on B1.
    const grants = grantsFor({
      ownedProjects: [projectA1, projectA2],
      memberships: [membershipViewerB1],
    })

    expect(grants).toHaveLength(3)
    const byId = Object.fromEntries(grants.map((g) => [g.projectId, g]))
    expect(byId['project-a1']?.role).toBe('owner')
    expect(byId['project-a2']?.role).toBe('owner')
    expect(byId['project-b1']?.role).toBe('viewer')
  })

  it('INVARIANT: owner-via-tenant precedence holds — a stray project_members row on an owned project never downgrades the grant', () => {
    // Same project (A1) both owned via tenant and (erroneously) present as
    // a project_members row — owner must win, never viewer/editor.
    const strayMembership: RawProjectMembership = {
      membershipId: 'pm-stray-a1',
      projectId: 'project-a1',
      projectSlug: 'livener-main',
      role: 'viewer',
    }

    const grants = grantsFor({
      ownedProjects: [projectA1],
      memberships: [strayMembership],
    })

    expect(grants).toHaveLength(1)
    expect(grants[0].role).toBe('owner')
    expect(grants[0].membershipId).toBe(`tenant-owner:${TENANT_A}`)
  })

  it('INVARIANT: permissions granted always match the resolved role, never a higher one', () => {
    const grants = grantsFor({
      ownedProjects: [],
      memberships: [membershipViewerB1],
    })

    const viewerGrant = grants.find((g) => g.projectId === 'project-b1')
    expect(viewerGrant?.role).toBe('viewer')
    // viewer must never receive a write permission.
    expect(viewerGrant?.permissions).not.toContain('blog.post.write')
    expect(viewerGrant?.permissions).toContain('blog.post.read')
  })

  it('INVARIANT: a user with no memberships anywhere gets an empty project set', () => {
    // userNoMemberships: no tenant_members, no project_members rows.
    const grants = grantsFor({
      ownedProjects: [],
      memberships: [],
    })

    expect(grants).toEqual([])
  })

  it('INVARIANT: permissionsForRole never leaks a permission for a module the target project has not enabled', () => {
    // project-b1 only has 'blog' enabled (not 'events') in the fixture world.
    const perms = permissionsForRole('owner', enabledModuleIdsByProjectId['project-b1'], fixturePermissionMap)
    expect(perms).not.toContain('events.event.write')
  })
})

// ─── Placeholders for later slices — scaffolded, not implemented ──────────
//
// These describe.skip blocks exist so the harness's SHAPE is ready before
// the enforcement points they test exist. Do not un-skip until the
// corresponding slice lands; do not delete — they are the agreed structure
// slices 3a/3b fill in.

describe.skip('slice 3a — Sanity chokepoint: tenant-scoped Sanity client (NOT YET IMPLEMENTED)', () => {
  // TODO(slice 3a): once a tenant-scoped Sanity client / query chokepoint
  // exists (ADR-017 Implementation Order step 3a), add cases here for:
  it.todo('rejects a query whose projectSlug does not match the caller\'s granted project')
  it.todo('rejects a document reference that resolves to a different tenant\'s projectSlug')
  it.todo('a project-only editor cannot read or write Sanity documents for a sibling project in the same tenant they are not granted on')
})

describe.skip('slice 3b — entitlement + permission guard (NOT YET IMPLEMENTED)', () => {
  // TODO(slice 3b): once the entitlement/permission enforcement guard exists
  // in the request path (ADR-017 Implementation Order step 3b), add cases
  // here for:
  it.todo('a module-disabled project blocks the corresponding action even when the caller\'s role would otherwise permit it')
  it.todo('per-membership permission isolation: an editor grant on project A does not confer any permission on project B, even within the same tenant')
  it.todo('a viewer-role permission set can never satisfy a write-gated guard check')
})
