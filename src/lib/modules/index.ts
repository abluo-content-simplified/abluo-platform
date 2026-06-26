// ── Module infrastructure barrel ─────────────────────────────────────────────
// ADR-011 — src/lib/modules/ is the home for all module infrastructure.
//
// Phase A1: registry relocation.
// Phase A2: full ModuleManifest type; CollectionItemsContext moved to types.ts;
//           TenantRole extracted to src/lib/types/roles.ts.
// Phase A3: build-time manifest validation.

export {
  type ModuleManifest,
  type ModuleDef,           // @deprecated — use ModuleManifest; removed after B1
  type CollectionItemsContext,
  type ModuleCategory,
  type ModulePermissionDef,
  type ModuleDependency,
} from './types'

export { MODULE_REGISTRY } from './registry'
