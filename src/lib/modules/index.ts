// ── Module infrastructure barrel ─────────────────────────────────────────────
// ADR-011 — src/lib/modules/ is the home for all module infrastructure.
//
// Phase A1: registry relocation.
// Phase A2: full ModuleManifest type; CollectionItemsContext moved to types.ts;
//           TenantRole extracted to src/lib/types/roles.ts.
// Phase A3: build-time manifest validation.
// Phase B1: ModuleInstallation type; moduleInstallations field on project doc.
// Phase D1: schemaDefinitions on ModuleManifest; buildSchema(); module schema files;
//           ModuleDef alias removed.
// Phase D2: SECTION_MAP + ModuleSectionProps; blog/sections.tsx; registry remains
//           purely declarative — no React components in ModuleManifest.

export {
  type ModuleManifest,
  type CollectionItemsContext,
  type ModuleCategory,
  type ModulePermissionDef,
  type ModuleDependency,
  type ModuleInstallation,
} from './types'

export { MODULE_REGISTRY } from './registry'

export { buildSchema } from './schema'

export { SECTION_MAP, type ModuleSectionProps, type SectionComponentMap } from './sections'
