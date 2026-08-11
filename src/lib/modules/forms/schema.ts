import { defineType, defineField, defineArrayMember } from 'sanity'
import type { SchemaTypeDefinition } from 'sanity'
import {
  FORM_FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  typesWithExtra,
  type FormFieldExtra,
} from './field-library'

// ── Forms module — Sanity schema types (ADR-018 slice 2) ──────────────────────
//
// Owned by: forms module (MODULE_REGISTRY id: 'forms')
// Platform contract: 1 document type
//   formDefinition — TENANT-OWNED definition document (the reusable "what the
//                    form is": fields, steps, validations, localized copy,
//                    privacy, notification topic). Additive + inert this slice:
//                    no route resolves it yet (slice 3 does).
//
// Deliberate exception to Architectural Principle #1 (ADR-018): a formDefinition
// is TENANT-owned, keyed by `tenantSlug` + `role`, NOT `projectSlug`-scoped, so
// one definition is reusable across a tenant's projects by reference. Submissions
// stay fully project-scoped (form_submissions.project_id), so no isolation is
// weakened. The legacy project-scoped `form` type (src/lib/sanity/schema.ts)
// and `formSection` are intentionally left untouched — slice 4 rewires the
// section to `formDefinition` and a planned migration retires the legacy type.
//
// The field object is GENERATED from the manifest-style FORM_FIELD_TYPES
// declaration (./field-library.ts), mirroring buildIntegrationSchemaTypes() —
// the Studio `type` enum stays in lockstep with the runtime Field Library's
// FieldType union by construction, enforced by ./__tests__/forms-schema.test.ts.
//
// Runtime mapping (slice 3, src/lib/forms/definitions.ts → FormDefinition):
//   formId → def.formId · version → def.version · notificationTopic (default
//   formId) → def.notificationTopic · privacy.requireConsent →
//   def.requiresConsentAtFinalStep · steps[].key → step.key ·
//   field.internalKey → field.key · field.type → field.type ·
//   field.required → field.required · choice field.options[].value →
//   field.options[] · field.validationPreset → field.validate.

const ROLE_LIST = [
  { title: 'Active (tenant-owned)', value: 'active' },
  { title: 'Template (platform)', value: 'template' },
]

const FORM_TYPE_LIST = [
  { title: 'Single step', value: 'single-step' },
  { title: 'Multi step', value: 'multi-step' },
  { title: 'Question & answer', value: 'question-answer' },
]

const VALIDATION_PRESET_LIST = [
  { title: 'None', value: 'none' },
  { title: 'Email', value: 'email' },
  { title: 'URL', value: 'url' },
]

// ── Localized option list (choice-type fields) ────────────────────────────────
// { value } is the stable, locale-independent key stored on the submission;
// { label } is the localized visible text (ADR-018 §8).
const formFieldOptionMember = defineArrayMember({
  type: 'object',
  name: 'formFieldOption',
  fields: [
    defineField({
      name: 'value',
      title: 'Value (internal, stable)',
      type: 'string',
      description: 'Locale-independent key stored on the submission — e.g. "implantology". Never translated.',
      validation: (Rule) => Rule.required().regex(/^[a-z0-9][a-z0-9_-]*$/, { name: 'option-value' }).error('Lowercase letters, digits, "-" and "_" only.'),
    }),
    defineField({ name: 'label', title: 'Label', type: 'localizedString', validation: (Rule) => Rule.required() }),
  ],
  preview: {
    select: { value: 'value', label: 'label.en' },
    prepare: ({ value, label }: { value?: string; label?: string }) => ({ title: label ?? value ?? '—', subtitle: value }),
  },
})

// ── Per-type authoring extras (generated, conditionally shown) ─────────────────
// Each extra is emitted once on the shared field object and revealed only for
// the field types that declare it in FORM_FIELD_TYPES.extras. Keeping this a
// closed switch keeps the generator total — an unknown extra throws at build
// rather than silently rendering nothing.
function hiddenUnless(types: string[]) {
  return ({ parent }: { parent?: { type?: string } }) => !types.includes(parent?.type ?? '')
}

