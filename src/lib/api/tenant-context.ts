/**
 * TenantAuthorizationContext resolver — ADR-017 slice 1.
 *
 * Additive and INERT on landing: nothing calls `getTenantAuthorizationContext`
 * yet. This is ADR-017 Implementation Order step 1; the cross-tenant test
 * harness (step 2), the Sanity chokepoint (step 3a), and the entitlement guard
 * (step 3b) are later slices that consume this file — no route depends on it
 * today.
 *
 * Sibling to `src/lib/api/auth.ts`, which stays single-responsibility
 * (platform-role identity only — `AuthenticatedActor`/`PlatformRole`). This
 * file owns the per-project membership half of the model ADR-017 Decision 3
 * names: `TenantAuthorizationContext` / `ProjectGrant`.
 *
 * Resolution happens fresh on every call, from the database — never from the
 * JWT, never cached across requests (ADR-015 R1, carried forward unchanged by
 * ADR-017 Decision 3). A cached grant set cannot be revoked mid-session
 * without a refresh mechanism; per-request resolution is what closes that gap.
 *
 * ── Tenant-owner precedence (ADR-017 Decision 2) ────────────────────────────
 * `owner` is a TENANT-level role, held in `tenant_members` (migration 003/004):
 * owning a tenant grants access to ALL of that tenant's projects, with no
 * `project_members` row needed. `editor`/`viewer` are PROJECT-level grants,
 * held in `project_members` (migration 007). `ctx.projects` is the union of
 * both sources; where a user has both an owner-via-tenant grant and an
 * explicit `project_members` row on the same project, owner wins — the
 * highest-privilege source always wins (see `assembleProjectGrants` below).
 *
 * ── `abluo_admin` note ───────────────────────────────────────────────────────
 * If `platformRole === 'abluo_admin'`, this still returns only the admin's
 * own membership-based projects — it is NOT special-cased to "all projects."
 * Abluo admins reach cross-tenant surfaces through separate admin-only routes
 * (`requireAbluoAdmin()`, `/studio`, the admin dashboard's service-role reads),
 * not through this per-project membership context.
 *
 * ── `src/lib/supabase/server.ts` client suitability (verified this slice) ──
 * `createClient()` there is the standard `@supabase/ssr` `createServerClient`
 * pattern, already used for `supabase.auth.getUser()` elsewhere in the
 * codebase. It carries the caller's session via cookies, so `.from()` and
 * `.rpc()` calls made with it run under the caller's JWT and are subject to
 * RLS — exactly what this resolver needs. No adjustment to the client itself
 * was required. This is the FIRST call site in the codebase to exercise it
 * for table/RPC reads rather than only `.auth.getUser()` — flagged for Tom to
 * verify at apply time (see migration 007 handoff notes).
 *
 * ── Known limitation surfaced, not fixed, by this slice ─────────────────────
 * The existing `projects` SELECT policy (migration 004, "Members can read
 * their projects") is scoped to `tenant_id in get_my_tenant_ids()` — i.e.
 * `tenant_members` only. A user who holds ONLY a `project_members` grant (no
 * `tenant_members` row for that project's tenant) cannot read that project's
 * row — and therefore its `slug` — under today's RLS. This resolver's
 * DB-facing function degrades gracefully (skips the grant, logs a warning)
 * rather than silently fabricating a slug or falling back to a service-role
 * read. Extending the `projects` SELECT policy to also cover
 * `id in (select project_id from project_members where user_id = auth.uid())`
 * is a follow-on, out of this slice's boundary (no existing table's RLS is
 * touched here) — see the handoff for the recommended next step.
 */
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedActor } from '@/lib/api/auth'
import type { PlatformRole } from '@/lib/api/auth'
import { canPerformModuleAction } from '@/lib/permissions'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import type { ModuleInstallation, ModulePermissionMap } from '@/lib/modules/types'
import { tenantClient } from '@/lib/sanity/client'
import { enabledModuleIdsQuery } from '@/lib/sanity/queries'
import { asSupabaseProjectSlug, type SupabaseProjectSlug } from '@/lib/tenancy/ids'

// ── Types (ADR-017 Decision 3, shape reproduced exactly) ───────────────────────

/** A project-level role. 'owner' arrives via tenant_members; the rest via project_members. */
export type ProjectRole = 'owner' | 'editor' | 'viewer'

