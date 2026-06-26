// ── Tenant role types ─────────────────────────────────────────────────────────
// Shared neutral location for the TenantRole type and its type guard.
//
// Imported by:
//   - src/lib/permissions.ts  (permission helper functions)
//   - src/lib/modules/types.ts (ModulePermissionDef.defaultRoles)
//
// Extracted in ADR-011 Phase A2 to prevent the circular dependency that would
// arise in Phase D4 when permissions.ts imports from the modules layer
// (canPerformModuleAction). Both files import from this shared location instead
// of from each other.

export type TenantRole = 'owner' | 'editor' | 'viewer'

/** True if the role string is a valid TenantRole. */
export function isValidTenantRole(role: string): role is TenantRole {
  return role === 'owner' || role === 'editor' || role === 'viewer'
}
