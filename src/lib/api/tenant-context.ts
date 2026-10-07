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
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { getAuthenticatedActor } from '@/lib/api/auth'
import type { PlatformRole } from '@/lib/api/auth'
import { resolveProjectPermissions, resolveTenantPermissions } from '@/lib/authz/resolve'
import { isProjectGrantable } from '@/lib/authz/permissions'
import { isTenantMembershipRole, type AccessRole, type TenantMembershipRole } from '@/lib/authz/roles'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import type { ModulePermissionMap } from '@/lib/modules/types'
import { tenantClient } from '@/lib/sanity/client'
import { enabledModuleIdsQuery } from '@/lib/sanity/queries'
import { asSupabaseProjectSlug, type SupabaseProjectSlug } from '@/lib/tenancy/ids'

// ── Types (ADR-017 Decision 3, shape reproduced exactly) ───────────────────────

/**
 * The role a person effectively holds on one project (ADR-028 §1):
 * 'owner' arrives via tenant_members (Owner of the client); 'admin' / 'editor'
 * (and the retired 'viewer') via project_members; 'member' is a tenant Member
 * reaching the project only through tenant-level extras.
 */
export type ProjectRole = AccessRole

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

/** The caller's standing on a client (tenant) itself — invoices, people (ADR-028). */
export type TenantGrant = {
  tenantId: string
  role: TenantMembershipRole
  permissions: string[]
}

export type TenantAuthorizationContext = {
  userId: string
  platformRole: PlatformRole
  projects: ProjectGrant[]
  /** Tenant-level grants. Optional so hand-built contexts in tests stay valid; absent = none. */
  tenants?: TenantGrant[]
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
  /** 'member' = synthetic grant from a tenant Member's tenant-level extras (no project_members row). */
  role: 'admin' | 'editor' | 'viewer' | 'member'
  /** The client the project belongs to — its tenant-level extras apply here. */
  tenantId?: string
  /** project_members.extra_permissions (none for a synthetic 'member' grant). */
  extraPermissions?: string[]
}

/**
 * The MODULE permission ids a role holds, given the project's enabled
 * modules. Since ADR-028 step 2 this is derived from the single resolver
 * (`resolveProjectPermissions`, src/lib/authz/resolve.ts); its output is
 * proven identical to the previous `canPerformModuleAction` derivation by
 * src/lib/authz/__tests__/resolve.test.ts.
 */
export function permissionsForRole(
  role: ProjectRole,
  enabledModuleIds: string[],
  modulePermissionMap: ModulePermissionMap = MODULE_PERMISSION_MAP
): string[] {
  // MODULE permissions only (kept for its existing callers and invariants).
  // Grants carry the full set — module + platform — via `grantPermissions`.
  return grantPermissions(role, enabledModuleIds, modulePermissionMap).filter((id) => id in modulePermissionMap)
}

/**
 * Every permission a grant carries: module permissions (gated on the
 * project's enabled modules) plus platform project-scope permissions
 * (`users.invite`, `media.library.manage`, …) — ADR-028 §2, resolved by the
 * pure `resolveProjectPermissions` (src/lib/authz/resolve.ts). Extras arrive
 * with ADR-028 Migration step 2; until then there are none.
 */
export function grantPermissions(
  role: ProjectRole,
  enabledModuleIds: string[],
  modulePermissionMap: ModulePermissionMap = MODULE_PERMISSION_MAP,
  extras: { projectExtras?: readonly string[]; tenantExtras?: readonly string[] } = {}
): string[] {
  return resolveProjectPermissions({ role, enabledModuleIds, modulePermissionMap, ...extras }).permissions
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
  /** tenant_members.extra_permissions per tenant (ADR-028 §3) — apply to every project of that tenant. */
  tenantExtrasByTenantId?: Record<string, readonly string[]>
}): ProjectGrant[] {
  const { ownedProjects, enabledModuleIdsByProjectId, modulePermissionMap } = params
  const tenantExtrasByTenantId = params.tenantExtrasByTenantId ?? {}
  // Real project memberships before synthetic tenant-Member grants: a person who
  // is both keeps their project role, with the tenant extras merged in.
  const memberships = [...params.memberships].sort((a, b) => Number(a.role === 'member') - Number(b.role === 'member'))
  const grantsByProjectId = new Map<string, ProjectGrant>()

  for (const owned of ownedProjects) {
    const enabledModuleIds = enabledModuleIdsByProjectId[owned.projectId] ?? []
    grantsByProjectId.set(owned.projectId, {
      projectId: owned.projectId,
      projectSlug: owned.projectSlug,
      membershipId: `tenant-owner:${owned.tenantId}`,
      role: 'owner',
      permissions: grantPermissions('owner', enabledModuleIds, modulePermissionMap),
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
      permissions: grantPermissions(membership.role, enabledModuleIds, modulePermissionMap, {
        projectExtras: membership.extraPermissions ?? [],
        tenantExtras: membership.tenantId ? tenantExtrasByTenantId[membership.tenantId] ?? [] : [],
      }),
      enabledModuleIds,
    })
  }

  return Array.from(grantsByProjectId.values())
}

