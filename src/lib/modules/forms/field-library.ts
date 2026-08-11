/**
 * Form Field Library — manifest-style declaration (ADR-018 slice 2).
 *
 * This is the single declarative source the `formDefinition` Sanity schema is
 * GENERATED from (see ./schema.ts, `buildFormFieldMember()`), mirroring the
 * Integration Registry precedent (`buildIntegrationSchemaTypes()`): declare the
 * field library once, derive the Studio surface — never hand-duplicate.
 *
 * Lockstep contract
 * ─────────────────────────────────────────────────────────────────────────────
 * `FORM_FIELD_TYPES` MUST stay in lockstep with the runtime Field Library's
 * `FieldType` union in `src/components/fields/types.ts` (the 16 leaf field
 * components). The generated `type` enum in the Studio comes straight from this
 * array, and a unit test (./__tests__/forms-schema.test.ts) fails the build if
 * the two drift. Add a field type in exactly two places: the `FieldType` union
 * (runtime components) and this array (authoring surface).
 *
 * Slice boundary
 * ─────────────────────────────────────────────────────────────────────────────
 * This slice is additive and inert — no route resolves a `formDefinition` yet.
 * Slice 3 maps a published `formDefinition` document onto the runtime
 * `FormDefinition` contract (`src/lib/forms/definitions.ts`): a field's
 * `internalKey` → runtime `key`, `type` → `type`, `required` → `required`,
 * choice `options[].value` → runtime `options: string[]`, and `validationPreset`
 * → runtime `validate` ('email' | 'url'). The stable internal key is
 * locale-independent; only the visible label/placeholder/help/option labels are
 * localized (ADR-018 §8).
 */

// ── Extra-field keys (per-type authoring extras) ──────────────────────────────
// Each key here is generated once as a conditionally-shown field on the shared
// `formDefinitionField` object; it is visible only for the field types that
// declare it in FORM_FIELD_TYPES.extras. Keeping the set closed makes the
// generator total (no silent misrender of an unknown extra).
export type FormFieldExtra =
  | 'placeholder'        // localized placeholder — input-like types
  | 'validationPreset'   // none | email | url — text-family format check
  | 'minLength'          // number — text, textarea
  | 'maxLength'          // number — text, textarea
  | 'rows'               // number — textarea
  | 'min'                // number — number
  | 'max'                // number — number
  | 'step'               // number — number
  | 'maxSelections'      // number — multi-select, checkbox-group
  | 'maxRating'          // number — rating
  | 'multiple'           // boolean — file
  | 'acceptedTypes'      // string[] — file
  | 'prioritizeCountries'// string[] (ISO alpha-2) — country-select
  | 'hiddenValue'        // string — hidden

/**
 * One entry per runtime FieldType. `value` is the exact runtime `FieldType`
 * string (lockstep key). `hasOptions` marks the choice types that carry an
 * editable localized `options[]` list. `extras` names the per-type authoring
 * fields the generator conditionally reveals.
 */
export interface FormFieldTypeDef {
  value: string
  title: string
  group: 'text' | 'choice' | 'advanced'
  hasOptions: boolean
  extras: FormFieldExtra[]
}

export const FORM_FIELD_TYPES: FormFieldTypeDef[] = [
  // ── Text family ─────────────────────────────────────────────────────────────
  { value: 'text',           title: 'Text',            group: 'text',     hasOptions: false, extras: ['placeholder', 'validationPreset', 'minLength', 'maxLength'] },
  { value: 'textarea',       title: 'Text Area',       group: 'text',     hasOptions: false, extras: ['placeholder', 'rows', 'minLength', 'maxLength'] },
  { value: 'number',         title: 'Number',          group: 'text',     hasOptions: false, extras: ['placeholder', 'min', 'max', 'step'] },
  { value: 'email',          title: 'Email',           group: 'text',     hasOptions: false, extras: ['placeholder'] },
  { value: 'phone',          title: 'Phone',           group: 'text',     hasOptions: false, extras: ['placeholder'] },
  { value: 'url',            title: 'URL',             group: 'text',     hasOptions: false, extras: ['placeholder'] },
  // ── Choice family ───────────────────────────────────────────────────────────
  { value: 'select',         title: 'Dropdown',        group: 'choice',   hasOptions: true,  extras: ['placeholder'] },
  { value: 'multi-select',   title: 'Multi-select',    group: 'choice',   hasOptions: true,  extras: ['maxSelections'] },
  { value: 'radio-group',    title: 'Radio Group',     group: 'choice',   hasOptions: true,  extras: [] },
  { value: 'checkbox',       title: 'Checkbox',        group: 'choice',   hasOptions: false, extras: [] },
  { value: 'checkbox-group', title: 'Checkbox Group',  group: 'choice',   hasOptions: true,  extras: ['maxSelections'] },
  { value: 'country-select', title: 'Country Select',  group: 'choice',   hasOptions: false, extras: ['placeholder', 'prioritizeCountries'] },
  // ── Advanced ────────────────────────────────────────────────────────────────
  { value: 'date',           title: 'Date',            group: 'advanced', hasOptions: false, extras: [] },
  { value: 'file',           title: 'File Upload',     group: 'advanced', hasOptions: false, extras: ['multiple', 'acceptedTypes'] },
  { value: 'hidden',         title: 'Hidden',          group: 'advanced', hasOptions: false, extras: ['hiddenValue'] },
  { value: 'rating',         title: 'Rating',          group: 'advanced', hasOptions: false, extras: ['maxRating'] },
]

/** Runtime FieldType values, in declaration order — the lockstep key set. */
export const FORM_FIELD_TYPE_VALUES: string[] = FORM_FIELD_TYPES.map((f) => f.value)

/** Field types that carry an editable localized `options[]` list. */
export const CHOICE_FIELD_TYPES: string[] = FORM_FIELD_TYPES.filter((f) => f.hasOptions).map((f) => f.value)

/** The set of field-type values that declare a given authoring extra. */
export function typesWithExtra(extra: FormFieldExtra): string[] {
  return FORM_FIELD_TYPES.filter((f) => f.extras.includes(extra)).map((f) => f.value)
}
