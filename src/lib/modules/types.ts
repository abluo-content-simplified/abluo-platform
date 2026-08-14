// ── Module manifest types ─────────────────────────────────────────────────────
// ADR-011 Phase A2 — full ModuleManifest type.
// ADR-011 Phase D3 — Navigation Derivation.
// ADR-011 Phase D4 — ModulePermissionMap added.
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

// ── Module configuration types ────────────────────────────────────────────────
// ADR-020 Decision 1 — "Configuration: module-owned settings, defined by a
// per-module config schema (the currently-undeclared `config` slot gains a
// real, typed shape per module)."
//
// Design notes:
//
// This mirrors IntegrationFieldDef (src/lib/integrations/types.ts) deliberately.
// Both describe "a per-project configurable value, declared in a manifest and
// generated into a Sanity object type" — one registry mechanism, two registries.
// Where the shapes differ it is because modules genuinely need more than
// integrations do: modules configure references to other documents (a WhatsApp
// message form, a header-CTA form), which no integration does.
//
// `type` is a CLOSED union here, unlike IntegrationFieldDef's free-form string.
// Integrations left it open because ADR-014's literal interface did not
// enumerate values; ADR-020 has no such constraint, and a closed union means
// buildModuleConfigField() cannot silently misrender an unrecognised type —
// TypeScript makes the switch exhaustive.

/**
 * The field shapes a module may declare in its config schema.
 *
 * string             — plain Sanity string (Rule.required/Rule.regex per declaration)
 * text               — multi-line string
 * boolean            — Sanity boolean, defaults to `initialValue ?? false`
 * number             — Sanity number
 * select             — one of a fixed set of values; `options` required
 * localizedString    — platform localizedString (multilingual-first; see CLAUDE.md)
 * localizedStringList — an ordered, repeatable list of localized labels, each with
 *                      a stable machine value. This is the shape behind "the admin
 *                      types the WhatsApp subjects here": one row per subject, one
 *                      input per site locale, reorderable. The stable `value` is
 *                      what gets recorded on a submission, so renaming a label —
 *                      or translating it — never breaks historical data.
 * reference          — reference to one or more document types, `referenceTo` required
 */
export type ModuleConfigFieldType =
  | 'string'
  | 'text'
  | 'boolean'
  | 'number'
  | 'select'
  | 'localizedString'
  | 'localizedStringList'
  | 'reference'

/** One choice in a `select` config field. */
export type ModuleConfigOption = {
  /** Stored value. */
  value: string
  /** Admin-facing label. */
  label: string
  /** Optional one-line explanation rendered under the choice. */
  description?: string
}

/**
 * One entry in a `localizedStringList` config value, as persisted.
 *
 * `value` is the stable identifier; `label` carries one string per site locale.
 * Adding a locale to the website surfaces an empty input for it automatically —
 * the localized inputs derive their locales from siteConfig.supportedLocales,
 * so no schema change is needed when a tenant adds German.
 */
export type ModuleConfigListEntry = {
  _key: string
  value: string
  label: Record<string, string>
  /** Optional badge colour, when the declaring field sets `supportsColor`. */
  color?: string
}

/**
 * One configurable value a module exposes per site.
 * Generates one Sanity field inside that module's generated
 * `${camelId}ModuleConfig` object type (see config-schema.ts), and one control
 * in the Modules pane.
 */
export type ModuleConfigFieldDef = {
  /** Unique within the manifest. Becomes the generated Sanity field name. */
  id: string
  /** Studio field label. */
  label: string
  /** Field shape — see ModuleConfigFieldType. */
  type: ModuleConfigFieldType
  /** Whether Sanity's Rule.required() is attached to the generated field. */
  required?: boolean
  /** Admin-facing help text. Shown in the Studio field and the Modules pane. */
  description: string
  /**
   * Document type names this reference may point to.
   * REQUIRED when type === 'reference'; ignored otherwise (validator Rule 12).
   */
  referenceTo?: string[]
  /**
   * GROQ filter narrowing the reference picker, e.g.
   * `_type == "formDefinition" && role == "active"`.
   * Only meaningful when type === 'reference'.
   */
  referenceFilter?: string
  /** Default applied to the generated Sanity field. */
  initialValue?: string | number | boolean
  /** Regex validation, generated as Rule.regex(...).error(message). String types only. */
  validation?: { regex: string; message: string }
  /**
   * The available choices. REQUIRED when type === 'select'; ignored otherwise
   * (validator Rule 12).
   */
  options?: ModuleConfigOption[]
  /**
   * Conditional visibility: show this field only when another field in the same
   * configSchema currently holds `equals`.
   *
   * This is what keeps a module pane honest as it grows. WhatsApp has two modes;
   * the subject list is meaningless in "open WhatsApp directly" mode, and showing
   * it anyway invites an admin to fill in settings that will never take effect.
   * The validator checks that `field` names a real sibling field, so a typo can't
   * silently hide a control forever.
   *
   * Visibility only — a hidden field is not cleared, so toggling a mode back and
   * forth does not destroy what was already typed.
   */
  showWhen?: { field: string; equals: string | boolean }
  /** For `localizedStringList`: each entry also carries an optional colour. */
  supportsColor?: boolean
  /**
   * Never render this field to an admin — in the Modules pane or the generated
   * Studio form. The value is written by the module itself.
   *
   * This is what lets a module keep plumbing out of sight: the WhatsApp module
   * maintains a reference to the form definition backing capture mode, but an
   * admin who just switched WhatsApp on has no business being asked to choose
   * a form. Hidden config is still real, typed, validated config — it simply
   * has an owner other than the person looking at the pane.
   */
  hidden?: boolean
}

