import { defineType, defineField, defineArrayMember } from 'sanity'
import type { SchemaTypeDefinition } from 'sanity'
import { INTEGRATION_REGISTRY } from './registry'
import type { IntegrationFieldDef, IntegrationManifest } from './types'

// ── Integration schema derivation ─────────────────────────────────────────────
// ADR-014 Phase A core move: the Sanity schema for every integration is
// GENERATED from INTEGRATION_REGISTRY's manifests, not hand-written per
// integration. Mirrors src/lib/modules/schema.ts's buildSchema(), which does
// the equivalent derivation for MODULE_REGISTRY.
//
// For each manifest this module generates two object types:
//   - `${camelId}IntegrationValues` — one field per IntegrationFieldDef,
//     matching schema.ts's existing house style for string validation
//     (Rule.regex(...).error(...), schema.ts ~L3117 googleAnalyticsId
//     precedent).
//   - `${camelId}IntegrationConfig`  — { integrationId, enabled, values },
//     mirroring ModuleInstallation's shape (moduleId/enabled/config) applied
//     to a single per-integration entry rather than the whole module registry.
//
// Contract-parity note (Gate 4): because both generated types are produced
// directly from the same IntegrationManifest['fields'] array, and
// IntegrationFieldDef is the one TS type both this generator and every
// manifest file are checked against, schema ↔ manifest parity holds by
// construction — there is no second, hand-maintained projection to drift.

// ── Naming ─────────────────────────────────────────────────────────────────────

