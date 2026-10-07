/**
 * Effective permissions — ADR-028 §2–§3. Pure: no I/O, fully unit-tested.
 *
 *   project permissions = role defaults (module permissions gated on the
 *                         module being enabled for the project)
 *                       ∪ project-membership extras
 *                       ∪ tenant-membership extras that are project-scoped
 *   tenant permissions  = tenant role defaults ∪ tenant-scoped tenant extras
 *
 * Extras only ADD. Nothing subtracts; there is no deny (ADR-028 §3).
 *
 * An extra is honoured only if it is a known, grantable permission valid in
 * that scope. Anything else — a typo, a renamed id, a non-grantable
 * permission someone wrote into the column by hand — is ignored and reported,
 * never honoured (fail closed). For a grantable MODULE permission the module
 * must also be enabled on the project: an extra can never resurrect a module
 * that was switched off.
 */
import type { ModulePermissionMap } from '@/lib/modules/types'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import { moduleRoleFor, type AccessRole, type TenantMembershipRole } from './roles'
import { GRANTABLE_MODULE_PERMISSIONS, PLATFORM_PERMISSIONS, platformPermission } from './permissions'

export type ResolvedPermissions = {
  permissions: string[]
  /** Extras that were present but not honoured (unknown, not grantable, wrong scope, module off). */
  ignoredExtras: string[]
}

/** The module that owns a module permission id — the registry is authoritative, the dot-prefix is not trusted on its own. */
function owningModule(permissionId: string, map: ModulePermissionMap): string | null {
  if (!map[permissionId]) return null
  const dot = permissionId.indexOf('.')
  return dot > 0 ? permissionId.slice(0, dot) : null
}

/** Is `id` a grantable permission that can apply on a PROJECT? */
function isGrantableOnProject(id: string, map: ModulePermissionMap): boolean {
  if (id in GRANTABLE_MODULE_PERMISSIONS) return Boolean(map[id])
  const def = platformPermission(id)
  return Boolean(def && def.grantable && def.defaults.project)
}

/** Is `id` a grantable permission that applies on a TENANT itself (not per project)? */
function isGrantableOnTenant(id: string): boolean {
  const def = platformPermission(id)
  return Boolean(def && def.grantable && def.defaults.tenant)
}

export function resolveProjectPermissions(params: {
  role: AccessRole
  enabledModuleIds: readonly string[]
  projectExtras?: readonly string[]
  tenantExtras?: readonly string[]
  modulePermissionMap?: ModulePermissionMap
}): ResolvedPermissions {
  const map = params.modulePermissionMap ?? MODULE_PERMISSION_MAP
  const enabled = new Set(params.enabledModuleIds)
  const granted = new Set<string>()
  const ignored = new Set<string>()

  // 1. Module permissions from the role — only for enabled modules.
  const moduleRole = moduleRoleFor(params.role)
  if (moduleRole) {
    for (const [id, def] of Object.entries(map)) {
      const moduleId = owningModule(id, map)
      if (moduleId && enabled.has(moduleId) && def.defaultRoles.includes(moduleRole)) granted.add(id)
    }
  }

  // 2. Platform project-scope permissions from the role.
  for (const def of PLATFORM_PERMISSIONS) {
    if (def.defaults.project?.includes(params.role)) granted.add(def.id)
  }

  // 3. Extras: project membership, then tenant membership (project-scoped ones only).
  const projectExtras = params.projectExtras ?? []
  const tenantExtras = params.tenantExtras ?? []
  for (const id of [...projectExtras, ...tenantExtras]) {
    if (!isGrantableOnProject(id, map)) {
      // A tenant-scoped extra (e.g. invoices) on the tenant list is valid — just not here.
      if (!(tenantExtras.includes(id) && isGrantableOnTenant(id))) ignored.add(id)
      continue
    }
    const moduleId = owningModule(id, map)
    if (moduleId && !enabled.has(moduleId)) {
      ignored.add(id)
      continue
    }
    granted.add(id)
  }

  // 4. A dependent extra without its prerequisite is not honoured.
  for (const [id, rule] of Object.entries(GRANTABLE_MODULE_PERMISSIONS)) {
    if (rule.requires && granted.has(id) && !granted.has(rule.requires)) {
      granted.delete(id)
      ignored.add(id)
    }
  }
  for (const def of PLATFORM_PERMISSIONS) {
    if (def.requires && granted.has(def.id) && !granted.has(def.requires)) {
      granted.delete(def.id)
      ignored.add(def.id)
    }
  }

  return { permissions: [...granted].sort(), ignoredExtras: [...ignored].sort() }
}

export function resolveTenantPermissions(params: {
  role: TenantMembershipRole
  tenantExtras?: readonly string[]
}): ResolvedPermissions {
  const granted = new Set<string>()
  const ignored = new Set<string>()
  for (const def of PLATFORM_PERMISSIONS) {
    if (def.defaults.tenant?.includes(params.role)) granted.add(def.id)
  }
  for (const id of params.tenantExtras ?? []) {
    if (isGrantableOnTenant(id)) granted.add(id)
    // Project-scoped extras on a tenant membership are valid but resolved per project, not here.
    else if (!isGrantableOnProject(id, MODULE_PERMISSION_MAP)) ignored.add(id)
  }
  return { permissions: [...granted].sort(), ignoredExtras: [...ignored].sort() }
}
