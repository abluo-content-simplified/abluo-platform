// ── Module manifest types ─────────────────────────────────────────────────────
// ADR-011 Phase A2 — full ModuleManifest type.
// ADR-011 Phase D3 — Navigation Derivation.
//
// Design notes:
//
// CollectionItemsContext has been removed (Phase D3). The imperative
// collectionItems() lambda has been replaced by a declarative `collections`
// array of ModuleCollectionGroupDef. buildCollectionItems() in navigation.ts
// turns these declarations into Studio structure items at config-build time.
// This removes the StructureBuilder import from this file entirely.
//
// TenantRole is imported from src/lib/types/roles.ts — a neutral shared
// location that avoids a circular dependency with permissions.ts. In Phase D4,
// permissions.ts will import ModuleInstallation from the modules layer; by
// routing TenantRole through a shared file, neither modules nor permissions
// imports from the other.

import type { SchemaTypeDefinition } from 'sanity'
import type { TenantRole } from '../types/roles'

// ── Collection types ──────────────────────────────────────────────────────────
// Declarative description of the Studio document-list collections a module
// contributes. buildCollectionItems() in navigation.ts reads these and builds
// the actual Sanity structure items — no imperative builder code belongs here.
//
// ADR-011 Phase D3 — introduced to replace the imperative collectionItems lambda.

/**
 * A single document-list sub-collection within a module's Studio group.
 * Maps to one S.listItem() → S.documentList() entry inside the group's child list.
 */
export type ModuleCollectionItemDef = {
  /** Unique within this group. Combined with the project slug: "${slug}-${id}". */
  id: string
  /** Studio display label for this document list. */
  label: string
  /** The Sanity document type this list displays. */
  schemaType: string
  /**
   * GROQ filter fragment. Use `$slug` to reference the project slug.
   * Example: `_type == "post" && projectSlug == $slug`
   */
  filter: string
  /**
   * Default sort ordering for the document list.
   * Each entry: `{ field: string; direction: 'asc' | 'desc' }`.
   * Omit if no default ordering is needed.
   */
  ordering?: { field: string; direction: 'asc' | 'desc' }[]
  /**
   * Initial value template ID for new documents created from this list.
   * Corresponds to a template defined in initialValueTemplates in schema.ts.
   * Omit if no initial value template is needed.
   */
  initialValueTemplate?: string
}

/**
 * A named group of document-list collections in the Studio sidebar.
 * Maps to one S.listItem() → S.list() → [items] structure.
 * Groups with zero items are excluded from the Studio structure at build time.
 */
export type ModuleCollectionGroupDef = {
  /** Unique within this module. Combined with the project slug: "${slug}-${id}". */
  id: string
  /** Studio display label for the group and its inner list. */
  label: string
  /** The document lists inside this group. Must be non-empty for the group to appear. */
  items: ModuleCollectionItemDef[]
}

// ── Module category ───────────────────────────────────────────────────────────
// Non-functional in Phase A2. Reserved for future UI filtering and grouping.
export type ModuleCategory =
  | 'content'
  | 'commerce'
  | 'engagement'
  | 'analytics'
  | 'platform'

// ── Module permission definition ──────────────────────────────────────────────
// A single declared permission within a module.
// Consumed by Phase D4 (Permission Derivation) to generate the platform's
// role-based access control rules.
//
// ID convention: "{moduleId}.{noun}.{verb}" — e.g. "blog.post.write"
export type ModulePermissionDef = {
  /** Unique permission identifier. Format: "{moduleId}.{noun}.{verb}" */
  id: string
  /** Human-readable label for the admin UI. */
  label: string
  /** What this permission allows — shown in role management UI. */
  description: string
  /** Which roles receive this permission by default. */
  defaultRoles: TenantRole[]
}

// ── Module dependency ─────────────────────────────────────────────────────────
// A hard dependency on another module. If a module lists a required dependency,
// the platform must ensure the dependency is installed before this module is
// activated. Consumed by Phase B1.
export type ModuleDependency = {
  /** The required module's id. */
  moduleId: string
  /** Why this dependency is required — used in install-time error messages. */
  reason: string
}

