// ── Module infrastructure barrel ─────────────────────────────────────────────
// ADR-011 — src/lib/modules/ is the home for all module infrastructure.
//
// Phase A1: registry relocation.
// Phase A2: full ModuleManifest type; TenantRole extracted to src/lib/types/roles.ts.
// Phase A3: build-time manifest validation.
// Phase B1: ModuleInstallation type; moduleInstallations field on project doc.
// Phase D1: schemaDefinitions on ModuleManifest; buildSchema(); module schema files;
//           ModuleDef alias removed.
// Phase D2: SECTION_MAP + ModuleSectionProps; blog/sections.tsx; registry remains
//           purely declarative — no React components in ModuleManifest.
// Phase D3: ModuleCollectionGroupDef + ModuleCollectionItemDef; declarative collections
//           array replaces imperative collectionItems() lambda; CollectionItemsContext
//           removed; buildCollectionItems() in navigation.ts is the Studio builder.
// Phase D4: ModulePermissionMap; buildModulePermissions(); MODULE_PERMISSION_MAP;
//           canPerformModuleAction() in src/lib/permissions.ts (platform layer).
//           Manifest validator extended for permission ID validation.
//
// Isolation boundaries (must be maintained):
//   sections.ts  — imported by Next.js routes only (never by sanity.config.ts / Studio)
//   navigation.ts — imported by sanity.config.ts only (never by Next.js routes)
//   permissions.ts (this layer) — no isolation constraint; safe in all contexts

export {
  type ModuleManifest,
  type ModuleCollectionGroupDef,
  type ModuleCollectionItemDef,
  type ModuleCategory,
  type ModuleConfigFieldDef,
  type ModuleConfigFieldType,
  type ModulePlacementDef,
  type ModulePlacementSurface,
  type ModulePermissionDef,
  type ModulePermissionMap,
  type ModuleDependency,
  type ModuleInstallation,
} from './types'

export { MODULE_REGISTRY } from './registry'

export { buildSchema } from './schema'

// ADR-020 — generated per-module config + installation Sanity types.
// Safe in both bundles (imports `sanity`, never `sanity/structure`).
export {
  buildModuleConfigSchemaTypes,
  buildModuleInstallationsField,
  moduleConfigTypeName,
  moduleInstallationTypeName,
  moduleInstallationTypeNameForId,
} from './config-schema'

export { SECTION_MAP, isSectionTypeAvailable, type ModuleSectionProps, type SectionComponentMap } from './sections'

// buildCollectionItems — Studio-only. Imported directly by sanity.config.ts.
// Do NOT import this from Next.js page routes (pulls in sanity/structure).
export { buildCollectionItems } from './navigation'

export { buildModulePermissions, MODULE_PERMISSION_MAP } from './permissions'