export type ProjectGrant = {
  projectId: string
  /** Resolved server-side from public.projects.slug — never client-supplied. */
  projectSlug: SupabaseProjectSlug
  /**
   * Identifies the source membership row: the project_members.id for
   * editor/viewer grants, or a synthetic `tenant-owner:{tenantId}` marker for
   * owner grants (owners have no project_members row — see module comment).
   */
  membershipId: string
  role: ProjectRole
  permissions: string[]
  enabledModuleIds: string[]
}

export type TenantAuthorizationContext = {
  userId: string
  platformRole: PlatformRole
  projects: ProjectGrant[]
}

// ── Pure assembly logic (unit-testable without a live DB or Sanity) ────────────

/** A project the caller owns via tenant_members (role = 'owner'). */
export type RawOwnedProject = {
  projectId: string
  /** `projects.slug` — the SUPABASE namespace. */
  projectSlug: SupabaseProjectSlug
  tenantId: string
}

/** A project the caller has an explicit project_members grant on. */
export type RawProjectMembership = {
  membershipId: string
  projectId: string
  /** `projects.slug` — the SUPABASE namespace. */
  projectSlug: SupabaseProjectSlug
  role: 'editor' | 'viewer'
}

/**
 * Computes the flat permission-id list a role holds, given the project's
 * enabled modules. Reuses the existing `canPerformModuleAction` /
 * `MODULE_PERMISSION_MAP` machinery (src/lib/permissions.ts,
 * src/lib/modules/permissions.ts) rather than reimplementing the
 * module-installed → permission-declared → role-granted check. Builds a
 * synthetic `ModuleInstallation[]` from `enabledModuleIds` because
 * `canPerformModuleAction` expects that shape; `version`/`installedAt`/
 * `config` are irrelevant to the permission check and are filled with inert
 * placeholders.
 */
export function permissionsForRole(
  role: ProjectRole,
  enabledModuleIds: string[],
  modulePermissionMap: ModulePermissionMap = MODULE_PERMISSION_MAP
): string[] {
  const installations: ModuleInstallation[] = enabledModuleIds.map((moduleId) => ({
    moduleId,
    version: '0.0.0',
    enabled: true,
    installedAt: '',
    config: {},
    provenance: 'admin',
  }))

  // owner receives every permission an editor would (owner is a superset by
  // convention across the platform's TenantRole model — src/lib/permissions.ts
  // header). ModulePermissionDef.defaultRoles is authored against TenantRole
  // ('owner' | 'editor' | 'viewer'), the same union ProjectRole mirrors here,
  // so role is passed straight through with no translation.
  return Object.keys(modulePermissionMap).filter((permissionId) =>
    canPerformModuleAction(role, permissionId, installations, modulePermissionMap)
  )
}

/**
 * Pure assembly of `ProjectGrant[]` from raw membership rows — the testable
 * core of this resolver. No I/O: given the caller's owned-tenant projects,
 * explicit project_members rows, and each project's enabled module ids, it
 * applies tenant-owner precedence (ADR-017 Decision 2) and computes
 * permissions per grant.
 *
 * Precedence: owned-tenant projects are applied first and always win. A
 * project_members row for a project the caller already owns via its tenant
 * is redundant and ignored (owner is strictly higher-privilege).
 */
export function assembleProjectGrants(params: {
  ownedProjects: RawOwnedProject[]
  memberships: RawProjectMembership[]
  enabledModuleIdsByProjectId: Record<string, string[]>
  modulePermissionMap?: ModulePermissionMap
}): ProjectGrant[] {
  const { ownedProjects, memberships, enabledModuleIdsByProjectId, modulePermissionMap } = params
  const grantsByProjectId = new Map<string, ProjectGrant>()

  for (const owned of ownedProjects) {
    const enabledModuleIds = enabledModuleIdsByProjectId[owned.projectId] ?? []
    grantsByProjectId.set(owned.projectId, {
      projectId: owned.projectId,
      projectSlug: owned.projectSlug,
      membershipId: `tenant-owner:${owned.tenantId}`,
      role: 'owner',
      permissions: permissionsForRole('owner', enabledModuleIds, modulePermissionMap),
      enabledModuleIds,
    })
  }

  for (const membership of memberships) {
    // Owner already covers this project — owner wins (ADR-017 Decision 2).
    if (grantsByProjectId.has(membership.projectId)) continue

    const enabledModuleIds = enabledModuleIdsByProjectId[membership.projectId] ?? []
    grantsByProjectId.set(membership.projectId, {
      projectId: membership.projectId,
      projectSlug: membership.projectSlug,
      membershipId: membership.membershipId,
      role: membership.role,
      permissions: permissionsForRole(membership.role, enabledModuleIds, modulePermissionMap),
      enabledModuleIds,
    })
  }

  return Array.from(grantsByProjectId.values())
}