// ── Module manifest ───────────────────────────────────────────────────────────
// The complete declaration of a module's capabilities, contracts, and metadata.
//
// Fields in platformContract are declared here but not yet consumed by the
// platform — derivation is wired in Phases D1–D4. Declaring them now gives
// the registry a single authoritative source of truth for each module's
// surface area before any derivation logic exists.
export type ModuleManifest = {

  // ── Identity ──────────────────────────────────────────────────────────────
  /** Machine identifier — used in project.enabledModules and all module keys. */
  id: string
  /** Canonical Studio label — Admin UI concern, not website content (ADR-010). */
  label: string
  /** Semver version string. Bump on meaningful manifest changes. */
  version: string
  /** Lifecycle status of this module. */
  status: 'released' | 'deprecated' | 'archived'
  /** Non-functional in A2. Reserved for future UI grouping. */
  category?: ModuleCategory

  // ── Platform contract ──────────────────────────────────────────────────────
  // Everything the platform needs to know to integrate this module.
  // Fields are declared here; consumed by derivation machinery in D1–D4.
  platformContract: {
    /**
     * Sanity document type for this module's singleton page.
     * Optional — a module that has no singleton page omits this field.
     * Consumed by Phase D3 (Navigation Derivation).
     */
    pageType?: string
    /**
     * Declarative description of the Studio document-list groups this module
     * contributes. Read by buildCollectionItems() in navigation.ts to produce
     * the actual Sanity structure items at config-build time.
     * Empty array for modules with no collections (e.g. Live module).
     * Consumed by Phase D3 (Navigation Derivation).
     */
    collections: ModuleCollectionGroupDef[]
    /**
     * Sanity section _type values this module contributes to SectionRenderer.
     * Declared here; consumed by Phase D2 (Section Map Derivation).
     */
    sectionTypes: string[]
    /**
     * All Sanity schema type names this module owns (document types and
     * embedded object types). Declared here; consumed by Phase D1 (Schema
     * Derivation) for validation and tooling.
     *
     * Must stay in sync with schemaDefinitions — every name here must have a
     * corresponding type returned by schemaDefinitions(). No automated check
     * enforces this yet; it is a manual invariant until a future validation rule
     * is added.
     */
    schemaTypes: string[]
    /**
     * Returns the actual Sanity type definition objects this module contributes.
     * Called by buildSchema() in src/lib/modules/schema.ts to compose the
     * platform schema. This is the import reference the roadmap specifies:
     * a function rather than a path-based lookup, so the module is statically
     * importable and tree-shakeable.
     *
     * Consumed by Phase D1 (Schema Derivation).
     */
    schemaDefinitions: () => SchemaTypeDefinition[]
    /**
     * Permission declarations for this module.
     * Consumed by Phase D4 (Permission Derivation).
     */
    permissions: ModulePermissionDef[]
  }

  // ── Public contract ────────────────────────────────────────────────────────
  // Reserved for future inter-module communication surface.
  // Empty stub in Phase A2.
  publicContract: Record<string, never>

  // ── Dependencies ──────────────────────────────────────────────────────────
  dependencies: {
    /** Hard dependencies — must be installed before this module activates. */
    requires: ModuleDependency[]
    /**
     * Optional integrations — module IDs this module can integrate with if
     * they are installed. The platform does not enforce these; they are
     * informational for install-time UI and documentation.
     */
    integratesWith: string[]
  }

  // ── Data store ────────────────────────────────────────────────────────────
  dataStore: {
    /**
     * Primary storage tier for this module's data.
     * content     — editorial/publishable data in Sanity
     * operational — transactional data in Supabase
     * hybrid      — both tiers
     */
    primary: 'content' | 'operational' | 'hybrid'
  }

  // ── Changelog ─────────────────────────────────────────────────────────────
  /** Inline release notes or link to an external changelog. */
  changelog: string
}

// ── Module installation ───────────────────────────────────────────────────────
// A record of one module's installation on a specific project.
// Stored as moduleInstallations: ModuleInstallation[] on the project document
// in Sanity (ADR-011 Phase B1).
//
// moduleId references ModuleManifest.id.
// version captures the manifest version at install time — not the live registry
// version. Bumping the manifest version without running an update is intentional:
// it signals that the project's content conforms to the old version until
// an admin-triggered update is applied (Phase E1–E2).
//
// config is intentionally Record<string, unknown> for now. No module declares
// a config schema yet. Type-narrowing is deferred until Phase C2.
export type ModuleInstallation = {
  /** References ModuleManifest.id — the module being installed. */
  moduleId: string
  /** Semver version of the manifest when this installation was created. */
  version: string
  /** Whether this module is currently active for the project. */
  enabled: boolean
  /** ISO 8601 datetime when the installation record was created. */
  installedAt: string
  /** Module-specific configuration. Empty object until modules declare config schemas. */
  config: Record<string, unknown>
  /** How this installation record was created — 'admin' (manual) or 'auto' (migration). */
  provenance: 'admin' | 'auto'
}

// ModuleDef alias removed in Phase D1 — use ModuleManifest.
