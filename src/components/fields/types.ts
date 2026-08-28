/**
 * Field Config Type System — Abluo Form Field Library
 *
 * Defines the discriminated union of all field configs, shared base config,
 * validation rules, and reserved hooks for future conditional visibility.
 *
 * Architecture notes:
 * - All field components are driven by these types — schema and components stay in sync.
 * - `VisibilityCondition` is reserved but not implemented. When conditional logic
 *   lands, un-comment the type, add `visibility?` to BaseFieldConfig, and implement
 *   `useConditionalVisibility(fields, values)` in a new hook file.
 * - `FieldConfig` is the discriminated union — use it as the general field type.
 *   Use specific types (TextFieldConfig etc.) only in leaf components.
 */

// ─── Option Item ────────────────────────────────────────────────────────────

export interface OptionItem {
  value: string
  label: string
  /** Optional supporting line rendered under the label (cards, radios, checkboxes). */
  description?: string
  disabled?: boolean
}

// ─── Validation Rules ────────────────────────────────────────────────────────

export type ValidationRule =
  | { type: 'required'; message?: string }
  | { type: 'minLength'; value: number; message?: string }
  | { type: 'maxLength'; value: number; message?: string }
  | { type: 'min'; value: number; message?: string }
  | { type: 'max'; value: number; message?: string }
  | { type: 'pattern'; regex: string; message?: string }
  | { type: 'email'; message?: string }
  | { type: 'url'; message?: string }
  | { type: 'phone'; message?: string }
  | { type: 'fileSize'; maxMb: number; message?: string }
  | { type: 'fileType'; accept: string[]; message?: string }

// ─── Reserved: Conditional Visibility (NOT YET IMPLEMENTED) ─────────────────
//
// When conditional logic is added:
// 1. Un-comment VisibilityCondition below
// 2. Add `visibility?: VisibilityCondition` to BaseFieldConfig
// 3. Add `useConditionalVisibility(fields, values)` hook
// 4. Pass visible={} to FieldWrapper from FormField
//
// export type VisibilityOperator =
//   | 'equals' | 'notEquals' | 'contains' | 'notContains'
//   | 'startsWith' | 'isEmpty' | 'isNotEmpty' | 'greaterThan' | 'lessThan'
//
// export interface VisibilityCondition {
//   fieldId: string
//   operator: VisibilityOperator
//   value?: unknown
//   logic?: 'and' | 'or'
//   conditions?: VisibilityCondition[]
// }

// ─── Field Types ─────────────────────────────────────────────────────────────

export type FieldType =
  // Text family
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'url'
  // Choice family
  | 'select'
  | 'multi-select'
  | 'radio-group'
  | 'checkbox'
  | 'checkbox-group'
  | 'country-select'
  // Advanced
  | 'date'
  | 'file'
  | 'hidden'
  | 'rating'

// ─── Base Config ─────────────────────────────────────────────────────────────

export interface BaseFieldConfig {
  /** Unique key within the form — used as HTML id and form value key */
  id: string
  type: FieldType
  /** Human-readable label displayed above the field */
  label: string
  /** Hint text shown below the label, before the input */
  helpText?: string
  placeholder?: string
  required?: boolean
  defaultValue?: unknown
  disabled?: boolean
  readOnly?: boolean
  /**
   * Width within the form grid.
   * '100%' = full row, '50%' = half row (two fields side-by-side).
   * Form grid handles the layout; individual field components are unaware.
   */
  width?: '50%' | '100%'
  validation?: ValidationRule[]
  // visibility?: VisibilityCondition  ← reserved
}

// ─── Text-family Configs ─────────────────────────────────────────────────────

export interface TextFieldConfig extends BaseFieldConfig {
  type: 'text'
  /**
   * inputType drives the HTML <input type> attribute.
   * Use 'password' for password fields — NOT a separate field type.
   * Use 'search' for search-style inputs.
   */
  inputType?: 'text' | 'password' | 'search'
  minLength?: number
  maxLength?: number
  pattern?: string
  autoComplete?: string
}

export interface TextareaFieldConfig extends BaseFieldConfig {
  type: 'textarea'
  rows?: number
  minLength?: number
  maxLength?: number
  autoResize?: boolean
}

export interface NumberFieldConfig extends BaseFieldConfig {
  type: 'number'
  min?: number
  max?: number
  step?: number
  /** Optional unit label shown after the input — e.g. "kg", "€" */
  unit?: string
}

