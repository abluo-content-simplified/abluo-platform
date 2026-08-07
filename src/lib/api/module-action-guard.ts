/**
 * Module entitlement + permission guard — ADR-017 slice 3b.
 *
 * Implements ADR-015 7-step steps 4–5, the request-time check that gates
 * every module action on TWO conditions, checked in a fixed order:
 *
 *   4. The module that OWNS the requested permission is installed (enabled)
 *      for the target project.
 *   5. The caller's resolved role grants the requested permission.
 *
 * These are distinct checks, and the order matters: a user who holds the
 * permission (their role would ordinarily grant it) still cannot act if the
 * module that owns that permission has been uninstalled/disabled for this
 * project. Checking module-installed FIRST means the resulting error always
 * names the correct reason — "module not installed" is never masked behind
 * a generic "permission denied", and a caller cannot learn whether they'd
 * have had the permission by probing a project where the module is off.
 *
 * ── Placement ────────────────────────────────────────────────────────────
 * Sibling to `tenant-context.ts` (which owns *resolving* the
 * `TenantAuthorizationContext`) and `tenant-scoped-sanity.ts` (which owns
 * the Sanity read/write chokepoint) rather than added to either file:
 * single-responsibility — this file's only job is the entitlement decision
 * itself, given an already-resolved `ctx`. It performs no I/O (everything it
 * needs is already on `ctx`), which is what makes it fully unit-testable
 * without a live DB or Sanity connection, matching the pattern
 * `tenant-context.ts` uses for `assembleProjectGrants`/`permissionsForRole`.
 *
 * It reuses `TenantAuthorizationError` from `tenant-scoped-sanity.ts` rather
 * than inventing a second error type — callers up and down the request path
 * can catch/handle exactly one authorization error shape regardless of which
 * ADR-017 primitive rejected the request.
 *
 * ── How the owning module is derived ────────────────────────────────────
 * `src/lib/permissions.ts` (`canPerformModuleAction`) already encodes the
 * platform's permission-id convention: `"{moduleId}.{noun}.{verb}"` — the
 * module id is the first dot-segment (e.g. `"blog.post.write"` → `"blog"`).
 * This guard resolves the SAME answer from the single authoritative source
 * — `MODULE_REGISTRY`'s `platformContract.permissions` declarations — via
 * `buildPermissionOwnerMap()`, falling back to the dot-segment convention
 * only for a permission id not present in the supplied map (e.g. a
 * test-fixture permission that deliberately isn't in the real registry).
 * This avoids re-deriving the convention by string-parsing alone as the
 * primary path, while staying consistent with `canPerformModuleAction`'s
 * documented convention when a registry lookup isn't available.
 *
 * ── Not wired into any route yet ────────────────────────────────────────
 * Per the ADR-017 Implementation Order, this slice (3b) builds the guard
 * and its unit-test harness cases only. No route or component calls
 * `assertModuleAction`/`canModuleAction` yet — it is inert, exactly like
 * `tenant-context.ts` and `tenant-scoped-sanity.ts` were on landing. Route
 * wiring is a later slice.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import type { ModuleManifest } from '@/lib/modules/types'

// ── Owning-module derivation ────────────────────────────────────────────────

/**
 * Flat `permissionId -> moduleId` map built from `MODULE_REGISTRY`'s
 * `platformContract.permissions` declarations — the single authoritative
 * source for "which module owns this permission". Built once at module load
 * time, mirroring `MODULE_PERMISSION_MAP` in `src/lib/modules/permissions.ts`.
 */
export function buildPermissionOwnerMap(
  registry: ModuleManifest[] = MODULE_REGISTRY
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const manifest of registry) {
    for (const permission of manifest.platformContract.permissions) {
      map[permission.id] = manifest.id
    }
  }
  return map
}

export const PERMISSION_OWNER_MODULE_MAP: Record<string, string> = buildPermissionOwnerMap()

/**
 * Resolves the module id that owns `permissionId`. Looks up
 * `permissionOwnerMap` first (registry-derived truth); falls back to the
 * "{moduleId}.{noun}.{verb}" dot-segment convention documented in
 * `canPerformModuleAction` (`src/lib/permissions.ts`) when the permission id
 * isn't present in the map — e.g. a permission declared only in a test
 * fixture. Returns `null` if no module id can be resolved either way.
 */
