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
