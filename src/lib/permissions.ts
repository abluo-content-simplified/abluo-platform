/**
 * Tenant membership permissions
 *
 * All permission checks go through this module.
 * Never compare role strings directly in application code — always call a
 * helper here. This ensures that adding a new role (e.g. 'billing_admin')
 * only requires changes in this file, not scattered across the codebase.
 *
 * Role model:
 *   owner  — full control: content, media, leads, settings, users, billing
 *   editor — content + media + leads. No settings, no user management.
 *   viewer — read-only: leads and analytics only.
 *
 * TenantRole and isValidTenantRole live in src/lib/types/roles.ts (extracted in
 * ADR-011 Phase A2 to avoid a circular dependency with the modules layer in D4).
 * Re-exported here so all existing import paths continue to work.
 */

export type { TenantRole } from './types/roles'
export { isValidTenantRole } from './types/roles'

import type { TenantRole } from './types/roles'
import type { ModuleInstallation, ModulePermissionMap } from './modules/types'

// ── Content ───────────────────────────────────────────────────────────────────

/** Create, edit, and publish blog posts and pages. */
export function canEditContent(role: TenantRole): boolean {
  return role === 'owner' || role === 'editor'
}

/** Upload, tag, and delete media assets. */
export function canManageMedia(role: TenantRole): boolean {
  return role === 'owner' || role === 'editor'
}

// ── Leads ─────────────────────────────────────────────────────────────────────

/** View leads and contact requests. */
export function canViewLeads(role: TenantRole): boolean {
  return role === 'owner' || role === 'editor' || role === 'viewer'
}

/** Update lead status and add notes. */
export function canUpdateLeads(role: TenantRole): boolean {
  return role === 'owner' || role === 'editor'
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/** View traffic and content performance analytics. */
export function canViewAnalytics(role: TenantRole): boolean {
  return role === 'owner' || role === 'editor' || role === 'viewer'
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** View site settings (branding, domain, locale). */
export function canViewSettings(role: TenantRole): boolean {
  return role === 'owner'
}

/** Edit site settings. */
export function canManageSettings(role: TenantRole): boolean {
  return role === 'owner'
}

// ── User management ───────────────────────────────────────────────────────────

/** Invite new members to the tenant. */
export function canInviteUsers(role: TenantRole): boolean {
  return role === 'owner'
}

/** Remove members or change member roles. */
export function canManageUsers(role: TenantRole): boolean {
  return role === 'owner'
}

// ── Billing ───────────────────────────────────────────────────────────────────

/** View plan and billing details. */
export function canViewBilling(role: TenantRole): boolean {
  return role === 'owner'
}

// ── Module permissions ────────────────────────────────────────────────────────

/**
 * Returns true if the given role may perform the action identified by
 * `permissionId`, subject to the module being installed and enabled.
 *
 * Three conditions must all hold:
 *   1. The module that owns the permission is present in `moduleInstallations`
 *      and has `enabled: true`.
 *   2. The permission exists in `modulePermissionMap`.
 *   3. `role` appears in the permission's `defaultRoles`.
 *
 * ── Why the permission map is passed in ──────────────────────────────────────
 *
 * This function intentionally evaluates permissions against the supplied
 * `modulePermissionMap` rather than importing module declarations directly.
 * This keeps the platform permission layer (src/lib/permissions.ts) decoupled
 * from the modules layer at import time — the same architectural pattern used
 * throughout D1–D3, where builders receive data rather than importing it.
 *
 * A tenant-specific permission map may replace or extend the platform default
 * (MODULE_PERMISSION_MAP from src/lib/modules/permissions.ts) without requiring
 * any change to this function or to any module manifest. For example, a future
 * tenant role "Blog Editor" could be supported by a custom map that assigns
 * blog.post.write to that role — nothing in the module declarations changes.
 *
 * Module manifests should never need modification when tenant authorization
 * policies evolve. Modules declare what permissions exist; platform and tenant
 * configuration determines who holds them.
 *
 * The supplied `ModulePermissionMap` represents the platform default
 * permissions. Future tenant-specific permission maps may override or extend
 * these defaults without requiring changes to module manifests. This
 * architecture intentionally supports future custom tenant roles such as Blog
 * Editor, Event Editor, Live Producer, Marketing Manager, or other
 * tenant-defined roles.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 * This is infrastructure only (ADR-011 Phase D4). No enforcement call sites
 * exist yet. `defaultRoles` is the sole grant check in this implementation —
 * this is the platform default, not a ceiling on future extensibility.
 */
export function canPerformModuleAction(
  role: TenantRole,
  permissionId: string,
  moduleInstallations: ModuleInstallation[],
  modulePermissionMap: ModulePermissionMap
): boolean {
  // Derive the owning module from the first segment of the permission ID.
  // Convention: "{moduleId}.{noun}.{verb}" — e.g. "blog.post.write" → "blog"
  const dotIndex = permissionId.indexOf('.')
  if (dotIndex === -1) return false
  const moduleId = permissionId.slice(0, dotIndex)
  if (!moduleId) return false

  // 1. Module must be installed and enabled on this project.
  const installation = moduleInstallations.find((i) => i.moduleId === moduleId)
  if (!installation || !installation.enabled) return false

  // 2. Permission must be declared in the supplied map.
  const permission = modulePermissionMap[permissionId]
  if (!permission) return false

  // 3. Role must appear in the permission's default roles.
  return permission.defaultRoles.includes(role)
}
