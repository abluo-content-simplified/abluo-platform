/**
 * The single access check — ADR-028 §2.
 *
 * Every authorization decision asks one question: "may this person do
 * `permission` in this scope?". Nothing else in the application compares role
 * names.
 *
 * Fail closed, always:
 *   - an unknown permission id → false
 *   - a permission asked in a scope it does not exist in → false
 *   - no grant for the project/tenant → false
 *
 * Super Admin (`abluo_admin`) holds every PLATFORM-scope permission. It does
 * NOT implicitly hold tenant or project permissions: reaching a client's data
 * requires a membership or a support session (ADR-028 §8, src/lib/support):
 * in a support visit every write permission answers false unless the
 * client's edit approval is live. That keeps
 * "Abluo looked at this client" an explicit, logged event rather than a side
 * effect of the admin flag.
 *
 * Module gating (module installed before permission) is already applied when
 * a grant's permissions are resolved (`resolveProjectPermissions`), and is
 * re-checked with its distinct error by `assertModuleAction`.
 */
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import type { ModulePermissionMap } from '@/lib/modules/types'
import { supportRefuses, type SupportPurpose } from '@/lib/support/state'
import { platformPermission } from './permissions'

export type PermissionScopeRef =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'project'; projectId: string }

/** The minimal shape `can()` needs. `TenantAuthorizationContext` satisfies it. */
export type AuthzSubject = {
  platformRole: 'abluo_admin' | 'tenant_user' | string
  projects: ReadonlyArray<{ projectId: string; permissions: readonly string[] }>
  tenants?: ReadonlyArray<{ tenantId: string; permissions: readonly string[] }>
  /** Set while an Abluo admin visits a project in support mode (ADR-028 §8, src/lib/support). */
  support?: { purpose: SupportPurpose; writesAllowed: boolean }
}

/** Does `permission` exist at all in `scope`? */
export function permissionExistsInScope(
  permission: string,
  scope: PermissionScopeRef['kind'],
  modulePermissionMap: ModulePermissionMap = MODULE_PERMISSION_MAP
): boolean {
  const def = platformPermission(permission)
  if (def) return Boolean(def.defaults[scope])
  // Module permissions are project-scoped only.
  return scope === 'project' && Boolean(modulePermissionMap[permission])
}

export function can(
  subject: AuthzSubject | null | undefined,
  permission: string,
  scope: PermissionScopeRef,
  modulePermissionMap: ModulePermissionMap = MODULE_PERMISSION_MAP
): boolean {
  if (!subject) return false
  if (!permissionExistsInScope(permission, scope.kind, modulePermissionMap)) return false
  // Support mode: no write unless the client allowed edit access and it is live.
  if (supportRefuses(subject.support, permission)) return false

  switch (scope.kind) {
    case 'platform':
      return subject.platformRole === 'abluo_admin'
    case 'tenant': {
      const grant = subject.tenants?.find((t) => t.tenantId === scope.tenantId)
      return Boolean(grant && grant.permissions.includes(permission))
    }
    case 'project': {
      const grant = subject.projects.find((p) => p.projectId === scope.projectId)
      return Boolean(grant && grant.permissions.includes(permission))
    }
  }
}
