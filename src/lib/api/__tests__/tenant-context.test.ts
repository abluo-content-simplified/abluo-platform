/**
 * TenantAuthorizationContext — pure assembly logic tests (ADR-017 slice 1).
 *
 * These cover `assembleProjectGrants` and `permissionsForRole`, the pure,
 * I/O-free functions factored out of `getTenantAuthorizationContext` for
 * testability — no live Supabase or Sanity connection needed, following the
 * fixture-injection style of `src/lib/sanity/__tests__/design-system-resolver.test.ts`.
 *
 * `getTenantAuthorizationContext()` itself crosses the Supabase `.from()`/
 * `.rpc()` and Sanity `fetch()` boundaries; no mock infra for those exists yet
 * in this repo (same deferral rationale as `auth.test.ts` for
 * `getAuthenticatedActor()`/`requireAbluoAdmin()`) — it is exercised manually
 * once wired into a route in a later ADR-017 slice.
 */
import { describe, expect, it } from 'vitest'
import {
  assembleProjectGrants,
  permissionsForRole,
  type RawOwnedProject,
  type RawProjectMembership,
} from '../tenant-context'
import type { ModulePermissionMap } from '@/lib/modules/types'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A minimal, self-contained permission map — independent of MODULE_REGISTRY. */
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
  'project-a': ['blog'],
  'project-b': ['blog', 'events'],
  'project-c': [],
}

// ─── permissionsForRole ──────────────────────────────────────────────────────

describe('permissionsForRole', () => {
  it('grants only permissions declared for modules that are enabled', () => {
    const perms = permissionsForRole('owner', ['blog'], fixturePermissionMap)
    expect(perms.sort()).toEqual(['blog.post.read', 'blog.post.write'])
  })

  it('excludes permissions for modules that are not enabled', () => {
    const perms = permissionsForRole('owner', [], fixturePermissionMap)
    expect(perms).toEqual([])
  })

  it('computes permissions correctly per role — editor gets write, viewer does not', () => {
    const editorPerms = permissionsForRole('editor', ['blog'], fixturePermissionMap)
    const viewerPerms = permissionsForRole('viewer', ['blog'], fixturePermissionMap)

    expect(editorPerms.sort()).toEqual(['blog.post.read', 'blog.post.write'])
    expect(viewerPerms).toEqual(['blog.post.read'])
  })

  it('computes permissions correctly for owner across multiple enabled modules', () => {
    const perms = permissionsForRole('owner', ['blog', 'events'], fixturePermissionMap)
    expect(perms.sort()).toEqual([
      'blog.post.read',
      'blog.post.write',
      'events.event.write',
    ])
  })

  it('excludes owner-only permissions for editor and viewer', () => {
    const editorPerms = permissionsForRole('editor', ['blog', 'events'], fixturePermissionMap)
    const viewerPerms = permissionsForRole('viewer', ['blog', 'events'], fixturePermissionMap)

    expect(editorPerms).not.toContain('events.event.write')
    expect(viewerPerms).not.toContain('events.event.write')
  })
})

// ─── assembleProjectGrants ────────────────────────────────────────────────────

