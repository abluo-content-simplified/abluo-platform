// ── Module permission builder ─────────────────────────────────────────────────
// ADR-011 Phase D4 — Permission Derivation.
//
// Builds the flat MODULE_PERMISSION_MAP from MODULE_REGISTRY declarations.
// The map is computed once at module load time — it is immutable and stable.
//
// Architecture:
//   Modules declare capabilities (the permissions arrays in the registry).
//   Roles grant permissions (defaultRoles on each ModulePermissionDef).
//   Users receive roles (Supabase tenant_members).
//
//   defaultRoles are platform defaults only. They are a convenience starting
//   point when a module is first installed — not a binding contract between
//   a module and any role set. Future tenant-defined custom roles (e.g. Blog
//   Editor, Event Manager, Marketing) are achievable without modifying any
//   module manifest.
//
// canPerformModuleAction lives in src/lib/permissions.ts (platform layer).
// It receives MODULE_PERMISSION_MAP as a parameter — the platform permission
// layer remains independent of the modules layer at import time.
//
// Bundle boundary:
//   This file imports from registry.ts. registry.ts imports Sanity schema
//   types — but not sanity/structure. This file is safe to import from both
//   Next.js routes and the Studio bundle.

import type { ModulePermissionMap } from './types'
import { MODULE_REGISTRY } from './registry'

// ── buildModulePermissions ────────────────────────────────────────────────────

/**
 * Iterates MODULE_REGISTRY and builds a flat map of all declared permissions,
 * keyed by permission ID.
 *
 * The manifest validator guarantees all IDs are unique and correctly namespaced
 * before this function runs — no deduplication logic is needed here.
 *
 * Exposed for testability. Consumers should use MODULE_PERMISSION_MAP rather
 * than calling this function directly.
 */
export function buildModulePermissions(): ModulePermissionMap {
  const map: ModulePermissionMap = {}
  for (const manifest of MODULE_REGISTRY) {
    for (const permission of manifest.platformContract.permissions) {
      map[permission.id] = permission
    }
  }
  return map
}

// ── MODULE_PERMISSION_MAP ─────────────────────────────────────────────────────

/**
 * The platform's complete permission map. Built once at module load time from
 * MODULE_REGISTRY declarations.
 *
 * Pass this constant to canPerformModuleAction() in src/lib/permissions.ts.
 * Do not rebuild the map on every permission check.
 *
 * Future work: a tenant-specific permission map (with custom role overrides)
 * may replace or extend this default map without requiring any change to the
 * module manifests that populate MODULE_REGISTRY.
 */
export const MODULE_PERMISSION_MAP: ModulePermissionMap = buildModulePermissions()