/** Converts a kebab-case manifest id ("google-analytics") to camelCase ("googleAnalytics"). */
function toCamelCase(kebabId: string): string {
  return kebabId
    .split('-')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

/** `${camelId}IntegrationValues` — the manifest's generated values object type name. */
export function integrationValuesTypeName(manifest: IntegrationManifest): string {
  return `${toCamelCase(manifest.id)}IntegrationValues`
}

/** `${camelId}IntegrationConfig` — the manifest's generated config object type name. */
export function integrationConfigTypeName(manifest: IntegrationManifest): string {
  return `${toCamelCase(manifest.id)}IntegrationConfig`
}

// ── Field generation ───────────────────────────────────────────────────────────

/**
 * Generates one Sanity field definition per IntegrationFieldDef.
 *
 * Phase A recognizes exactly two shapes:
 *   - `type: 'customScriptArray'` — explicitly special-cased (see
 *     manifests/custom-scripts.ts) — reproduces the ADR-013-hardened
 *     array-of-scripts shape via buildCustomScriptArrayField() below.
 *   - anything else (Phase A only ever uses 'string') — a plain Sanity
 *     `string` field with Rule.required()/Rule.regex() attached per the
 *     field's `required`/`validation` declaration.
 *
 * A future field type (number, boolean, etc.) will need its own branch here
 * when a manifest first declares one — this function does not silently
 * misrender an unrecognized type as something it isn't; it falls through to
 * the string branch, matching the only two shapes Phase A's manifests use.
 */
function buildFieldDefinition(field: IntegrationFieldDef) {
  if (field.type === 'customScriptArray') {
    return buildCustomScriptArrayField(field)
  }

  return defineField({
    name: field.id,
    title: field.label,
    type: 'string',
    description: field.description,
    validation: (Rule) => {
      const rules = []
      if (field.required) rules.push(Rule.required())
      if (field.validation) {
        rules.push(
          Rule.regex(new RegExp(field.validation.regex), { name: `${field.id}-format` }).error(
            field.validation.message
          )
        )
      }
      return rules
    },
  })
}

/**
 * Reproduces the ADR-013-hardened custom-scripts array shape verbatim
 * (previously siteConfig.integrations.customScripts, src/lib/sanity/schema.ts
 * ~L3146–3212): label, description, placement, code, consentCategory all
 * required except placement/enabled; consentCategory required with the four
 * consent values; enabled defaults to false (disabled by default, per
 * ADR-013's security hardening).
 */
function buildCustomScriptArrayField(field: IntegrationFieldDef) {
  return defineField({
    name: field.id,
    title: field.label,
    type: 'array',
    description: field.description,
    of: [
      defineArrayMember({
        type: 'object',
        name: 'customScript',
        fields: [
          defineField({
            name: 'label',
            title: 'Label',
            type: 'string',
            description: 'Internal identifier for this script — not shown publicly.',
            validation: (Rule) => Rule.required(),
          }),
          defineField({
            name: 'description',
            title: 'Description / Purpose',
            type: 'text',
            rows: 3,
            description: 'What this script does and why it exists — internal documentation for admins.',
            validation: (Rule) => Rule.required(),
          }),
          defineField({
            name: 'placement',
            title: 'Placement',
            type: 'string',
            options: {
              list: [
                { title: 'Head', value: 'head' },
                { title: 'End of body', value: 'bodyEnd' },
              ],
              layout: 'radio',
            },
            initialValue: 'head',
          }),
          defineField({
            name: 'code',
            title: 'Code',
            type: 'text',
            rows: 6,
            description: 'Raw HTML/script, injected verbatim.',
            validation: (Rule) => Rule.required(),
          }),
          defineField({
            name: 'consentCategory',
            title: 'Consent Category',
            type: 'string',
            options: {
              list: [
                { title: 'Necessary', value: 'necessary' },
                { title: 'Analytics', value: 'analytics' },
                { title: 'Marketing', value: 'marketing' },
                { title: 'Functional', value: 'functional' },
              ],
              layout: 'radio',
            },
            description:
              'When consentModeEnabled is on and no valid visitor consent exists, only Necessary scripts load — Analytics, Marketing, and Functional scripts are blocked until the consent mechanism ships and consent is given.',
            validation: (Rule) => Rule.required(),
          }),
          defineField({ name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: false }),
        ],
        preview: {
          select: { title: 'label', category: 'consentCategory', placement: 'placement', enabled: 'enabled' },
          prepare: ({
            title,
            category,
            placement,
            enabled,
          }: {
            title?: string
            category?: string
            placement?: string
            enabled?: boolean
          }) => ({
            title: title ?? 'Untitled script',
            subtitle: `${category ?? '—'} · ${placement ?? '—'}${enabled === false ? ' · disabled' : ''}`,
          }),
        },
      }),
    ],
  })
}

// ── Type generation ────────────────────────────────────────────────────────────

/** `${camelId}IntegrationValues` — one field per manifest.fields entry. */
function buildValuesType(manifest: IntegrationManifest): SchemaTypeDefinition {
  return defineType({
    name: integrationValuesTypeName(manifest),
    title: `${manifest.label} — Values`,
    type: 'object',
    fields: manifest.fields.map(buildFieldDefinition),
  })
}

/**
 * `${camelId}IntegrationConfig` — the per-project config member type for this
 * integration: { integrationId, enabled, values }. Mirrors ModuleInstallation's
 * shape (moduleId/enabled/config) — integrationId is hidden/read-only with the
 * manifest id as its initialValue (the array member "knows what it is" without
 * an admin ever setting it), enabled defaults to false, values is the
 * manifest-generated values type.
 */
function buildConfigType(manifest: IntegrationManifest): SchemaTypeDefinition {
  const valuesTypeName = integrationValuesTypeName(manifest)

  return defineType({
    name: integrationConfigTypeName(manifest),
    title: `${manifest.label} — Config`,
    type: 'object',
    fields: [
      defineField({
        name: 'integrationId',
        title: 'Integration ID',
        type: 'string',
        readOnly: true,
        hidden: true,
        initialValue: manifest.id,
      }),
      defineField({
        name: 'enabled',
        title: 'Enabled',
        type: 'boolean',
        initialValue: false,
      }),
      defineField({
        name: 'values',
        title: 'Values',
        type: valuesTypeName,
      }),
    ],
    preview: {
      select: { enabled: 'enabled' },
      prepare: ({ enabled }: { enabled?: boolean }) => ({
        title: manifest.label,
        subtitle: enabled ? 'Enabled' : 'Disabled',
      }),
    },
  })
}

// ── Public generators ──────────────────────────────────────────────────────────

/**
 * Generates every values type and config type for every manifest in
 * INTEGRATION_REGISTRY. Called by src/lib/sanity/schema.ts to splice these
 * into the platform schema's exported types array, alongside buildSchema()'s
 * module-owned types.
 */
export function buildIntegrationSchemaTypes(): SchemaTypeDefinition[] {
  const types: SchemaTypeDefinition[] = []
  for (const manifest of INTEGRATION_REGISTRY) {
    types.push(buildValuesType(manifest))
    types.push(buildConfigType(manifest))
  }
  return types
}

/**
 * The `integrationConfigs` array field definition for the project document.
 * One array member type per manifest's generated `*IntegrationConfig` type —
 * a union of shapes, not one shared shape, because each integration's
 * `values` sub-object is generated differently. Exported so
 * src/lib/sanity/schema.ts can splice this into projectType.fields, right
 * beside moduleInstallations (schema.ts ~L1876–1902), the same placement
 * pattern ADR-011 established for module installations.
 *
 * Hidden from the raw Studio form — managed programmatically, same as
 * moduleInstallations, until Phase B's IntegrationsPane provides the real UI.
 */
export function buildIntegrationConfigsField() {
  return defineField({
    name: 'integrationConfigs',
    title: 'Integration Configurations',
    type: 'array',
    description:
      'Platform-managed. Configuration for third-party integrations (Analytics, Marketing, Forms, AI, Payments, Developers), one entry per installed integration. Managed via the future Integrations pane — Studio IA comes in ADR-014 Phase B, not this raw array form.',
    of: INTEGRATION_REGISTRY.map((manifest) =>
      defineArrayMember({ type: integrationConfigTypeName(manifest) })
    ),
    hidden: true,
  })
}
