/**
 * Field Validation — Abluo Form Field Library
 *
 * Pure validation utilities — no React state, no side effects.
 * Exported as functions so they can be called from:
 *   - Individual field components (onBlur)
 *   - A future form-level state manager (on submit)
 *   - Server-side validation utilities
 *
 * All user-facing fallback messages are resolved via `getValidationMessages(locale)`
 * so no English text is hardcoded here. Pass `locale` (or a pre-resolved
 * `ValidationMessages` object) to get the correct language.
 */

import type { FieldConfig, ValidationRule, FieldValidationResult } from './types'
import {
  getValidationMessages,
  defaultValidationMessages,
  type ValidationMessages,
} from '@/lib/forms/validation-messages'

// ─── Single rule evaluator ────────────────────────────────────────────────────

function evaluateRule(
  rule: ValidationRule,
  value: unknown,
  m: ValidationMessages,
): string | null {
  const str = typeof value === 'string' ? value : String(value ?? '')
  const num = typeof value === 'number' ? value : Number(value)

  switch (rule.type) {
    case 'required': {
      if (value === null || value === undefined)                          return rule.message ?? m.required
      if (typeof value === 'string' && value.trim() === '')              return rule.message ?? m.required
      if (Array.isArray(value) && value.length === 0)                   return rule.message ?? m.requiredSelection
      if (typeof value === 'boolean' && value === false)                 return rule.message ?? m.required
      return null
    }

    case 'minLength':
      return str.length < rule.value
        ? rule.message ?? m.minLength(rule.value)
        : null

    case 'maxLength':
      return str.length > rule.value
        ? rule.message ?? m.maxLength(rule.value)
        : null

    case 'min':
      return isNaN(num) || num < rule.value
        ? rule.message ?? m.minValue(rule.value)
        : null

    case 'max':
      return isNaN(num) || num > rule.value
        ? rule.message ?? m.maxValue(rule.value)
        : null

    case 'email': {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return str && !emailRe.test(str) ? rule.message ?? m.invalidEmail : null
    }

    case 'url': {
      try {
        if (str) new URL(str.startsWith('http') ? str : `https://${str}`)
        return null
      } catch {
        return rule.message ?? m.invalidUrl
      }
    }

    case 'phone': {
      // E.164-ish: optional leading +, 7–15 digits (tolerates spaces and hyphens)
      const phoneRe = /^\+?[\d\s\-().]{7,20}$/
      return str && !phoneRe.test(str) ? rule.message ?? m.invalidPhone : null
    }

    case 'pattern': {
      try {
        const re = new RegExp(rule.regex)
        return str && !re.test(str) ? rule.message ?? m.invalidFormat : null
      } catch {
        return null // malformed regex — skip rule
      }
    }

    case 'fileSize': {
      // value is FileList or File[] — check each file
      const files = value instanceof FileList
        ? Array.from(value)
        : Array.isArray(value)
          ? value as File[]
          : []
      const maxBytes = rule.maxMb * 1024 * 1024
      const oversized = files.find((f) => f.size > maxBytes)
      return oversized
        ? rule.message ?? m.fileTooLarge(oversized.name, rule.maxMb)
        : null
    }

    case 'fileType': {
      const files = value instanceof FileList
        ? Array.from(value)
        : Array.isArray(value)
          ? value as File[]
          : []
      const accept = rule.accept.map((a) => a.toLowerCase())
      const invalid = files.find((f) => {
        const ext = '.' + f.name.split('.').pop()?.toLowerCase()
        const mime = f.type.toLowerCase()
        return !accept.some((a) =>
          a.endsWith('/*') ? mime.startsWith(a.replace('/*', '/')) : a === ext || a === mime
        )
      })
      return invalid
        ? rule.message ?? m.invalidFileType(invalid.name)
        : null
    }

    default:
      return null
  }
}

// ─── Field-level validator ────────────────────────────────────────────────────

/**
 * Validate a single field value against all of its configured validation rules.
 *
 * @param config  - Field configuration (includes `required` flag and `validation` rules)
 * @param value   - Current field value
 * @param locale  - BCP 47 locale string (e.g. 'en', 'it'). Defaults to 'en'.
 *                  Alternatively, pass a pre-resolved `ValidationMessages` object.
 */
export function validateField(
  config: FieldConfig,
  value: unknown,
  locale: string | ValidationMessages = 'en',
): FieldValidationResult {
  const m: ValidationMessages =
    typeof locale === 'string' ? getValidationMessages(locale) : locale

  // Built-in required check (handles the field's own `required` flag)
  if (config.required) {
    const err = evaluateRule({ type: 'required' }, value, m)
    if (err) return { valid: false, error: err }
  }

  // Explicit validation rules
  for (const rule of config.validation ?? []) {
    // Skip 'required' if already handled above to avoid duplicate errors
    if (rule.type === 'required' && config.required) continue
    const err = evaluateRule(rule, value, m)
    if (err) return { valid: false, error: err }
  }

  return { valid: true, error: null }
}

/**
 * Validate an entire form (map of fieldId → value) against an array of field configs.
 * Returns a map of fieldId → error string. Fields that pass have no entry.
 *
 * @param fields  - Array of field configurations
 * @param values  - Map of fieldId → value
 * @param locale  - BCP 47 locale string or pre-resolved ValidationMessages
 */
export function validateForm(
  fields: FieldConfig[],
  values: Record<string, unknown>,
  locale: string | ValidationMessages = 'en',
): Record<string, string> {
  const m: ValidationMessages =
    typeof locale === 'string' ? getValidationMessages(locale) : locale

  const errors: Record<string, string> = {}
  for (const field of fields) {
    if (field.type === 'hidden') continue // hidden fields are never user-submitted
    const result = validateField(field, values[field.id], m)
    if (!result.valid && result.error) {
      errors[field.id] = result.error
    }
  }
  return errors
}

/**
 * React hook version — re-validates whenever value changes after first blur.
 * Use this inside leaf components for live per-field validation.
 *
 * @param config  - Field configuration
 * @param value   - Current field value
 * @param locale  - BCP 47 locale string or pre-resolved ValidationMessages.
 *                  Defaults to English. Pass the current page locale for
 *                  fully localized error messages.
 */
import { useState, useCallback } from 'react'

export function useFieldValidation(
  config: FieldConfig,
  value: unknown,
  locale: string | ValidationMessages = defaultValidationMessages,
) {
  const [touched, setTouched] = useState(false)

  const result = touched ? validateField(config, value, locale) : { valid: true, error: null }

  const handleBlur = useCallback(() => {
    setTouched(true)
  }, [])

  const touch = useCallback(() => setTouched(true), [])

  return {
    error: result.error,
    valid: result.valid,
    touched,
    handleBlur,
    touch,
  }
}