// ── Shared-slug guard (fail closed) ─────────────────────────────────────────

/**
 * Drops every grant whose project slug is used by more than one
 * `public.projects` row (any tenant).
 *
 * Why: migration 023 made `projects.slug` unique per TENANT only, but Sanity
 * scopes ALL content by `projectSlug` alone — there is no tenant in that
 * namespace. Two tenants owning a project `main` would therefore share every
 * Sanity document (posts, media, siteConfig): an editor of one could read,
 * edit, publish over and delete the other's content through the client
 * dashboard. Until the namespace carries a tenant (or a global unique index
 * is restored — docs/engineering/client-dashboard/launch-inventory.md), a
 * shared slug makes the project unusable from the dashboard rather than
 * shared.
 *
 * `slugUsage` maps slug → number of `projects` rows using it. `null` means
 * the lookup failed: fail closed, every grant is dropped. Pure — tested in
 * tenant-context.test.ts.
 */
export function dropAmbiguousSlugGrants(params: {
  ownedProjects: RawOwnedProject[]
  memberships: RawProjectMembership[]
  slugUsage: Map<string, number> | null
}): { ownedProjects: RawOwnedProject[]; memberships: RawProjectMembership[]; droppedSlugs: string[] } {
  const { ownedProjects, memberships, slugUsage } = params
  const dropped = new Set<string>()
  const unique = (slug: string) => {
    const ok = slugUsage !== null && slugUsage.get(slug) === 1
    if (!ok) dropped.add(slug)
    return ok
  }
  return {
    ownedProjects: ownedProjects.filter((p) => unique(p.projectSlug)),
    memberships: memberships.filter((m) => unique(m.projectSlug)),
    droppedSlugs: [...dropped],
  }
}

/**
 * Counts `public.projects` rows per slug, across ALL tenants. The caller's
 * RLS-scoped client can't see other tenants' rows, so this is the one
 * service-role read in the resolver: slugs in, counts out — no row data
 * leaves this function and no policy is widened. Returns null on failure.
 */
