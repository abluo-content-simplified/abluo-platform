import { defineType, defineField, defineArrayMember } from 'sanity'
import type { SchemaTypeDefinition } from 'sanity'
import { MODULE_REGISTRY } from './registry'
import type { ModuleConfigFieldDef, ModuleManifest } from './types'

// ── Module config schema derivation ───────────────────────────────────────────
// ADR-020 Decision 1 — the `config` slot on ModuleInstallation gains "a real,
// typed shape per module".
//
// This file is to MODULE_REGISTRY what src/lib/integrations/schema.ts is to
// INTEGRATION_REGISTRY: the Sanity shape for every module's per-site config is
// GENERATED from the manifest, never hand-written per module. Adding a config
// field to a module is a one-line edit in that module's manifest — the Sanity
// type, the Studio control in the Modules pane, and validation all follow.
//
// For each manifest two object types are generated:
//   - `${camelId}ModuleConfig`       — one field per ModuleConfigFieldDef.
//   - `${camelId}ModuleInstallation` — { moduleId, version, enabled,
//     installedAt, provenance, config } where `config` is the type above.
//
// Why an array-member UNION rather than one shared installation type:
// each module's `config` sub-object has a different shape, so the array member
// type must differ per module — the same reason integrationConfigs is a union.
// Every entry therefore carries a `_type` discriminator; anything writing to
// `moduleInstallations` (the Modules pane, migrations) must set it, which is
// what moduleInstallationTypeName() is exported for.
//
// Isolation: this file imports only `sanity` (not `sanity/structure`) and the
// declarative registry, so it is safe in both the Studio and Next.js bundles —
// same constraint that applies to registry.ts and schema.ts in this directory.

// ── Naming ─────────────────────────────────────────────────────────────────────

