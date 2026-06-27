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
//
// Isolation boundaries (must be maintained):
//   sections.ts  — imported by Next.js routes only (never by sanity.config.ts / Studio)
//   navigation.ts — imported by sanity.config.ts only (never by Next.js routes)

export {
  type ModuleManifest,
  type ModuleCollectionGroupDef,
  type ModuleCollectionItemDef,
  type ModuleCategory,
  type ModulePermissionDef,
  type ModuleDependency,
  type ModuleInstallation,
} from './types'

export { MODULE_REGISTRY } from './registry'

export { buildSchema } from './schema'

export { SECTION_MAP, type ModuleSectionProps, type SectionComponentMap } from './sections'

// buildCollectionItems — Studio-only. Imported directly by sanity.config.ts.
// Do NOT import this from Next.js page routes (pulls in sanity/structure).
export { buildCollectionItems } from './navigation'