// ── DB + Sanity-facing resolver ─────────────────────────────────────────────

/**
 * Resolves the full `TenantAuthorizationContext` for the current request.
 * Returns `null` if there is no authenticated session.
 *
 * 1. `getAuthenticatedActor()` — existing identity resolution (userId +
 *    platformRole). Returns null immediately if unauthenticated.
 * 2. Request-scoped, RLS-backed Supabase client (`src/lib/supabase/server.ts`)
 *    resolves: (a) tenant_members rows where role = 'owner' → their projects,
 *    and (b) the caller's own project_members rows. Never the service-role
 *    admin client (`src/lib/supabase/admin.ts`) — this must reflect exactly
 *    what the caller's own session is authorized to see.
 * 3. For each resolved project, `enabledModuleIds` is fetched from Sanity via
 *    the existing `enabledModuleIdsQuery` + `tenantClient()` helper — the same
 *    path the website route (`[tenant]/page.tsx` et al.) already uses.
 * 4. `assembleProjectGrants` (pure, tested) applies tenant-owner precedence
 *    and computes permissions.
 *
 * Not wired into any route this slice — inert per ADR-017 Implementation
 * Order step 1.
 */
export async function getTenantAuthorizationContext(): Promise<TenantAuthorizationContext | null> {
  const actor = await getAuthenticatedActor()
  if (!actor) return null

  const supabase = await createClient()

  // Owner-via-tenant projects: read the caller's own tenant_members(role =
  // 'owner') rows (RLS-visible to any authenticated user for their own rows,
  // migration 003 policy), then read those tenants' projects. The `projects`
  // SELECT policy (migration 004) permits this — owner is included in
  // get_my_tenant_ids().
  const { data: ownedMemberships, error: ownedMembershipsError } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', actor.userId)
    .eq('role', 'owner')

  if (ownedMembershipsError) {
    throw new Error(
      `getTenantAuthorizationContext: failed to read tenant_members — ${ownedMembershipsError.message}`
    )
  }

  const ownedTenantIds = (ownedMemberships ?? []).map((row) => row.tenant_id as string)

  let ownedProjects: RawOwnedProject[] = []
  if (ownedTenantIds.length > 0) {
    const { data: projectRows, error: projectsError } = await supabase
      .from('projects')
      .select('id, slug, tenant_id')
      .in('tenant_id', ownedTenantIds)

    if (projectsError) {
      throw new Error(
        `getTenantAuthorizationContext: failed to read projects for owned tenants — ${projectsError.message}`
      )
    }

    ownedProjects = (projectRows ?? []).map((row) => ({
      projectId: row.id as string,
      // Trust boundary: this IS `projects.slug`.
      projectSlug: asSupabaseProjectSlug(row.slug as string),
      tenantId: row.tenant_id as string,
    }))
  }

  // Explicit project_members grants (editor/viewer). Own rows are always
  // RLS-visible (migration 007 policy). Resolving each row's slug requires a
  // `projects` table read, which — per the module-level "Known limitation"
  // note above — is only guaranteed visible under today's RLS for projects
  // whose tenant the caller also belongs to via tenant_members. A grant whose
  // slug cannot be resolved is skipped (never fabricated) and logged.
  const { data: membershipRows, error: membershipsError } = await supabase
    .from('project_members')
    .select('id, project_id, role')
    .eq('user_id', actor.userId)

  if (membershipsError) {
    throw new Error(
      `getTenantAuthorizationContext: failed to read project_members — ${membershipsError.message}`
    )
  }

  const ownedProjectIds = new Set(ownedProjects.map((p) => p.projectId))
  const membershipProjectIds = (membershipRows ?? [])
    .map((row) => row.project_id as string)
    .filter((projectId) => !ownedProjectIds.has(projectId)) // owner already covers these

  let slugByProjectId = new Map<string, SupabaseProjectSlug>()
  if (membershipProjectIds.length > 0) {
    const { data: memberProjectRows, error: memberProjectsError } = await supabase
      .from('projects')
      .select('id, slug')
      .in('id', membershipProjectIds)

    if (memberProjectsError) {
      throw new Error(
        `getTenantAuthorizationContext: failed to read projects for project_members grants — ${memberProjectsError.message}`
      )
    }

    slugByProjectId = new Map(
      // Trust boundary: `row.slug` IS `projects.slug`.
      (memberProjectRows ?? []).map((row) => [
        row.id as string,
        asSupabaseProjectSlug(row.slug as string),
      ])
    )
  }

  const memberships: RawProjectMembership[] = []
  for (const row of membershipRows ?? []) {
    const projectId = row.project_id as string
    if (ownedProjectIds.has(projectId)) continue // owner wins, skip

    const projectSlug = slugByProjectId.get(projectId)
    if (!projectSlug) {
      // Known limitation (see module comment): the projects RLS policy does
      // not yet cover project_members-only grants. Skip rather than fabricate.
      console.warn(
        `getTenantAuthorizationContext: could not resolve projectSlug for project ${projectId} ` +
          `(project_members role=${row.role}) — likely blocked by the projects table's current ` +
          `RLS policy, which is tenant_members-scoped only. Grant skipped.`
      )
      continue
    }

    memberships.push({
      membershipId: row.id as string,
      projectId,
      projectSlug,
      role: row.role as 'editor' | 'viewer',
    })
  }

  // Enabled module ids per resolved project, via the existing Sanity path.
  const enabledModuleIdsByProjectId: Record<string, string[]> = {}

  await Promise.all(
    ownedProjects.map(async (project) => {
      const ids = await fetchEnabledModuleIds(project.projectSlug)
      enabledModuleIdsByProjectId[project.projectId] = ids
    })
  )
  await Promise.all(
    memberships.map(async (membership) => {
      const ids = await fetchEnabledModuleIds(membership.projectSlug)
      enabledModuleIdsByProjectId[membership.projectId] = ids
    })
  )

  return {
    userId: actor.userId,
    platformRole: actor.platformRole,
    projects: assembleProjectGrants({
      ownedProjects,
      memberships,
      enabledModuleIdsByProjectId,
    }),
  }
}