function resolveOwningModuleId(
  permissionId: string,
  permissionOwnerMap: Record<string, string>
): string | null {
  const fromMap = permissionOwnerMap[permissionId]
  if (fromMap) return fromMap

  const dotIndex = permissionId.indexOf('.')
  if (dotIndex === -1) return null
  const moduleId = permissionId.slice(0, dotIndex)
  return moduleId || null
}

// ── Guard ────────────────────────────────────────────────────────────────────

/**
 * Gates a module action on (a) the owning module being installed for the
 * target project AND (b) the caller's resolved role granting the requested
 * permission — checked in that order (ADR-015 7-step steps 4–5).
 *
 * Throws `TenantAuthorizationError` on any denial; returns (void) only if
 * every check passes. Pure — no I/O. Everything needed is already resolved
 * onto `ctx` by `getTenantAuthorizationContext()`.
 *
 * Order of checks:
 *   0. A `ProjectGrant` for `projectId` must exist in `ctx.projects` — a
 *      caller with no grant on the project is rejected before any
 *      module/permission reasoning happens.
 *   1. The module that owns `permissionId` must be in
 *      `grant.enabledModuleIds` (module-installed check — step 4).
 *   2. `permissionId` must be in `grant.permissions` (role-permission check
 *      — step 5).
 */
export function assertModuleAction(
  ctx: TenantAuthorizationContext,
  projectId: string,
  permissionId: string,
  deps: { permissionOwnerMap?: Record<string, string> } = {}
): void {
  const permissionOwnerMap = deps.permissionOwnerMap ?? PERMISSION_OWNER_MODULE_MAP

  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) {
    throw new TenantAuthorizationError(
      `assertModuleAction: no ProjectGrant for project "${projectId}" in this ` +
        `TenantAuthorizationContext (userId=${ctx.userId}) — access rejected. A module action ` +
        'can only be evaluated for a project the caller is explicitly granted on.'
    )
  }

  const owningModuleId = resolveOwningModuleId(permissionId, permissionOwnerMap)
  if (!owningModuleId) {
    throw new TenantAuthorizationError(
      `assertModuleAction: could not resolve an owning module for permission "${permissionId}" ` +
        '— it is declared in no module\'s platformContract.permissions and does not follow the ' +
        '"{moduleId}.{noun}.{verb}" convention. Access rejected.'
    )
  }

  // Step 4 — module-installed check FIRST. Distinct from, and precedes, the
  // permission check: a user with the permission still cannot act if the
  // owning module isn't installed/enabled for this project.
  if (!grant.enabledModuleIds.includes(owningModuleId)) {
    throw new TenantAuthorizationError(
      `assertModuleAction: module "${owningModuleId}" is not installed for project ` +
        `"${grant.projectSlug}" — action "${permissionId}" rejected. (Module-installed check ` +
        'precedes the permission check; this failure is independent of the caller\'s role.)'
    )
  }

  // Step 5 — permission check SECOND.
  if (!grant.permissions.includes(permissionId)) {
    throw new TenantAuthorizationError(
      `assertModuleAction: role "${grant.role}" on project "${grant.projectSlug}" does not grant ` +
        `permission "${permissionId}" — access rejected.`
    )
  }
}

/**
 * Non-throwing variant of `assertModuleAction` for call sites that want a
 * boolean — e.g. conditional UI ("show this button only if the user could
 * perform this action"). Delegates to `assertModuleAction` so the two never
 * drift; catches only `TenantAuthorizationError` and re-throws anything else,
 * since an unexpected error here signals a bug, not a denial.
 */
export function canModuleAction(
  ctx: TenantAuthorizationContext,
  projectId: string,
  permissionId: string,
  deps: { permissionOwnerMap?: Record<string, string> } = {}
): boolean {
  try {
    assertModuleAction(ctx, projectId, permissionId, deps)
    return true
  } catch (error) {
    if (error instanceof TenantAuthorizationError) return false
    throw error
  }
}