describe('assembleProjectGrants', () => {
  it('grants all of a tenant-owned project set when the user owns the tenant', () => {
    const ownedProjects: RawOwnedProject[] = [
      { projectId: 'project-a', projectSlug: asSupabaseProjectSlug('livener'), tenantId: 'tenant-1' },
      { projectId: 'project-b', projectSlug: asSupabaseProjectSlug('studiomartegani'), tenantId: 'tenant-1' },
    ]

    const grants = assembleProjectGrants({
      ownedProjects,
      memberships: [],
      enabledModuleIdsByProjectId,
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toHaveLength(2)
    expect(grants.every((g) => g.role === 'owner')).toBe(true)
    expect(grants.map((g) => g.projectId).sort()).toEqual(['project-a', 'project-b'])
    expect(grants.find((g) => g.projectId === 'project-a')?.membershipId).toBe(
      'tenant-owner:tenant-1'
    )
  })

  it('grants a single project_members editor row on project A only', () => {
    const memberships: RawProjectMembership[] = [
      { membershipId: 'pm-1', projectId: 'project-a', projectSlug: asSupabaseProjectSlug('livener'), role: 'editor' },
    ]

    const grants = assembleProjectGrants({
      ownedProjects: [],
      memberships,
      enabledModuleIdsByProjectId,
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      projectId: 'project-a',
      projectSlug: 'livener',
      membershipId: 'pm-1',
      role: 'editor',
    })
    expect(grants[0].permissions.sort()).toEqual(['blog.post.read', 'blog.post.write'])
  })

  it('unions grants for a user spanning two different tenants', () => {
    const ownedProjects: RawOwnedProject[] = [
      { projectId: 'project-a', projectSlug: asSupabaseProjectSlug('livener'), tenantId: 'tenant-1' },
    ]
    const memberships: RawProjectMembership[] = [
      { membershipId: 'pm-1', projectId: 'project-b', projectSlug: asSupabaseProjectSlug('studiomartegani'), role: 'viewer' },
    ]

    const grants = assembleProjectGrants({
      ownedProjects,
      memberships,
      enabledModuleIdsByProjectId,
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toHaveLength(2)
    const a = grants.find((g) => g.projectId === 'project-a')
    const b = grants.find((g) => g.projectId === 'project-b')
    expect(a?.role).toBe('owner')
    expect(b?.role).toBe('viewer')
  })

  it('owner wins when the same project has both a tenant-owner grant and a project_members row', () => {
    const ownedProjects: RawOwnedProject[] = [
      { projectId: 'project-a', projectSlug: asSupabaseProjectSlug('livener'), tenantId: 'tenant-1' },
    ]
    // Same project — should never happen in practice (owners don't get a
    // project_members row), but the assembler must not double-count or let a
    // stray/legacy row downgrade an owner grant.
    const memberships: RawProjectMembership[] = [
      { membershipId: 'pm-stray', projectId: 'project-a', projectSlug: asSupabaseProjectSlug('livener'), role: 'viewer' },
    ]

    const grants = assembleProjectGrants({
      ownedProjects,
      memberships,
      enabledModuleIdsByProjectId,
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toHaveLength(1)
    expect(grants[0].role).toBe('owner')
    expect(grants[0].membershipId).toBe('tenant-owner:tenant-1')
  })

  it('returns an empty projects array when there are no owned projects or memberships', () => {
    const grants = assembleProjectGrants({
      ownedProjects: [],
      memberships: [],
      enabledModuleIdsByProjectId,
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toEqual([])
  })

  it('falls back to an empty enabledModuleIds/permissions set for an unconfigured project', () => {
    const ownedProjects: RawOwnedProject[] = [
      { projectId: 'project-unknown', projectSlug: asSupabaseProjectSlug('new-project'), tenantId: 'tenant-1' },
    ]

    const grants = assembleProjectGrants({
      ownedProjects,
      memberships: [],
      enabledModuleIdsByProjectId, // no entry for 'project-unknown'
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toHaveLength(1)
    expect(grants[0].enabledModuleIds).toEqual([])
    expect(grants[0].permissions).toEqual([])
  })

  it('still surfaces a grant (with no modules) for a project with no Sanity content mapping', () => {
    // Regression for the getTenantAuthorizationContext resolver throwing whole-hog
    // when a granted project's per-project Sanity fetch fails. Historically that
    // failure was `TENANT_TO_PROJECT` (src/lib/sanity/client.ts) having no entry
    // for the project — the platform's own "abluo" was exactly that case; the map
    // is gone (RENAME.md Step 5) but a Sanity outage or a project with no `project`
    // document produces the same shape. fetchEnabledModuleIds catches it and
    // degrades to an empty enabledModuleIds entry rather than throwing — this is
    // the pure-layer
    // shape that degradation produces: the project must still appear in ctx.projects,
    // just with zero modules/permissions, not be dropped or take down the resolver.
    const ownedProjects: RawOwnedProject[] = [
      { projectId: 'project-abluo', projectSlug: asSupabaseProjectSlug('abluo'), tenantId: 'tenant-abluo' },
    ]

    const grants = assembleProjectGrants({
      ownedProjects,
      memberships: [],
      enabledModuleIdsByProjectId: {}, // simulates fetchEnabledModuleIds degrading to [] and never populating a key
      modulePermissionMap: fixturePermissionMap,
    })

    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({
      projectId: 'project-abluo',
      projectSlug: 'abluo',
      role: 'owner',
      enabledModuleIds: [],
      permissions: [],
    })
  })
})
