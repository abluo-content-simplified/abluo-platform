/**
 * No escalation — ADR-028 §4. Pure: no I/O, fully unit-tested.
 *
 * Decides whether a person may invite someone, change someone's role/extras,
 * or remove someone, in one tenant or one project. The server calls this
 * when an invitation is CREATED, again when it is ACCEPTED (the inviter may
 * have lost access in between), and on every membership change. The database
 * membership tables accept no writes from `authenticated` (migration 028), so
 * these server paths are the only way a membership changes.
 *
 * Rules:
 *   1. Invite needs `users.invite`; change and remove need `users.manage`,
 *      held by the granter in that scope.
 *   2. Tenant level (Owner / Member, tenant extras): Owners only. Only an
 *      Owner can create, change or remove an Owner.
 *   3. Project level: an Owner (of the tenant) may grant Site admin or Editor;
 *      a Site admin may grant Editor only. The same limit applies to the
 *      person being changed or removed (a Site admin cannot touch another Site
 *      admin or an Owner).
 *   4. 'viewer' is retired: never granted.
 *   5. Extras: each must be a known permission that is grantable in that
 *      scope, and — at project level — one the granter holds there. A
 *      dependent extra needs its prerequisite in the same grant
 *      (contact-request updates need contact-request reads).
 *   6. Super Admin may do all of the above, including creating a tenant's
 *      first Owner (`tenants.manage`).
 *
 * The last-Owner rule is separate (`leavesTenantWithoutOwner`) and is also
 * enforced by a database trigger (ADR-028 Migration step 2).
 */
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import type { ModulePermissionMap } from '@/lib/modules/types'
import type {
  AccessRole,
  LegacyProjectMembershipRole,
  ProjectMembershipRole,
  TenantMembershipRole,
} from './roles'
import { GRANTABLE_MODULE_PERMISSIONS, platformPermission } from './permissions'

export type GrantAction = 'invite' | 'change' | 'remove'

export type Granter = {
  platformRole: 'abluo_admin' | 'tenant_user' | string
  /** The granter's role in the tenant concerned (null = not a tenant member). */
  tenantRole: TenantMembershipRole | null
  /** The granter's effective role on the project concerned (project-level requests only). */
  projectRole?: AccessRole | null
  /** The granter's effective permissions in the scope concerned. */
  permissions: readonly string[]
}

export type GrantRequest =
  | {
      scope: 'tenant'
      action: GrantAction
      /** New role (invite/change). */
      role?: TenantMembershipRole
      /** The person's current role (change/remove). */
      currentRole?: TenantMembershipRole
      extras?: readonly string[]
    }
  | {
      scope: 'project'
      action: GrantAction
      role?: ProjectMembershipRole | LegacyProjectMembershipRole
      currentRole?: ProjectMembershipRole | LegacyProjectMembershipRole
      extras?: readonly string[]
    }

export type GrantRefusal =
  | 'missing_permission'
  | 'role_too_high'
  | 'target_too_high'
  | 'role_retired'
  | 'role_required'
  | 'extra_unknown_or_not_grantable'
  | 'extra_not_held'
  | 'extra_missing_prerequisite'

export type GrantDecision = { ok: true } | { ok: false; reason: GrantRefusal; detail?: string }

const refuse = (reason: GrantRefusal, detail?: string): GrantDecision => ({ ok: false, reason, detail })

/** Roles a granter may hand out / act on at project level. */
function projectRolesManageableBy(projectRole: AccessRole | null | undefined): ReadonlySet<string> {
  if (projectRole === 'owner') return new Set(['admin', 'editor', 'viewer'])
  if (projectRole === 'admin') return new Set(['editor', 'viewer'])
  return new Set()
}

function grantableIn(scope: 'tenant' | 'project', id: string, map: ModulePermissionMap): boolean {
  if (id in GRANTABLE_MODULE_PERMISSIONS) return Boolean(map[id]) // module extras apply per project; valid on both memberships
  const def = platformPermission(id)
  if (!def || !def.grantable) return false
  // A tenant membership may carry tenant- AND project-scoped extras (the latter apply to every project).
  return scope === 'tenant' ? Boolean(def.defaults.tenant || def.defaults.project) : Boolean(def.defaults.project)
}

function prerequisiteOf(id: string): string | undefined {
  return GRANTABLE_MODULE_PERMISSIONS[id]?.requires ?? platformPermission(id)?.requires
}

export function checkGrant(
  granter: Granter,
  request: GrantRequest,
  modulePermissionMap: ModulePermissionMap = MODULE_PERMISSION_MAP
): GrantDecision {
  const isSuperAdmin = granter.platformRole === 'abluo_admin'

  // 4. Retired role.
  if (request.role === 'viewer') return refuse('role_retired')
  if (request.action !== 'remove' && !request.role) return refuse('role_required')

  // 1. The verb's permission.
  if (!isSuperAdmin) {
    const needed = request.action === 'invite' ? 'users.invite' : 'users.manage'
    if (!granter.permissions.includes(needed)) return refuse('missing_permission', needed)
  }

  // 2 / 3. Role ceilings.
  if (!isSuperAdmin) {
    if (request.scope === 'tenant') {
      if (granter.tenantRole !== 'owner') return refuse('role_too_high')
    } else {
      const manageable = projectRolesManageableBy(granter.projectRole)
      if (request.role && !manageable.has(request.role)) return refuse('role_too_high', request.role)
      if (request.currentRole && !manageable.has(request.currentRole)) {
        return refuse('target_too_high', request.currentRole)
      }
    }
  }

  // 5. Extras.
  const extras = request.action === 'remove' ? [] : [...new Set(request.extras ?? [])]
  for (const id of extras) {
    if (!grantableIn(request.scope, id, modulePermissionMap)) return refuse('extra_unknown_or_not_grantable', id)
    // At tenant level the granter is an Owner (checked above), who outranks every extra.
    if (!isSuperAdmin && request.scope === 'project' && !granter.permissions.includes(id)) {
      return refuse('extra_not_held', id)
    }
    const prerequisite = prerequisiteOf(id)
    if (prerequisite && !extras.includes(prerequisite)) return refuse('extra_missing_prerequisite', id)
  }

  return { ok: true }
}

/**
 * Would this change leave the tenant with no Owner? `ownerUserIds` is the
 * tenant's current Owners; the change removes or demotes `userId`.
 */
export function leavesTenantWithoutOwner(params: {
  ownerUserIds: readonly string[]
  userId: string
  newRole: TenantMembershipRole | null
}): boolean {
  const { ownerUserIds, userId, newRole } = params
  if (!ownerUserIds.includes(userId)) return false
  if (newRole === 'owner') return false
  return ownerUserIds.filter((id) => id !== userId).length === 0
}