export interface EmailFieldConfig extends BaseFieldConfig {
  type: 'email'
  maxLength?: number
  autoComplete?: string
}

export interface PhoneFieldConfig extends BaseFieldConfig {
  type: 'phone'
  maxLength?: number
  autoComplete?: string
}

export interface UrlFieldConfig extends BaseFieldConfig {
  type: 'url'
  maxLength?: number
}

// ─── Choice-family Configs ───────────────────────────────────────────────────

export interface SelectFieldConfig extends BaseFieldConfig {
  type: 'select'
  options: OptionItem[]
  /** Placeholder option label — e.g. "Choose one…" */
  emptyOption?: string
}

export interface MultiSelectFieldConfig extends BaseFieldConfig {
  type: 'multi-select'
  options: OptionItem[]
  maxSelections?: number
}

export interface RadioGroupFieldConfig extends BaseFieldConfig {
  type: 'radio-group'
  options: OptionItem[]
  layout?: 'vertical' | 'horizontal'
  /** Visual presentation: 'list' (radios, default) or 'cards' (selectable card grid). */
  display?: 'list' | 'cards'
}

export interface CheckboxFieldConfig extends BaseFieldConfig {
  type: 'checkbox'
  /** Label text rendered inline next to the checkbox itself (distinct from field label) */
  checkboxLabel?: string
}

export interface CheckboxGroupFieldConfig extends BaseFieldConfig {
  type: 'checkbox-group'
  options: OptionItem[]
  minSelections?: number
  maxSelections?: number
  layout?: 'vertical' | 'horizontal'
  /** Visual presentation: 'list' (checkboxes, default), 'chips', or 'cards'. */
  display?: 'list' | 'chips' | 'cards'
}

/** Country select renders a <select> pre-populated with ISO 3166-1 country list */
export interface CountrySelectFieldConfig extends BaseFieldConfig {
  type: 'country-select'
  /** Placeholder option label — e.g. "Select country…" */
  emptyOption?: string
  /** ISO 3166-1 alpha-2 codes to show first in the list (e.g. ['IT', 'DE', 'FR']) */
  prioritize?: string[]
}

// ─── Advanced Configs ────────────────────────────────────────────────────────

export interface DateFieldConfig extends BaseFieldConfig {
  type: 'date'
  /** ISO date string (YYYY-MM-DD) */
  minDate?: string
  /** ISO date string (YYYY-MM-DD) */
  maxDate?: string
}

export interface FileFieldConfig extends BaseFieldConfig {
  type: 'file'
  /** MIME types or extensions — e.g. ['image/*', '.pdf'] */
  acceptedTypes?: string[]
  maxSizeMb?: number
  multiple?: boolean
  // NOTE: Actual upload/storage logic is NOT implemented in this phase.
  // Wire the onUpload callback or integrate with a storage provider in a later phase.
  // The component exposes `onFilesSelected` for future integration.
}

export interface HiddenFieldConfig extends BaseFieldConfig {
  type: 'hidden'
  /** Static value injected into the form payload — not shown to the user */
  value: string
}

export interface RatingFieldConfig extends BaseFieldConfig {
  type: 'rating'
  /** Maximum rating value — defaults to 5 */
  maxRating?: number
  /** Visual icon style — only 'star' is implemented in this phase */
  icon?: 'star' | 'heart' | 'circle'
  /** Allow clearing the rating by clicking the active value again */
  allowClear?: boolean
}

// ─── Discriminated Union ─────────────────────────────────────────────────────

export type FieldConfig =
  | TextFieldConfig
  | TextareaFieldConfig
  | NumberFieldConfig
  | EmailFieldConfig
  | PhoneFieldConfig
  | UrlFieldConfig
  | SelectFieldConfig
  | MultiSelectFieldConfig
  | RadioGroupFieldConfig
  | CheckboxFieldConfig
  | CheckboxGroupFieldConfig
  | CountrySelectFieldConfig
  | DateFieldConfig
  | FileFieldConfig
  | HiddenFieldConfig
  | RatingFieldConfig

// ─── Shared Component Props ──────────────────────────────────────────────────

/**
 * Props passed to every leaf field component.
 * Components must not import designSystem directly — all styling goes
 * through CSS variables emitted by buildCssVars() in the website layout.
 */
export interface FieldComponentProps {
  config: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  /** Resolved validation error for this field — shown by FieldWrapper */
  error?: string
  disabled?: boolean
}

// ─── Validation result ───────────────────────────────────────────────────────

export interface FieldValidationResult {
  valid: boolean
  error: string | null
}
