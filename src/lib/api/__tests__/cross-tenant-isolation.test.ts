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
 * Slice 3a (the Sanity chokepoint) and slice 3b (the entitlement +
 * permission guard, `assertModuleAction`/`canModuleAction` in
 * `../module-action-guard`) are both implemented and covered below.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  assembleProjectGrants,
  permissionsForRole,
  type ProjectGrant,
  type RawOwnedProject,
  type RawProjectMembership,
  type TenantAuthorizationContext,
} from '../tenant-context'
import {
  assertSameTenantReference,
  TenantAuthorizationError,
  tenantScopedSanityClient,
} from '../tenant-scoped-sanity'
import { assertModuleAction, canModuleAction } from '../module-action-guard'
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

describe('slice 3a — Sanity chokepoint: tenant-scoped Sanity client', () => {
  // userEditorA1: project_members editor on A1 ("livener-main") only —
  // deliberately NOT granted on A2 ("livener-events"), the sibling project
  // in the same tenant, to exercise the "same tenant, no grant" case.
  const grantA1: ProjectGrant = {
    projectId: 'project-a1',
    projectSlug: 'livener-main',
    membershipId: 'pm-editor-a1',
    role: 'editor',
    permissions: [],
    enabledModuleIds: [],
  }
  const ctxEditorA1: TenantAuthorizationContext = {
    userId: 'user-editor-a1',
    platformRole: 'tenant_user',
    projects: [grantA1],
  }

  // userSpanning-equivalent grant on tenant B's project, used for the
  // cross-tenant reference case.
  const grantB1: ProjectGrant = {
    projectId: 'project-b1',
    projectSlug: 'studiomartegani-main',
    membershipId: 'pm-viewer-b1',
    role: 'viewer',
    permissions: [],
    enabledModuleIds: [],
  }

  it("rejects requesting a scoped client for a projectId not in the context", () => {
    expect(() => tenantScopedSanityClient(ctxEditorA1, 'project-not-granted')).toThrow(
      TenantAuthorizationError
    )
  })

  it('overrides a caller-supplied projectSlug with the grant\'s slug — cannot read another project', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    const scoped = tenantScopedSanityClient(ctxEditorA1, 'project-a1', { fetch: mockFetch })

    await scoped.fetch(`*[_type == "post" && projectSlug == $projectSlug]`, {
      // Attempted cross-tenant read: caller supplies a different project's
      // slug in params.
      projectSlug: 'studiomartegani-main',
      someOtherParam: 'unchanged',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, calledParams] = mockFetch.mock.calls[0]
    // The grant's own slug wins — the caller-supplied value is never honored.
    expect(calledParams.projectSlug).toBe('livener-main')
    expect(calledParams.someOtherParam).toBe('unchanged')
  })

  it('rejects a query that does not reference $projectSlug', () => {
    const mockFetch = vi.fn().mockResolvedValue(null)
    const scoped = tenantScopedSanityClient(ctxEditorA1, 'project-a1', { fetch: mockFetch })

    // The guard throws synchronously before a promise is ever constructed.
    expect(() => scoped.fetch(`*[_type == "post"]`)).toThrow(TenantAuthorizationError)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a document reference that resolves to a different tenant\'s projectSlug', async () => {
    // The referenced document actually belongs to tenant B's project, while
    // the caller only holds a grant on tenant A's project A1.
    const mockFetch = vi.fn().mockResolvedValue({ projectSlug: 'studiomartegani-main' })
    const scoped = tenantScopedSanityClient(ctxEditorA1, 'project-a1', { fetch: mockFetch })

    await expect(
      assertSameTenantReference(scoped, 'some-doc-id', grantA1)
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it('accepts a document reference that resolves to the same project\'s projectSlug', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ projectSlug: 'livener-main' })
    const scoped = tenantScopedSanityClient(ctxEditorA1, 'project-a1', { fetch: mockFetch })

    await expect(assertSameTenantReference(scoped, 'some-doc-id', grantA1)).resolves.toBeUndefined()
  })

  it('a project-only editor cannot read or write Sanity documents for a sibling project in the same tenant they are not granted on', () => {
    // A2 ("livener-events") is in the SAME tenant as A1, but ctxEditorA1
    // holds no grant for it — sibling-project access must still be rejected.
    expect(() => tenantScopedSanityClient(ctxEditorA1, 'project-a2')).toThrow(
      TenantAuthorizationError
    )
  })

  it("a caller holding grantB1 cannot use it to reference-guard project A1's documents", async () => {
    // Independent check: passing grantB1 (a real grant, just for the wrong
    // project) into assertSameTenantReference alongside a client scoped to
    // A1 must still reject, since the referenced doc belongs to A1, not B1.
    const ctxSpanning: TenantAuthorizationContext = {
      userId: 'user-spanning',
      platformRole: 'tenant_user',
      projects: [grantA1, grantB1],
    }
    const mockFetch = vi.fn().mockResolvedValue({ projectSlug: 'livener-main' })
    const scoped = tenantScopedSanityClient(ctxSpanning, 'project-a1', { fetch: mockFetch })

    await expect(
      assertSameTenantReference(scoped, 'some-doc-id', grantB1)
    ).rejects.toThrow(TenantAuthorizationError)
  })
})

describe('slice 3b — entitlement + permission guard', () => {
  const ctxA1Editor: TenantAuthorizationContext = {
    userId: 'user-editor-a1',
    platformRole: 'tenant_user',
    projects: grantsFor({ ownedProjects: [], memberships: [membershipEditorA1] }),
  }

  const ctxOwnerA: TenantAuthorizationContext = {
    userId: 'user-owner-a',
    platformRole: 'tenant_user',
    projects: grantsFor({ ownedProjects: [projectA1, projectA2], memberships: [] }),
  }

  it("blocks an action when the owning module is disabled for the project, even though the resolved grant's permission list (erroneously) includes it — proves the module-installed check runs FIRST and independently of the permission list", () => {
    // Deliberately hand-built (not produced by assembleProjectGrants): a
    // stale/inconsistent grant where 'events.event.write' made it into
    // `permissions` even though 'events' is absent from `enabledModuleIds`.
    // This is the case that proves ordering — if the guard only consulted
    // `permissions`, this call would wrongly succeed.
    const inconsistentGrant: ProjectGrant = {
      projectId: 'project-a1',
      projectSlug: 'livener-main',
      membershipId: 'pm-editor-a1',
      role: 'editor',
      permissions: ['blog.post.write', 'blog.post.read', 'events.event.write'],
      enabledModuleIds: ['blog'], // 'events' NOT installed
    }
    const ctx: TenantAuthorizationContext = {
      userId: 'user-editor-a1',
      platformRole: 'tenant_user',
      projects: [inconsistentGrant],
    }

    expect(() => assertModuleAction(ctx, 'project-a1', 'events.event.write')).toThrow(
      TenantAuthorizationError
    )
    expect(() => assertModuleAction(ctx, 'project-a1', 'events.event.write')).toThrow(
      /module "events" is not installed/
    )
    expect(canModuleAction(ctx, 'project-a1', 'events.event.write')).toBe(false)
  })

  it('per-membership permission isolation: a viewer is denied a write-gated permission that an editor/owner on the same project would have', () => {
    // project-a2 has both 'blog' and 'events' enabled (fixture world), so
    // the module-installed check passes for both roles — isolating this
    // case to the permission check alone (step 5).
    const viewerGrants = grantsFor({
      ownedProjects: [],
      memberships: [
        { membershipId: 'pm-viewer-a2', projectId: 'project-a2', projectSlug: 'livener-events', role: 'viewer' },
      ],
    })
    const ctxViewerA2: TenantAuthorizationContext = {
      userId: 'user-viewer-a2',
      platformRole: 'tenant_user',
      projects: viewerGrants,
    }

    // Owner (via ctxOwnerA, which owns A1+A2) holds the write permission...
    expect(() => assertModuleAction(ctxOwnerA, 'project-a2', 'blog.post.write')).not.toThrow()
    // ...but the viewer on the very same project is denied it.
    expect(() => assertModuleAction(ctxViewerA2, 'project-a2', 'blog.post.write')).toThrow(
      TenantAuthorizationError
    )
    expect(() => assertModuleAction(ctxViewerA2, 'project-a2', 'blog.post.write')).toThrow(
      /does not grant permission/
    )
    expect(canModuleAction(ctxViewerA2, 'project-a2', 'blog.post.write')).toBe(false)
    // The viewer still gets the read permission on that same project — the
    // denial is permission-specific, not a blanket project lockout.
    expect(canModuleAction(ctxViewerA2, 'project-a2', 'blog.post.read')).toBe(true)
  })

  it('a user acting on a project they hold no grant in is rejected, before any module/permission reasoning', () => {
    // ctxA1Editor has a grant only on project-a1 — project-b1 is untouched.
    expect(() => assertModuleAction(ctxA1Editor, 'project-b1', 'blog.post.write')).toThrow(
      TenantAuthorizationError
    )
    expect(() => assertModuleAction(ctxA1Editor, 'project-b1', 'blog.post.write')).toThrow(
      /no ProjectGrant for project "project-b1"/
    )
    expect(canModuleAction(ctxA1Editor, 'project-b1', 'blog.post.write')).toBe(false)
  })

  it('positive control: an owner/editor with the module installed and the permission granted is allowed', () => {
    // Editor on project-a1, 'blog' installed, 'blog.post.write' granted to editor.
    expect(() => assertModuleAction(ctxA1Editor, 'project-a1', 'blog.post.write')).not.toThrow()
    expect(canModuleAction(ctxA1Editor, 'project-a1', 'blog.post.write')).toBe(true)

    // Owner on project-a2, both 'blog' and 'events' installed, owner holds
    // events.event.write (defaultRoles: ['owner'] only in the fixture map).
    expect(() => assertModuleAction(ctxOwnerA, 'project-a2', 'events.event.write')).not.toThrow()
    expect(canModuleAction(ctxOwnerA, 'project-a2', 'events.event.write')).toBe(true)
  })

  it('ADR-015 required matrix case, made explicit: a module disabled for one tenant\'s project is denied even though the SAME module is enabled for a DIFFERENT tenant\'s project — tenant B\'s enabled-module state never leaks into tenant A\'s grant, or vice versa', () => {
    // 'events' is enabled on project-a2 (tenant A) but NOT on project-b1
    // (tenant B) in the fixture world (enabledModuleIdsByProjectId, top of
    // file). A single spanning user (owns tenant A, holds a viewer grant on
    // tenant B's project) exercises both sides of the same check in one
    // context, proving the module-installed decision is per-grant, not
    // somehow shared or cached across the user's other memberships.
    const spanningGrants = grantsFor({
      ownedProjects: [projectA1, projectA2],
      memberships: [membershipViewerB1],
    })
    const ctxSpanning: TenantAuthorizationContext = {
      userId: 'user-spanning',
      platformRole: 'tenant_user',
      projects: spanningGrants,
    }

    // Tenant A's project A2: 'events' IS installed — the owner grant permits it.
    expect(canModuleAction(ctxSpanning, 'project-a2', 'events.event.write')).toBe(true)

    // The SAME user, on tenant B's project B1 (viewer grant, 'events' NOT
    // installed there): denied, and denied for the MODULE reason first, not
    // merely because a viewer lacks the permission.
    expect(() => assertModuleAction(ctxSpanning, 'project-b1', 'events.event.write')).toThrow(
      /module "events" is not installed/
    )
    expect(canModuleAction(ctxSpanning, 'project-b1', 'events.event.write')).toBe(false)
  })
})