async function fetchProjectSlugUsage(slugs: string[]): Promise<Map<string, number> | null> {
  if (slugs.length === 0) return new Map()
  try {
    return await runAsTrustedSystemOperation(
      'tenant-context: count projects sharing a granted slug (cross-tenant Sanity isolation guard)',
      async (admin) => {
        const { data, error } = await admin.from('projects').select('slug').in('slug', slugs)
        if (error) throw new Error(error.message)
        const usage = new Map<string, number>()
        for (const row of data ?? []) {
          const slug = (row as { slug?: unknown }).slug
          if (typeof slug === 'string') usage.set(slug, (usage.get(slug) ?? 0) + 1)
        }
        return usage
      }
    )
  } catch (error) {
    console.warn(
      `getTenantAuthorizationContext: could not verify project slug uniqueness — failing closed ` +
        `(no project grants this request). Reason: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
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
 *    what the caller's own session is authorized to see. (Sole exception:
 *    `fetchProjectSlugUsage` counts rows per granted slug with the service
 *    role — slugs in, counts out — so `dropAmbiguousSlugGrants` can drop any
 *    grant whose slug another tenant also uses. It grants nothing.)
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
  return loadTenantAuthorizationContext(await createClient(), actor)
}

/**
 * The resolver body, for any Supabase client. Every query filters on
 * `actor.userId` and reads only rows that user's own session may read, so it
 * yields the same result with the caller's RLS-scoped client (the normal
 * path, above) or with the service role for a user who is NOT the caller —
 * used only to re-check an inviter's standing when an invitation is accepted
 * (ADR-028 §6, src/lib/invitations). Never pass the service role with an
 * actor taken from request input.
 */
export async function loadTenantAuthorizationContext(
  supabase: SupabaseClient,
  actor: { userId: string; platformRole: PlatformRole }
): Promise<TenantAuthorizationContext> {

  // ── Tenant memberships (own rows — RLS "Users can read their own memberships") ──
  // Owners reach every project of the tenant (ADR-017 Decision 2). A Member
  // reaches projects only through tenant-level extras that apply per project
  // (ADR-028 §3). Extras are re-validated by the resolver: unknown or
  // non-grantable ids are ignored, never honoured.
  const { data: tenantRows, error: tenantRowsError } = await supabase
    .from('tenant_members')
    .select('tenant_id, role, extra_permissions')
    .eq('user_id', actor.userId)

  if (tenantRowsError) {
    throw new Error(`getTenantAuthorizationContext: failed to read tenant_members — ${tenantRowsError.message}`)
  }

  const tenantExtrasByTenantId: Record<string, string[]> = {}
  const tenants: TenantGrant[] = []
  const ownedTenantIds: string[] = []
  const reachingMemberTenantIds: string[] = []
  for (const row of tenantRows ?? []) {
    const tenantId = row.tenant_id as string
    const extras = stringArray(row.extra_permissions)
    tenantExtrasByTenantId[tenantId] = extras
    if (!isTenantMembershipRole(row.role)) continue // legacy values carry nothing
    tenants.push({ tenantId, role: row.role, permissions: resolveTenantPermissions({ role: row.role, tenantExtras: extras }).permissions })
    if (row.role === 'owner') ownedTenantIds.push(tenantId)
    else if (extras.some(isProjectGrantable)) reachingMemberTenantIds.push(tenantId)
  }

  let ownedProjects: RawOwnedProject[] = []
  const memberTenantProjects: RawProjectMembership[] = []
  const tenantIdsToRead = [...ownedTenantIds, ...reachingMemberTenantIds]
  if (tenantIdsToRead.length > 0) {
    const { data: projectRows, error: projectsError } = await supabase
      .from('projects')
      .select('id, slug, tenant_id')
      .in('tenant_id', tenantIdsToRead)

    if (projectsError) {
      throw new Error(
        `getTenantAuthorizationContext: failed to read projects for the caller's tenants — ${projectsError.message}`
      )
    }

    for (const row of projectRows ?? []) {
      const tenantId = row.tenant_id as string
      // Trust boundary: this IS `projects.slug`.
      const projectSlug = asSupabaseProjectSlug(row.slug as string)
      if (ownedTenantIds.includes(tenantId)) {
        ownedProjects.push({ projectId: row.id as string, projectSlug, tenantId })
      } else {
        memberTenantProjects.push({
          membershipId: `tenant-member:${tenantId}`,
          projectId: row.id as string,
          projectSlug,
          role: 'member',
          tenantId,
          extraPermissions: [],
        })
      }
    }
  }

  // ── Explicit project_members grants (own rows are always RLS-visible) ──
  const { data: membershipRows, error: membershipsError } = await supabase
    .from('project_members')
    .select('id, project_id, role, extra_permissions')
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

  const projectById = new Map<string, { slug: SupabaseProjectSlug; tenantId: string }>()
  if (membershipProjectIds.length > 0) {
    const { data: memberProjectRows, error: memberProjectsError } = await supabase
      .from('projects')
      .select('id, slug, tenant_id')
      .in('id', membershipProjectIds)

    if (memberProjectsError) {
      throw new Error(
        `getTenantAuthorizationContext: failed to read projects for project_members grants — ${memberProjectsError.message}`
      )
    }
    for (const row of memberProjectRows ?? []) {
      // Trust boundary: `row.slug` IS `projects.slug`.
      projectById.set(row.id as string, { slug: asSupabaseProjectSlug(row.slug as string), tenantId: row.tenant_id as string })
    }
  }

  const memberships: RawProjectMembership[] = []
  for (const row of membershipRows ?? []) {
    const projectId = row.project_id as string
    if (ownedProjectIds.has(projectId)) continue // owner wins, skip
    if (!['admin', 'editor', 'viewer'].includes(row.role as string)) continue // unknown role → no grant (fail closed)

    const project = projectById.get(projectId)
    if (!project) {
      console.warn(
        `getTenantAuthorizationContext: could not resolve project ${projectId} ` +
          `(project_members role=${row.role}) — not visible to the caller's session. Grant skipped.`
      )
      continue
    }

    memberships.push({
      membershipId: row.id as string,
      projectId,
      projectSlug: project.slug,
      role: row.role as 'admin' | 'editor' | 'viewer',
      tenantId: project.tenantId,
      extraPermissions: stringArray(row.extra_permissions),
    })
  }
  memberships.push(...memberTenantProjects)

  // Shared-slug guard: a slug used by more than one projects row (any tenant)
  // would share Sanity content across tenants — drop those grants, fail closed.
  {
    const slugs = [...new Set([...ownedProjects, ...memberships].map((p) => p.projectSlug as string))]
    const guarded = dropAmbiguousSlugGrants({
      ownedProjects,
      memberships,
      slugUsage: await fetchProjectSlugUsage(slugs),
    })
    if (guarded.droppedSlugs.length) {
      console.warn(
        `getTenantAuthorizationContext: dropped grants for project slug(s) not unique across tenants ` +
          `(or unverifiable): ${guarded.droppedSlugs.join(', ')} — see dropAmbiguousSlugGrants.`
      )
    }
    ownedProjects = guarded.ownedProjects
    memberships.splice(0, memberships.length, ...guarded.memberships)
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
      tenantExtrasByTenantId,
    }),
    tenants,
  }
}

/** A text[] column as a string array; anything else → []. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
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
