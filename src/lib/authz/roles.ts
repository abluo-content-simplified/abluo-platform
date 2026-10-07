/**
 * Role vocabulary — ADR-028 §1.
 *
 * Roles are only named bundles of default permissions. Application code never
 * compares role names to decide access (ADR-028 §2): it asks `can()` in
 * `./check.ts`. The role names live here, in the resolver and in the grant
 * rules — nowhere else.
 *
 * Scopes:
 *   platform — `abluo_admin` (Super Admin). A JWT claim, never a membership.
 *   tenant   — `tenant_members.role`: 'owner' | 'member'
 *   project  — `project_members.role`: 'admin' | 'editor'
 *              ('viewer' is a retired value still present in the database
 *              until ADR-028 Migration step 4; it is accepted when READ and
 *              never granted.)
 *
 * `AccessRole` is the role a person effectively holds ON ONE PROJECT after
 * inheritance: a tenant Owner is 'owner' on every project of the tenant; a
 * tenant Member with tenant-level extras is 'member' (no defaults, extras
 * only).
 */

export type TenantMembershipRole = 'owner' | 'member'
export type ProjectMembershipRole = 'admin' | 'editor'
/** Retired project role — readable, never grantable (ADR-028 §1). */
export type LegacyProjectMembershipRole = 'viewer'

export type AccessRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'member'

export const TENANT_MEMBERSHIP_ROLES: readonly TenantMembershipRole[] = ['owner', 'member']
export const PROJECT_MEMBERSHIP_ROLES: readonly ProjectMembershipRole[] = ['admin', 'editor']

export function isTenantMembershipRole(value: unknown): value is TenantMembershipRole {
  return value === 'owner' || value === 'member'
}

/** Accepts the retired 'viewer' because it can still be READ from the database. */
export function isReadableProjectMembershipRole(
  value: unknown
): value is ProjectMembershipRole | LegacyProjectMembershipRole {
  return value === 'admin' || value === 'editor' || value === 'viewer'
}

/**
 * Module manifests author `defaultRoles` against the original role union
 * ('owner' | 'editor' | 'viewer'). A Project Admin has full control of its
 * project, so for module permissions it holds whatever an Owner holds on that
 * project. 'member' maps to nothing: it carries extras only.
 */
export function moduleRoleFor(role: AccessRole): 'owner' | 'editor' | 'viewer' | null {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'owner'
    case 'editor':
      return 'editor'
    case 'viewer':
      return 'viewer'
    case 'member':
      return null
  }
}
