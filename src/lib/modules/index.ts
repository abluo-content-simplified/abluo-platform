// ── Module infrastructure barrel ─────────────────────────────────────────────
// ADR-011 — src/lib/modules/ is the home for all module infrastructure.
// Phase A1: registry relocation.
// Phase A2: full ModuleManifest type and migration of registry entries.
// Phase A3: build-time validation.

export { MODULE_REGISTRY, type ModuleDef, type CollectionItemsContext } from './registry'
