/**
 * Form render mapping — ADR-018 slice 4.
 *
 * Pure, framework-free helpers that turn a GROQ-resolved, locale-applied
 * `RenderableFormDefinition` into the Field Library's `FieldConfig[]`, and shape
 * the submission payload for the new `/api/forms/{tenantSlug}/{formId}/submissions`
 * endpoint. Kept pure so the mapping (all 16 field types + consent handling) is
 * unit-tested without rendering.
 *
 * Slice 4 is SINGLE-STEP only. Multi-step rendering (stepper + rotating-token
 * flow) is slice 5 — `singleStepFields()` returns null for a multi-step
 * definition so the renderer can decline rather than post a partial submission.
 */
import type { FieldConfig, OptionItem, ValidationRule } from '@/components/fields'
import type { RenderableFormDefinition, RenderableFormField } from '@/lib/sanity/types'

/** Stable key used for the synthetic consent checkbox (kept out of `data`). */
export const CONSENT_FIELD_ID = 'gdpr_consent'

/**
 * The fields to render for a single-step definition, or null if the definition
 * is multi-step / malformed (slice 4 declines those — slice 5 renders them).
 */
export function singleStepFields(def: RenderableFormDefinition | null | undefined): RenderableFormField[] | null {
  if (!def || !Array.isArray(def.steps) || def.steps.length !== 1) return null
  if (def.formType && def.formType !== 'single-step') return null
  const fields = def.steps[0].fields
  return Array.isArray(fields) && fields.length > 0 ? fields : null
}

/**
 * Maps a resolved definition field to a Field Library `FieldConfig`.
 * Returns null for types the generic renderer does not surface (hidden fields
 * carry no render value in the section projection this slice).
 */
export function toFieldConfig(field: RenderableFormField): FieldConfig | null {
  const validation: ValidationRule[] = field.required ? [{ type: 'required' }] : []
  const base = {
    id: field.id,
    label: field.label ?? field.id,
    placeholder: field.placeholder,
    helpText: field.help,
    required: field.required ?? false,
    width: field.width ?? '100%',
    validation,
  }
  const options: OptionItem[] = (field.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value }))

  switch (field.type) {
    case 'text':
      return { ...base, type: 'text' }
    case 'textarea':
      return { ...base, type: 'textarea', rows: 4 }
    case 'number':
      return { ...base, type: 'number' }
    case 'email':
      return { ...base, type: 'email', validation: [...validation, { type: 'email' }] }
    case 'phone':
      return { ...base, type: 'phone' }
    case 'url':
      return { ...base, type: 'url', validation: [...validation, { type: 'url' }] }
    case 'select':
      return { ...base, type: 'select', options, emptyOption: field.placeholder }
    case 'multi-select':
      return { ...base, type: 'multi-select', options }
    case 'radio-group':
      return { ...base, type: 'radio-group', options, display: field.display === 'cards' ? 'cards' : 'list' }
    case 'checkbox':
      return { ...base, type: 'checkbox' }
    case 'checkbox-group':
      return { ...base, type: 'checkbox-group', options, display: field.display === 'chips' || field.display === 'cards' ? field.display : 'list' }
    case 'country-select':
      return { ...base, type: 'country-select', emptyOption: field.placeholder }
    case 'date':
      return { ...base, type: 'date' }
    case 'file':
      return { ...base, type: 'file' }
    case 'rating':
      return { ...base, type: 'rating' }
    case 'hidden':
      // No static value is projected for rendering this slice — skip.
      return null
    default:
      return null
  }
}

/** Builds the ordered FieldConfig[] for a step (+ consent last when included). */
export function buildFieldConfigs(
  def: RenderableFormDefinition,
  fields: RenderableFormField[],
  includeConsent?: boolean,
): FieldConfig[] {
  const configs = fields.map(toFieldConfig).filter((c): c is FieldConfig => c !== null)
  // Single-step: consent appended when the definition requires it (default).
  // Multi-step: caller passes `true` only on the final step (consent lives there).
  const withConsent = includeConsent ?? !!def.requireConsent
  if (withConsent) {
    configs.push({
      id: CONSENT_FIELD_ID,
      type: 'checkbox',
      label: def.consentText ?? 'I agree to the processing of my data.',
      checkboxLabel: def.consentText ?? 'I agree to the processing of my data.',
      required: true,
      width: '100%',
      validation: [{ type: 'required' }],
    })
  }
  return configs
}

export interface SubmissionPayload {
  locale: string
  data: Record<string, unknown>
  gdprConsent: boolean
  /** Form-fill start time (spam timing). Omitted for machine-paced auto-advance
   * creates (a context-satisfied step the human never interacted with), so the
   * server's isTooFast() heuristic correctly does not apply to them. */
  openedAt?: number
  /** Honeypot — must be empty for a human submission (see spam.ts). */
  company_website: string
  source?: Record<string, unknown>
}

/**
 * Splits raw form values into the endpoint payload: field values (by
 * internalKey) go into `data`; the synthetic consent checkbox is lifted to the
 * top-level `gdprConsent` flag (consent is a submission column, not a data
 * field — ADR-018 §23). The honeypot rides along verbatim.
 */
export function buildSubmissionPayload(
  values: Record<string, unknown>,
  opts: { locale: string; openedAt?: number; honeypot?: string; source?: Record<string, unknown> },
): SubmissionPayload {
  const data: Record<string, unknown> = {}
  let gdprConsent = false
  for (const [key, val] of Object.entries(values)) {
    if (key === CONSENT_FIELD_ID) {
      gdprConsent = val === true || val === 'true'
    } else {
      data[key] = val
    }
  }
  return {
    locale: opts.locale,
    data,
    gdprConsent,
    openedAt: opts.openedAt,
    company_website: opts.honeypot ?? '',
    ...(opts.source ? { source: opts.source } : {}),
  }
}

/** New-endpoint URL for a placement. tenantSlug is the URL tenant scope. */
export function submissionEndpoint(tenantSlug: string, formId: string): string {
  return `/api/forms/${encodeURIComponent(tenantSlug)}/${encodeURIComponent(formId)}/submissions`
}