function buildExtraField(extra: FormFieldExtra) {
  const only = typesWithExtra(extra)
  const hidden = hiddenUnless(only)
  switch (extra) {
    case 'placeholder':
      return defineField({ name: 'placeholder', title: 'Placeholder', type: 'localizedString', hidden })
    case 'validationPreset':
      return defineField({
        name: 'validationPreset',
        title: 'Format Validation',
        type: 'string',
        options: { list: VALIDATION_PRESET_LIST, layout: 'radio' },
        initialValue: 'none',
        description: 'Extra format check applied when a value is present.',
        hidden,
      })
    case 'minLength':
      return defineField({ name: 'minLength', title: 'Min Length', type: 'number', validation: (Rule) => Rule.min(0).integer(), hidden })
    case 'maxLength':
      return defineField({ name: 'maxLength', title: 'Max Length', type: 'number', validation: (Rule) => Rule.min(1).integer(), hidden })
    case 'rows':
      return defineField({ name: 'rows', title: 'Rows', type: 'number', initialValue: 4, validation: (Rule) => Rule.min(1).integer(), hidden })
    case 'min':
      return defineField({ name: 'min', title: 'Min', type: 'number', hidden })
    case 'max':
      return defineField({ name: 'max', title: 'Max', type: 'number', hidden })
    case 'step':
      return defineField({ name: 'step', title: 'Step', type: 'number', hidden })
    case 'maxSelections':
      return defineField({ name: 'maxSelections', title: 'Max Selections', type: 'number', validation: (Rule) => Rule.min(1).integer(), hidden })
    case 'maxRating':
      return defineField({ name: 'maxRating', title: 'Max Rating', type: 'number', initialValue: 5, validation: (Rule) => Rule.min(1).max(10).integer(), hidden })
    case 'multiple':
      return defineField({ name: 'multiple', title: 'Allow Multiple Files', type: 'boolean', initialValue: false, hidden })
    case 'acceptedTypes':
      return defineField({ name: 'acceptedTypes', title: 'Accepted File Types', type: 'array', of: [defineArrayMember({ type: 'string' })], description: 'MIME types or extensions — e.g. "image/*", ".pdf".', hidden })
    case 'prioritizeCountries':
      return defineField({ name: 'prioritizeCountries', title: 'Prioritized Countries', type: 'array', of: [defineArrayMember({ type: 'string' })], description: 'ISO 3166-1 alpha-2 codes to show first — e.g. "IT", "DE".', hidden })
    case 'hiddenValue':
      return defineField({ name: 'hiddenValue', title: 'Static Value', type: 'string', description: 'Injected into the payload; never shown to the visitor.', hidden })
    default: {
      // Exhaustiveness guard — a new FormFieldExtra without a branch fails the build.
      const _never: never = extra
      throw new Error(`Unhandled form field extra: ${String(_never)}`)
    }
  }
}

// Union of every extra declared by any field type, generated once.
const ALL_EXTRAS: FormFieldExtra[] = Array.from(
  new Set(FORM_FIELD_TYPES.flatMap((f) => f.extras)),
)