/** Converts a kebab-case manifest id ("my-module") to camelCase ("myModule"). */
function toCamelCase(kebabId: string): string {
  return kebabId
    .split('-')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

/** `${camelId}ModuleConfig` — the manifest's generated config object type name. */
export function moduleConfigTypeName(manifest: ModuleManifest): string {
  return `${toCamelCase(manifest.id)}ModuleConfig`
}

/** `${camelId}ModuleInstallation` — the manifest's generated installation member type name. */
export function moduleInstallationTypeName(manifest: ModuleManifest): string {
  return `${toCamelCase(manifest.id)}ModuleInstallation`
}

/**
 * Resolves the installation `_type` for a module id without needing the
 * manifest object. Used by the Modules pane and by content migrations, both of
 * which work from ids. Returns null for an id not in the registry — callers
 * must not invent an installation record for an unknown module.
 */
export function moduleInstallationTypeNameForId(moduleId: string): string | null {
  const manifest = MODULE_REGISTRY.find((m) => m.id === moduleId)
  return manifest ? moduleInstallationTypeName(manifest) : null
}

// ── Field generation ───────────────────────────────────────────────────────────

/**
 * Generates one Sanity field definition per ModuleConfigFieldDef.
 *
 * The switch is exhaustive over ModuleConfigFieldType (a closed union), so a
 * new field shape is a compile error here until it is handled — it can never
 * silently fall through and render as the wrong control.
 */
function buildModuleConfigField(field: ModuleConfigFieldDef) {
  const common = {
    name: field.id,
    title: field.label,
    description: field.description,
    // Module-managed values are hidden from the generated Studio form too, not
    // just from the Modules pane — there is exactly one writer either way.
    ...(field.hidden ? { hidden: true } : {}),
  }

  switch (field.type) {
    case 'boolean':
      return defineField({
        ...common,
        type: 'boolean',
        initialValue: typeof field.initialValue === 'boolean' ? field.initialValue : false,
      })

    case 'number':
      return defineField({
        ...common,
        type: 'number',
        initialValue: typeof field.initialValue === 'number' ? field.initialValue : undefined,
        validation: (Rule) => (field.required ? Rule.required() : Rule),
      })

    case 'select':
      return defineField({
        ...common,
        type: 'string',
        options: {
          list: (field.options ?? []).map((o) => ({ title: o.label, value: o.value })),
          layout: 'radio',
        },
        initialValue: typeof field.initialValue === 'string' ? field.initialValue : undefined,
        validation: (Rule) => (field.required ? Rule.required() : Rule),
      })

    case 'localizedString':
      // Multilingual-first (CLAUDE.md): any user-facing string a module exposes
      // per site is authored per locale, never as a bare string.
      return defineField({
        ...common,
        type: 'localizedString',
        validation: (Rule) => (field.required ? Rule.required() : Rule),
      })

    case 'localizedStringList':
      // An ordered list of localized labels, each with a stable machine value.
      //
      // The `value` is deliberately separate from the label: it is what gets
      // written onto a submission, so an admin can rename "Emergency" to
      // "Urgent care", or translate it into German, without orphaning every
      // record that already referenced it.
      return defineField({
        ...common,
        type: 'array',
        of: [
          defineArrayMember({
            type: 'object',
            name: `${field.id}Entry`,
            fields: [
              defineField({
                name: 'label',
                title: 'Label',
                type: 'localizedString',
                description: 'Shown to visitors. One value per website language.',
                validation: (Rule) => Rule.required(),
              }),
              defineField({
                name: 'value',
                title: 'Reference',
                type: 'string',
                description:
                  'Stable internal identifier recorded with each submission. Changing it breaks the link to existing records — rename the label instead.',
                validation: (Rule) => Rule.required(),
              }),
              ...(field.supportsColor
                ? [defineField({
                    name: 'color',
                    title: 'Badge Colour',
                    type: 'string',
                    description: 'Optional. A hex value like #e94e1b, or a colour name.',
                  })]
                : []),
            ],
            preview: {
              select: { en: 'label.en', it: 'label.it', value: 'value' },
              prepare: ({ en, it, value }: { en?: string; it?: string; value?: string }) => ({
                title: en ?? it ?? value ?? '—',
                subtitle: value,
              }),
            },
          }),
        ],
        validation: (Rule) => (field.required ? Rule.required().min(1) : Rule),
      })

    case 'reference':
      return defineField({
        ...common,
        type: 'reference',
        to: (field.referenceTo ?? []).map((t) => ({ type: t })),
        options: field.referenceFilter ? { filter: field.referenceFilter } : undefined,
        validation: (Rule) => (field.required ? Rule.required() : Rule),
      })

    case 'text':
      return defineField({
        ...common,
        type: 'text',
        rows: 3,
        validation: (Rule) => (field.required ? Rule.required() : Rule),
      })

    case 'string':
      return defineField({
        ...common,
        type: 'string',
        initialValue: typeof field.initialValue === 'string' ? field.initialValue : undefined,
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
}

// ── Type generation ────────────────────────────────────────────────────────────

/**
 * `${camelId}ModuleConfig` — one field per manifest configSchema entry.
 *
 * A module with an empty configSchema still gets a type, carrying a single
 * hidden marker field: Sanity rejects an object type with zero fields, and
 * generating the type unconditionally is what keeps every module's installation
 * shape uniform (ADR-020's "same four-part shape" requirement).
 */
function buildConfigType(manifest: ModuleManifest): SchemaTypeDefinition {
  const fields = manifest.platformContract.configSchema.map(buildModuleConfigField)

  return defineType({
    name: moduleConfigTypeName(manifest),
    title: `${manifest.label} — Configuration`,
    type: 'object',
    fields:
      fields.length > 0
        ? fields
        : [
            defineField({
              name: 'unconfigured',
              title: 'Unconfigured',
              type: 'boolean',
              hidden: true,
              description: 'Placeholder — this module declares no per-site configuration.',
            }),
          ],
  })
}

/**
 * `${camelId}ModuleInstallation` — the per-project installation member type.
 *
 * Field-for-field the same shape the hand-written anonymous array member had
 * (moduleId / version / enabled / installedAt / provenance) plus the generated
 * `config`. moduleId is hidden and read-only with the manifest id as its
 * initialValue — the array member "knows what it is" without an admin setting
 * it, matching how integrationId behaves on the integrations side.
 */
function buildInstallationType(manifest: ModuleManifest): SchemaTypeDefinition {
  return defineType({
    name: moduleInstallationTypeName(manifest),
    title: `${manifest.label} — Installation`,
    type: 'object',
    fields: [
      defineField({
        name: 'moduleId',
        title: 'Module ID',
        type: 'string',
        readOnly: true,
        hidden: true,
        initialValue: manifest.id,
      }),
      defineField({ name: 'version', title: 'Version', type: 'string' }),
      defineField({ name: 'enabled', title: 'Enabled', type: 'boolean', initialValue: true }),
      defineField({ name: 'installedAt', title: 'Installed At', type: 'string' }),
      defineField({ name: 'provenance', title: 'Provenance', type: 'string' }),
      defineField({
        name: 'config',
        title: 'Configuration',
        type: moduleConfigTypeName(manifest),
      }),
    ],
    preview: {
      select: { version: 'version', enabled: 'enabled' },
      prepare: ({ version, enabled }: { version?: string; enabled?: boolean }) => ({
        title: manifest.label,
        subtitle: `${enabled === false ? 'Disabled' : 'Enabled'}${version ? ` · v${version}` : ''}`,
      }),
    },
  })
}

// ── Public generators ──────────────────────────────────────────────────────────

/**
 * Generates every config type and installation type for every manifest in
 * MODULE_REGISTRY. Spliced into the platform schema by src/lib/sanity/schema.ts
 * alongside buildSchema()'s module-owned document types and
 * buildIntegrationSchemaTypes()'s integration types.
 */
export function buildModuleConfigSchemaTypes(): SchemaTypeDefinition[] {
  const types: SchemaTypeDefinition[] = []
  for (const manifest of MODULE_REGISTRY) {
    types.push(buildConfigType(manifest))
    types.push(buildInstallationType(manifest))
  }
  return types
}

/**
 * The `moduleInstallations` array field definition for the project document.
 * One array member type per manifest — a union of shapes, not one shared shape,
 * because each module's `config` sub-object is generated differently.
 *
 * Replaces the hand-written anonymous-object array that shipped in ADR-011
 * Phase B1 (which had no `config` field at all, so config was unrepresentable
 * in the Studio).
 *
 * Hidden from the raw project form — this array is managed by the Modules pane
 * (ADR-020 Decision 1), the same way integrationConfigs is managed by the
 * Integrations pane.
 */
export function buildModuleInstallationsField() {
  return defineField({
    name: 'moduleInstallations',
    title: 'Module Installations',
    type: 'array',
    description:
      'Platform-managed. One entry per module installed on this website, carrying status, version, install date, provenance, and module-owned configuration. Managed via the Modules pane — not this raw array form.',
    of: MODULE_REGISTRY.map((manifest) =>
      defineArrayMember({ type: moduleInstallationTypeName(manifest) })
    ),
    hidden: true,
  })
}