/**
 * Fetches enabled module ids for a project via the existing
 * `enabledModuleIdsQuery` + `tenantClient()` path — the same one
 * `[tenant]/page.tsx`, `[tenant]/[slug]/page.tsx`, `blog/page.tsx`,
 * `events/page.tsx`, and `live/page.tsx` already use. `projectSlug` here is the
 * `projects.slug` value (e.g. `"livener"`), which since `RENAME.md` Step 4 is
 * also the value the project's Sanity documents carry, so `tenantClient()`
 * binds it to `$projectSlug` verbatim — no map, no translation, no cast.
 * Returns `[]` on a missing or null result rather than throwing — an
 * unconfigured project has no enabled modules, not an error.
 *
 * Degrades to `[]` (never throws) for ANY failure of this per-project fetch:
 * a Sanity outage, or a project with no `project` document at all. It used to
 * ALSO swallow a throw from the deleted `tenantToProjectSlug()` for any project
 * absent from `TENANT_TO_PROJECT` — `hoffmann` and `amelie` then, and the
 * platform's own `abluo` project before Step 1 of `./RENAME.md` (finding (c) of
 * `f669ab9`: the platform project reported ZERO enabled modules). There is no
 * lookup left to throw, so those projects now resolve their real module list.
 * Without this catch, a single failing project would throw out of the
 * `Promise.all` in `getTenantAuthorizationContext` and take down the whole
 * resolver — 500-ing `/account` for a user who is otherwise validly granted on
 * other projects.
 */
async function fetchEnabledModuleIds(projectSlug: SupabaseProjectSlug): Promise<string[]> {
  try {
    // FINDING (c) OF `f669ab9` — THE CAST IS GONE.
    //
    // This used to read `tenantClient(projectSlug as unknown as UrlProjectSegment)`:
    // a Supabase `projects.slug` forced into the URL-segment namespace so that
    // `tenantToProjectSlug()` could look up Sanity's name for it. When the two
    // disagreed the lookup threw and the catch below reported zero modules —
    // which is exactly what happened to the platform's own project until Step 1
    // renamed its URL segment.
    //
    // `tenantClient()` now takes a `ProjectSlug` directly and binds it, so the
    // value flows in unchanged and unbranded-to-nothing. (Its parameter is a
    // union with `UrlProjectSegment` only until Step 6 collapses that brand.)
    const { fetchForTenant } = tenantClient(projectSlug)
    const ids = await fetchForTenant<string[] | null>(enabledModuleIdsQuery, {})
    return ids ?? []
  } catch (error) {
    console.warn(
      `getTenantAuthorizationContext: failed to resolve enabledModuleIds for project ` +
        `"${projectSlug}" — treating as zero enabled modules. Reason: ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
    return []
  }
}