// ── Module placement ──────────────────────────────────────────────────────────
// ADR-020 Decision 1 — "Placement: where the module surfaces (pages/sections/
// site-wide), declared per site."
//
// Design note — why placement is mostly DERIVED and not a new persistence layer:
//
// Two of the three placement surfaces are already fully described by the
// manifest: a module's singleton page is `platformContract.pageType`, and the
// sections it can be composed into are `platformContract.sectionTypes`. Where a
// section actually appears on a given site is decided by the page's `sections[]`
// array — that is the page's business, not the module's (CLAUDE.md: "Sections
// and Modules are orthogonal. Never couple them."). Inventing a second,
// module-side record of "which pages use my section" would duplicate that array
// and immediately drift from it.
//
// So ModulePlacementDef declares what surfaces a module CAN occupy, the Modules
// pane renders those as read-only facts derived from the manifest, and the one
// genuinely per-site writable placement decision — whether a site-wide surface
// is switched on, e.g. the floating WhatsApp button — is carried by a normal
// config field named in `toggleFieldId`. One writable surface, one storage
// location, no duplicated state.

export type ModulePlacementSurface =
  /** The module's singleton page (platformContract.pageType). */
  | { kind: 'page'; description: string }
  /** Sections the module contributes to page composition (platformContract.sectionTypes). */
  | { kind: 'sections'; description: string }
  /**
   * A surface the module renders on every page of the site, independent of page
   * composition — e.g. a floating button in the layout.
   * `toggleFieldId` names the boolean config field that switches it on per site;
   * validator Rule 13 checks it resolves to a declared boolean field.
   */
  | { kind: 'siteWide'; description: string; toggleFieldId?: string }

export type ModulePlacementDef = {
  /** The surfaces this module can occupy. Empty = the module has no website surface. */
  surfaces: ModulePlacementSurface[]
  /** Optional admin-facing note rendered under Placement in the Modules pane. */
  note?: string
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
  /**
   * Which roles receive this permission by default.
   * These are platform defaults only — not a fixed contract.
   * Future tenant-defined custom roles may override or extend these mappings
   * without requiring any change to module manifests.
   */
  defaultRoles: TenantRole[]
}

/**
 * A flat map of all module-declared permissions keyed by permission ID.
 * Built at module load time by buildModulePermissions() in
 * src/lib/modules/permissions.ts. Consumers should use the MODULE_PERMISSION_MAP
 * constant rather than rebuilding the map on every call.
 *
 * ADR-011 Phase D4 — Permission Derivation.
 */
export type ModulePermissionMap = Record<string, ModulePermissionDef>

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
  /** Machine identifier — used in project.moduleInstallations and all module keys. */
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
    /**
     * Per-site configuration fields this module owns (ADR-020 Decision 1).
     *
     * Generated into a `${camelId}ModuleConfig` Sanity object type by
     * buildModuleSchemaTypes() and rendered as editable controls by the
     * Modules pane. Values are persisted in
     * `project.moduleInstallations[moduleId == …].config`.
     *
     * An empty array is valid and common — it means "this module has status
     * and data but nothing to configure per site". A config type is still
     * generated for it, so every module has the same uniform shape.
     *
     * This is where communications config lives after ADR-020 Decision 2:
     * module config, never siteConfig.
     */
    configSchema: ModuleConfigFieldDef[]
    /**
     * Where this module surfaces on a website (ADR-020 Decision 1).
     * Mostly derived facts rendered read-only by the Modules pane; see the
     * design note on ModulePlacementDef for why this is not a second
     * persistence layer.
     */
    placement: ModulePlacementDef
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
// config stays Record<string, unknown> by design (ADR-020). Each module's
// generated `${camelId}ModuleConfig` Sanity object type is the source of shape
// and validation truth in the Studio — exactly as IntegrationConfig.values
// stays generic against its generated `*IntegrationValues` type. Narrowing this
// to a per-module union in TypeScript would require the consuming code to
// discriminate on moduleId at every read site for no safety that the generated
// schema and readModuleConfig() do not already provide.
export type ModuleInstallation = {
  /** References ModuleManifest.id — the module being installed. */
  moduleId: string
  /** Semver version of the manifest when this installation was created. */
  version: string
  /** Whether this module is currently active for the project. */
  enabled: boolean
  /** ISO 8601 datetime when the installation record was created. */
  installedAt: string
  /**
   * Module-specific configuration, shaped by the manifest's configSchema.
   * `{}` for a module that declares no config fields.
   */
  config: Record<string, unknown>
  /** How this installation record was created — 'admin' (manual) or 'auto' (migration). */
  provenance: 'admin' | 'auto'
}

// ModuleDef alias removed in Phase D1 — use ModuleManifest.
