// ── Integration manifest types ────────────────────────────────────────────────
// ADR-014 Phase A — Integration Registry & the One-Configuration-Surface Principle.
//
// Mirrors src/lib/modules/types.ts (ModuleManifest / ModuleInstallation) in
// spirit and file layout. Where ADR-014 gives an interface verbatim
// (architecture-decisions.md L901–925), it is reproduced here unchanged.
//
// Design notes:
//
// IntegrationFieldDef.type is a free-form string, not a closed union. Phase A
// only ever generates two shapes from it (see buildIntegrationSchemaTypes() in
// schema.ts): a plain Sanity `string` field (the default), and the special
// 'customScriptArray' marker consumed explicitly by the generator to reproduce
// the ADR-013-hardened custom-scripts array shape. AI decides: ADR-014's
// literal interface does not enumerate field `type` values, so this is the
// narrowest extension that lets custom-scripts fit the same IntegrationFieldDef
// shape as every other manifest without inventing a second registry mechanism.
// See manifests/custom-scripts.ts for the full rationale.

import type { SchemaTypeDefinition } from 'sanity'

// ── Integration category ──────────────────────────────────────────────────────
// ADR-014's six-category Studio IA. Only 'analytics' and 'developers' are
// functional in Phase A; the rest render registry-derived coming-soon states
// once Phase B's IntegrationsPane exists — no manifest is registered under
// them yet, which is what makes them "coming soon" rather than hardcoded.
export type IntegrationCategory =
  | 'analytics'
  | 'marketing'
  | 'forms'
  | 'ai'
  | 'payments'
  | 'developers'

// ── Integration field definition ──────────────────────────────────────────────
// One configurable value an integration exposes. Generates one Sanity field
// inside that integration's generated `*IntegrationValues` object type
// (see schema.ts).
export type IntegrationFieldDef = {
  /** Unique within the manifest. Becomes the generated Sanity field name. */
  id: string
  /** Studio field label. */
  label: string
  /**
   * Field type. 'string' (the implicit default used by every field below that
   * doesn't opt into a special case) generates a plain Sanity string field.
   * 'customScriptArray' is explicitly special-cased by the generator — see the
   * design note above and manifests/custom-scripts.ts.
   */
  type: string
  /** Whether Sanity's Rule.required() is attached to the generated field. */
  required: boolean
  /** Regex validation, generated as Rule.regex(new RegExp(regex), {...}).error(message). */
  validation?: { regex: string; message: string }
  /**
   * Forward hook for Supabase-backed storage (ADR-014 "Deferred" — per-field
   * storage split is not implemented in Phase A). A field marked `secret: true`
   * signals that a future integration may need this value written to Supabase
   * rather than Sanity, even while the manifest's own `storage` stays 'content'.
   * Not consumed by any generator logic yet.
   */
  secret: boolean
  /** Admin-facing description shown in the Studio field's help text. */
  description: string
}

// ── Integration manifest ──────────────────────────────────────────────────────
// The complete declaration of one integration's identity, category, consent
// classification, and configurable fields. Mirrors ADR-014 architecture-
// decisions.md L901–914 verbatim.
export type IntegrationManifest = {
  /** Machine identifier — used in IntegrationConfig.integrationId and generated type names. */
  id: string
  /** Canonical Studio label. */
  label: string
  /** Semver version string. */
  version: string
  /** Lifecycle status of this integration. */
  status: 'released' | 'beta' | 'deprecated'
  /** Studio IA category (ADR-014's six categories). */
  category: IntegrationCategory
  /** Optional icon identifier for the future IntegrationsPane. */
  icon?: string
  /** Optional link to the integration's own documentation. */
  docsUrl?: string
  /**
   * Consent classification read by the Privacy section's global gating
   * (ADR-013, carried forward unchanged by ADR-014). For custom-scripts this
   * describes only the integration shell, not per-script gating — see
   * manifests/custom-scripts.ts.
   */
  consentCategory: 'necessary' | 'analytics' | 'marketing' | 'functional'
  /** The configurable fields this integration exposes. */
  fields: IntegrationFieldDef[]
  /**
   * Storage tier for this integration's values.
   * 'content' = Sanity, 'operational' = Supabase — per manifest for now
   * (ADR-014 "Deferred" — per-field storage split not yet supported).
   */
  storage: 'content' | 'operational'
  /** Which frontend component renders this integration's runtime behavior. */
  renderContract?: { component: string }

  // ── Deferred (ADR-014 "Deferred" section) ──────────────────────────────────
  // Per-integration environment selection. The platform remains
  // production-only for every integration in Phase A. A manifest field is
  // reserved for this in ADR-014's design but intentionally not declared on
  // this type yet — adding `environment?: 'production' | ...` is a Phase-B-
  // or-later change, not a Phase A concern.
}

// ── Integration configuration ─────────────────────────────────────────────────
// Per-project state, mirroring ModuleInstallation's style (ADR-011 Sub-decision
// B2's array-on-document model). Stored as integrationConfigs: IntegrationConfig[]
// on the project document (src/lib/sanity/schema.ts, projectType).
//
// integrationId references IntegrationManifest.id.
// values is intentionally Record<string, unknown> — the generated Sanity object
// type (`*IntegrationValues`) is the source of shape/validation truth in
// Studio; this TS type stays generic the same way ModuleInstallation.config does.
export type IntegrationConfig = {
  /** References IntegrationManifest.id — the integration being configured. */
  integrationId: string
  /** Whether this integration is currently active for the project. */
  enabled: boolean
  /** Integration-specific configuration values, shaped by the manifest's fields. */
  values: Record<string, unknown>
}

// Re-exported for generator call sites that need the Sanity type without a
// second import of 'sanity' — mirrors how modules/types.ts imports
// SchemaTypeDefinition for schemaDefinitions().
export type { SchemaTypeDefinition }