// ── Generated field object ────────────────────────────────────────────────────
const formDefinitionFieldMember = defineArrayMember({
  type: 'object',
  name: 'formDefinitionField',
  fields: [
    defineField({
      name: 'internalKey',
      title: 'Internal Key (stable)',
      type: 'string',
      description: 'Locale-independent key stored on the submission — e.g. "email", "preferred_date", "privacy_consent". Never translated.',
      validation: (Rule) => Rule.required().regex(/^[a-z0-9][a-z0-9_-]*$/, { name: 'internal-key' }).error('Lowercase letters, digits, "-" and "_" only.'),
    }),
    defineField({
      name: 'type',
      title: 'Field Type',
      type: 'string',
      // Enum generated from the Field Library — lockstep with FieldType.
      options: { list: FORM_FIELD_TYPES.map((f) => ({ title: `${f.title}`, value: f.value })) },
      initialValue: 'text',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'label', title: 'Label', type: 'localizedString', description: 'Visible label above the field.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'help', title: 'Help Text', type: 'localizedString', description: 'Optional hint shown below the label.' }),
    defineField({ name: 'required', title: 'Required', type: 'boolean', initialValue: false }),
    defineField({
      name: 'contextMappable',
      title: 'Context-mappable',
      type: 'boolean',
      initialValue: false,
      description: 'If on, a placement’s Context (e.g. treatment, campaign) may pre-populate this field. Never applies to identity or privileged values (ADR-018 §7/§18).',
    }),
    defineField({
      name: 'options',
      title: 'Options',
      type: 'array',
      of: [formFieldOptionMember],
      description: 'Choices for dropdown / multi-select / radio / checkbox-group fields.',
      hidden: hiddenUnless(CHOICE_FIELD_TYPES),
    }),
    defineField({ name: 'width', title: 'Width', type: 'string', options: { list: [{ title: 'Full row', value: '100%' }, { title: 'Half row', value: '50%' }], layout: 'radio' }, initialValue: '100%' }),
    // Generated per-type extras (conditionally shown by field type).
    ...ALL_EXTRAS.map(buildExtraField),
  ],
  preview: {
    select: { key: 'internalKey', type: 'type', label: 'label.en', required: 'required' },
    prepare: ({ key, type, label, required }: { key?: string; type?: string; label?: string; required?: boolean }) => ({
      title: label ?? key ?? 'Field',
      subtitle: `${type ?? '?'} · ${key ?? ''}${required ? ' · required' : ''}`,
    }),
  },
})

// ── Step object ───────────────────────────────────────────────────────────────
const formStepMember = defineArrayMember({
  type: 'object',
  name: 'formStep',
  fields: [
    defineField({
      name: 'key',
      title: 'Step Key (stable)',
      type: 'string',
      description: 'Locale-independent step key — e.g. "contact", "details".',
      validation: (Rule) => Rule.required().regex(/^[a-z0-9][a-z0-9_-]*$/, { name: 'step-key' }).error('Lowercase letters, digits, "-" and "_" only.'),
    }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
    defineField({
      name: 'fields',
      title: 'Fields',
      type: 'array',
      of: [formDefinitionFieldMember],
      validation: (Rule) => Rule.min(1).error('A step must have at least one field.'),
    }),
  ],
  preview: {
    select: { key: 'key', title: 'title.en', fields: 'fields' },
    prepare: ({ key, title, fields }: { key?: string; title?: string; fields?: unknown[] }) => ({
      title: title ?? key ?? 'Step',
      subtitle: `${key ?? '—'} · ${(fields?.length ?? 0)} field${(fields?.length ?? 0) === 1 ? '' : 's'}`,
    }),
  },
})

// ── formDefinition document ───────────────────────────────────────────────────
const formDefinitionType = defineType({
  name: 'formDefinition',
  title: 'Form Definition',
  type: 'document',
  groups: [
    { name: 'identity', title: 'Identity', default: true },
    { name: 'steps', title: 'Steps & Fields' },
    { name: 'privacy', title: 'Privacy' },
    { name: 'success', title: 'Success' },
    { name: 'ownership', title: 'Ownership' },
  ],
  fields: [
    // ── Identity ──────────────────────────────────────────────────────────────
    defineField({
      name: 'formId',
      title: 'Form ID (stable route key)',
      type: 'string',
      group: 'identity',
      description: 'Stable, locale-independent machine key used in the submission route — e.g. "early-access", "appointment-request". Never change once live.',
      validation: (Rule) => Rule.required().regex(/^[a-z0-9][a-z0-9-]*$/, { name: 'form-id' }).error('Lowercase letters, digits, and "-" only.'),
    }),
    defineField({ name: 'internalName', title: 'Internal Name', type: 'string', group: 'identity', description: 'Admin-facing name — not shown on the website.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'identity', description: 'Visitor-facing form title.' }),
    defineField({
      name: 'formType',
      title: 'Form Type',
      type: 'string',
      group: 'identity',
      options: { list: FORM_TYPE_LIST, layout: 'radio' },
      initialValue: 'single-step',
    }),
    defineField({
      name: 'version',
      title: 'Version',
      type: 'number',
      group: 'identity',
      initialValue: 1,
      description: 'Monotonic integer, pinned onto each submission at creation (ADR-018 Decision 4). Bump mechanism arrives in slice 7 — do not decrement.',
      validation: (Rule) => Rule.required().min(1).integer(),
    }),
    defineField({
      name: 'notificationTopic',
      title: 'Notification Topic',
      type: 'string',
      group: 'identity',
      description: 'Abstract, provider-agnostic routing tag carried on the emitted event (ADR-018 Decision 9). Not recipients or channels. Leave empty to default to the Form ID.',
      validation: (Rule) => Rule.regex(/^[a-z0-9][a-z0-9-]*$/, { name: 'topic' }).error('Lowercase letters, digits, and "-" only.'),
    }),

    // ── Steps & Fields ────────────────────────────────────────────────────────
    defineField({
      name: 'steps',
      title: 'Steps',
      type: 'array',
      group: 'steps',
      of: [formStepMember],
      description: 'A single-step form is one step. Step count is data — never hard-coded (ADR-018 §4).',
      validation: (Rule) => Rule.min(1).error('A form must have at least one step.'),
    }),

    // ── Privacy ───────────────────────────────────────────────────────────────
    defineField({
      name: 'privacy',
      title: 'Privacy',
      type: 'object',
      group: 'privacy',
      fields: [
        defineField({ name: 'requireConsent', title: 'Require Consent', type: 'boolean', initialValue: false, description: 'When on, the final step requires GDPR consent; consent is stored on the submission as a top-level flag, not a data field.' }),
        defineField({ name: 'consentText', title: 'Consent Text', type: 'localizedText', description: 'Short consent copy shown beside the checkbox.', hidden: ({ parent }: { parent?: { requireConsent?: boolean } }) => !parent?.requireConsent }),
        defineField({ name: 'policyUrl', title: 'Privacy Policy URL', type: 'string', description: 'Optional link to the privacy policy.' }),
      ],
    }),

    // ── Success ───────────────────────────────────────────────────────────────
    defineField({
      name: 'success',
      title: 'Success',
      type: 'object',
      group: 'success',
      fields: [
        defineField({ name: 'title', title: 'Success Title', type: 'localizedString' }),
        defineField({ name: 'body', title: 'Success Body', type: 'localizedText' }),
      ],
    }),

    // ── Ownership (Principle-#1 exception: tenant-owned, not projectSlug) ──────
    defineField({
      name: 'role',
      title: 'Role',
      type: 'string',
      group: 'ownership',
      options: { list: ROLE_LIST, layout: 'radio' },
      initialValue: 'active',
      description: 'Active = tenant-owned. Template = platform-owned starting library (no tenant), analogous to designSystem.role.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tenantSlug',
      title: 'Tenant Slug',
      type: 'string',
      group: 'ownership',
      description: 'Owning tenant key. Required for Active forms; leave empty for platform Templates.',
      hidden: ({ parent }: { parent?: { role?: string } }) => parent?.role === 'template',
      validation: (Rule) =>
        Rule.custom((value, context) => {
          const parent = context.parent as { role?: string }
          if (parent?.role === 'active' && (!value || String(value).trim() === '')) {
            return 'Active forms must have a tenant slug.'
          }
          return true
        }),
    }),
  ],
  preview: {
    select: { name: 'internalName', formId: 'formId', role: 'role', tenant: 'tenantSlug', version: 'version' },
    prepare: ({ name, formId, role, tenant, version }: { name?: string; formId?: string; role?: string; tenant?: string; version?: number }) => ({
      title: name ?? formId ?? 'Form Definition',
      subtitle: `${role === 'template' ? 'template' : (tenant ?? 'no tenant')} · ${formId ?? '—'} · v${version ?? 1}`,
    }),
  },
})

// ── Exports ───────────────────────────────────────────────────────────────────

export const formsSchemaTypes: SchemaTypeDefinition[] = [formDefinitionType]
