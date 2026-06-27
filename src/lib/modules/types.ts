// ── Module manifest types ─────────────────────────────────────────────────────
// ADR-011 Phase A2 — full ModuleManifest type.
//
// Design notes:
//
// CollectionItemsContext is defined here (not in registry.ts) to avoid a
// circular import: ModuleManifest.platformContract.collectionItems references
// CollectionItemsContext, and registry.ts types MODULE_REGISTRY as
// ModuleManifest[] — both files need the type. Defining it here breaks the
// potential cycle.
//
// TenantRole is imported from src/lib/types/roles.ts — a neutral shared
// location that avoids a circular dependency with permissions.ts. In Phase D4,
// permissions.ts will import ModuleInstallation from the modules layer; by
// routing TenantRole through a shared file, neither modules nor permissions
// imports from the other.

import type { SchemaTypeDefinition } from 'sanity'
import type { StructureBuilder } from 'sanity/structure'
import type { TenantRole } from '../types/roles'

// ── Collection items context ──────────────────────────────────────────────────
// Passed to each module's collectionItems function instead of relying on a
// closure over the Sanity structure callback parameter S.
//
// The context object API is preferred over positional parameters: additional
// values — project metadata, installation state, permissions, feature flags —
// can be added here in future phases without changing the collectionItems
// function signature.
//
// ADR-011 Phase A1 — introduced with registry relocation.
// ADR-011 Phase A2 — moved here from registry.ts to prevent a circular import.
export type CollectionItemsContext = {
  slug: string
  S: StructureBuilder
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
     * Returns the Studio collection list items this module contributes.
     * Called at structure build time with the project slug and StructureBuilder.
     * Returns an empty array for modules with no collections.
     * Consumed directly by sanity.config.ts structure builder.
     */
    collectionItems: (ctx: CollectionItemsContext) => ReturnType<StructureBuilder['listItem']>[]
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
