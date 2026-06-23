/**
 * Form Field Library — Public API
 *
 * Only import from here. Never import individual leaf components directly.
 */

// ─── Dispatcher ───────────────────────────────────────────────────────────────
export { FormField } from './FormField'

// ─── Wrapper (for custom layouts) ─────────────────────────────────────────────
export { FieldWrapper } from './FieldWrapper'
export type { FieldWrapperProps } from './FieldWrapper'

// ─── Validation ───────────────────────────────────────────────────────────────
export { validateField, validateForm, useFieldValidation } from './useFieldValidation'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  FieldType,
  FieldConfig,
  FieldComponentProps,
  FieldValidationResult,
  ValidationRule,
  OptionItem,

  // Individual config types (for consumers building field arrays)
  BaseFieldConfig,
  TextFieldConfig,
  TextareaFieldConfig,
  NumberFieldConfig,
  EmailFieldConfig,
  PhoneFieldConfig,
  UrlFieldConfig,
  SelectFieldConfig,
  MultiSelectFieldConfig,
  RadioGroupFieldConfig,
  CheckboxFieldConfig,
  CheckboxGroupFieldConfig,
  CountrySelectFieldConfig,
  DateFieldConfig,
  FileFieldConfig,
  HiddenFieldConfig,
  RatingFieldConfig,
} from './types'
