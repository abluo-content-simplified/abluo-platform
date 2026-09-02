/**
 * Slice-1 form definitions — ADR-018.
 *
 * No Sanity `form` document type exists yet (that is slice 2). Slice 1 resolves
 * a `formId` to a code-owned definition descriptor. The only definition is
 * `early-access`, whose field metadata is derived here from the existing
 * localized copy (`early-access-config.ts`) so option value-sets stay in lockstep
 * with the modal's single source of truth.
 *
 * `resolveDefinitionSnapshot()` returns the immutable interpretation subset that
 * gets frozen onto each submission (ADR-018 Decision 4): fields, steps, options,
 * required flags, validations. It NEVER contains operational/secret config.
 *
 * Slice 3 replaces `resolveDefinition` with a Sanity read + a snapshot over the
 * published `form` document, without changing the submission table or the routes.
 */
import { getEarlyAccessMessages } from '@/lib/forms/early-access-config'

// ── Descriptor types (interpretation-only; safe to freeze into a submission) ───

export type FormFieldValidation = 'email' | 'url'

export interface FormFieldDef {
  /** Stable internal key — locale-independent. Used in submission_data. */
  key: string
  /** Field-library-ish type (informational this slice). */
  type: string
  required?: boolean
  /** Allowed values for select/multiselect/radio fields (locale-independent). */
  options?: string[]
  /** Extra format check applied when a value is present. */
  validate?: FormFieldValidation
  /** Text rules (ADR-018 slice 7d) — enforced server-side in validateStep, frozen into the snapshot. */
  minLength?: number
  maxLength?: number
  pattern?: string
  /** May a placement's Context pre-populate this field? (none for Early Access) */
  contextMappable?: boolean
}

export interface FormStepDef {
  key: string
  fields: FormFieldDef[]
}

export interface FormDefinition {
  formId: string
  version: number
  /** Abstract, provider-agnostic routing tag (ADR-018 Decision 3). */
  notificationTopic: string
  /**
   * If true, the final step also requires GDPR consent (`gdpr_consent = true`).
   * Consent is handled as a top-level column, not a data field.
   */
  requiresConsentAtFinalStep: boolean
  steps: FormStepDef[]
}

// ── Early Access definition (2 API steps: contact → details) ───────────────────
// The modal's 3 visual steps (Contact / Organisation / Streaming) map to 2 API
// steps: `contact` (name+email, created via POST) and `details` (everything
// else, completed via the steps endpoint). Option value-sets are derived from
// the 'en' messages so they never drift from the modal copy.

function earlyAccessOptionValues(pick: (m: ReturnType<typeof getEarlyAccessMessages>) => { value: string }[]): string[] {
  return pick(getEarlyAccessMessages('en')).map((o) => o.value)
}

function buildEarlyAccessDefinition(): FormDefinition {
  return {
    formId: 'early-access',
    version: 1,
    notificationTopic: 'early-access',
    requiresConsentAtFinalStep: true,
    steps: [
      {
        key: 'contact',
        fields: [
          { key: 'name', type: 'text', required: true },
          { key: 'email', type: 'email', required: true, validate: 'email' },
        ],
      },
      {
        key: 'details',
        fields: [
          { key: 'organization', type: 'text' },
          { key: 'role', type: 'select', required: true, options: earlyAccessOptionValues((m) => m.roleOptions) },
          { key: 'orgType', type: 'select', required: true, options: earlyAccessOptionValues((m) => m.orgTypeOptions) },
          { key: 'useCases', type: 'multiselect', options: earlyAccessOptionValues((m) => m.useCaseOptions) },
          { key: 'audienceSize', type: 'select', options: earlyAccessOptionValues((m) => m.audienceSizeOptions) },
          { key: 'website', type: 'url', validate: 'url' },
          { key: 'referralSource', type: 'select', options: earlyAccessOptionValues((m) => m.referralOptions) },
          { key: 'message', type: 'textarea' },
        ],
      },
    ],
  }
}

const DEFINITIONS: Record<string, () => FormDefinition> = {
  'early-access': buildEarlyAccessDefinition,
}

/** Resolves a formId to its definition, or null if unknown (route returns 404). */
export function resolveDefinition(formId: string): FormDefinition | null {
  const build = DEFINITIONS[formId]
  return build ? build() : null
}

/** True if the definition has more than one step (create returns a token). */
export function isMultiStep(def: FormDefinition): boolean {
  return def.steps.length > 1
}

export function firstStep(def: FormDefinition): FormStepDef {
  return def.steps[0]
}

export function findStep(def: FormDefinition, stepKey: string): FormStepDef | undefined {
  return def.steps.find((s) => s.key === stepKey)
}

export function isFinalStep(def: FormDefinition, stepKey: string): boolean {
  return def.steps[def.steps.length - 1]?.key === stepKey
}

export function nextStepKey(def: FormDefinition, stepKey: string): string | null {
  const i = def.steps.findIndex((s) => s.key === stepKey)
  if (i === -1 || i === def.steps.length - 1) return null
  return def.steps[i + 1].key
}

/**
 * Interpretation-subset snapshot pinned onto the submission at creation
 * (ADR-018 Decision 4). The descriptor is already interpretation-only, so the
 * snapshot is a plain structural copy — never operational/secret config.
 */
export function resolveDefinitionSnapshot(def: FormDefinition): Record<string, unknown> {
  return {
    formId: def.formId,
    version: def.version,
    // Consent requirement is part of the interpretation subset (ADR-018 snapshot
    // boundary) — the step path reads it back from the row to gate final-step consent.
    requiresConsentAtFinalStep: def.requiresConsentAtFinalStep,
    steps: def.steps.map((s) => ({
      key: s.key,
      fields: s.fields.map((f) => ({
        key: f.key,
        type: f.type,
        required: !!f.required,
        ...(f.options ? { options: f.options } : {}),
        ...(f.validate ? { validate: f.validate } : {}),
        ...(typeof f.minLength === 'number' ? { minLength: f.minLength } : {}),
        ...(typeof f.maxLength === 'number' ? { maxLength: f.maxLength } : {}),
        ...(f.pattern ? { pattern: f.pattern } : {}),
      })),
    })),
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Server-side value bounds (abuse hardening) ────────────────────────────────
//
// A definition MAY declare `maxLength` per field, but most do not — the code
// fallback descriptor declares none at all, and it is what serves every tenant
// without a published `formDefinition`. Without a floor of our own, `name`,
// `organization` and `message` were unbounded: a 4 MB string satisfied both the
// "required" check and the email regex. These defaults apply whenever the
// definition supplies no explicit `maxLength`, so an unbounded field cannot
// exist regardless of who authored the form.

/** Fallback cap for any field type not listed below. */
export const DEFAULT_MAX_FIELD_LENGTH = 2_000

/**
 * Per-type caps, sized to the longest plausible REAL value:
 *   email    — 254, the RFC 5321 maximum forward-path length
 *   url      — 2048, the de-facto browser/ IIS URL limit
 *   textarea — 4000, ~800 words; longer than any message a contact form wants
 *   short scalars (number/date/rating/checkbox/phone) — 64
 *   choice values — 200; option membership is the real constraint there
 */
export const MAX_FIELD_LENGTH_BY_TYPE: Readonly<Record<string, number>> = {
  textarea: 4_000,
  email: 254,
  url: 2_048,
  phone: 64,
  tel: 64,
  number: 64,
  date: 64,
  rating: 64,
  checkbox: 64,
  hidden: 512,
  select: 200,
  'radio-group': 200,
  'country-select': 200,
  multiselect: 200,
  'multi-select': 200,
  'checkbox-group': 200,
}

/** Maximum number of values a multi-value field may carry. */
export const MAX_MULTI_VALUE_ITEMS = 50

/** The effective per-value character cap for a field. */
export function maxLengthFor(field: FormFieldDef): number {
  if (typeof field.maxLength === 'number') return field.maxLength
  return MAX_FIELD_LENGTH_BY_TYPE[field.type] ?? DEFAULT_MAX_FIELD_LENGTH
}

/** Field types whose value may legitimately be an array. */
const MULTI_VALUE_TYPES = new Set(['multiselect', 'multi-select', 'checkbox-group'])

export function acceptsMultipleValues(field: FormFieldDef): boolean {
  return MULTI_VALUE_TYPES.has(field.type)
}

/**
 * Server-side validation of one step's values (never trust the client, §18).
 * Returns a map of fieldKey → error code ('required' | 'invalid' | 'not_allowed').
 * Empty map = valid. Only fields belonging to `stepKey` are considered.
 */
export function validateStep(
  def: FormDefinition,
  stepKey: string,
  values: Record<string, unknown>,
): Record<string, string> {
  const step = findStep(def, stepKey)
  const errors: Record<string, string> = {}
  if (!step) {
    errors._step = 'unknown_step'
    return errors
  }

  for (const field of step.fields) {
    const raw = values[field.key]
    const isEmpty =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '') ||
      (Array.isArray(raw) && raw.length === 0)

    if (field.required && isEmpty) {
      errors[field.key] = 'required'
      continue
    }
    if (isEmpty) continue // optional + empty → ok

    // ── Shape + size, BEFORE any format/pattern work ─────────────────────────
    // Two reasons this runs first. (1) The length rules used to hang off
    // `if (typeof raw === 'string')`, so sending a field as a nested object or
    // an array skipped every length, format and pattern check and landed in the
    // database as-is. A value whose shape the field cannot hold is now simply
    // invalid. (2) Bounding the length before running a regex keeps an
    // attacker-supplied megabyte away from the email/URL/`pattern` matchers.
    const max = maxLengthFor(field)

    if (Array.isArray(raw)) {
      if (!acceptsMultipleValues(field)) {
        errors[field.key] = 'invalid' // a single-value field cannot hold a list
        continue
      }
      if (raw.length > MAX_MULTI_VALUE_ITEMS) {
        errors[field.key] = 'invalid'
        continue
      }
      if (!raw.every((v) => typeof v === 'string' && v.length <= max)) {
        errors[field.key] = 'invalid'
        continue
      }
    } else if (typeof raw === 'string') {
      if (raw.length > max) {
        errors[field.key] = 'invalid'
        continue
      }
    } else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) {
        errors[field.key] = 'invalid'
        continue
      }
    } else if (typeof raw !== 'boolean') {
      // Objects, functions, symbols, bigints — nothing a form field holds.
      errors[field.key] = 'invalid'
      continue
    }

    if (field.validate === 'email' && typeof raw === 'string' && !EMAIL_RE.test(raw.trim())) {
      errors[field.key] = 'invalid'
      continue
    }
    if (field.validate === 'url' && typeof raw === 'string') {
      let ok = false
      try {
        const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
        // Match the client: a bare word parses once https:// is prepended, so
        // also require a dotted hostname (real domain) and no whitespace.
        ok = !/\s/.test(raw) && u.hostname.includes('.') && !u.hostname.startsWith('.') && !u.hostname.endsWith('.')
      } catch {
        ok = false
      }
      if (!ok) {
        errors[field.key] = 'invalid'
        continue
      }
    }
    // Text rules (ADR-018 slice 7d) — mirror the client validator so a value that
    // passes in the browser also passes here (and vice-versa). String values only.
    // (`maxLength` is enforced above, where it also covers fields the definition
    // gave no explicit cap — see maxLengthFor.)
    if (typeof raw === 'string') {
      if (typeof field.minLength === 'number' && raw.length < field.minLength) {
        errors[field.key] = 'invalid'
        continue
      }
      if (field.pattern) {
        try {
          if (!new RegExp(field.pattern).test(raw)) {
            errors[field.key] = 'invalid'
            continue
          }
        } catch {
          // Malformed pattern — fail open (skip), matching the client validator.
        }
      }
    }
    // Option-membership: reject values outside the allowed set.
    if (field.options && field.options.length > 0) {
      const vals = Array.isArray(raw) ? raw : [raw]
      const allDefined = vals.every((v) => typeof v === 'string' && field.options!.includes(v))
      if (!allDefined) errors[field.key] = 'not_allowed'
    }
  }

  return errors
}

/**
 * Returns only the values whose keys belong to `stepKey` (whitelist).
 * Everything else the client sent is discarded — a step call can never write
 * another step's fields, identity fields, or arbitrary keys (§18).
 */
export function whitelistStepValues(
  def: FormDefinition,
  stepKey: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const step = findStep(def, stepKey)
  if (!step) return {}
  const allowed = new Set(step.fields.map((f) => f.key))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (allowed.has(k) && v !== undefined) out[k] = v
  }
  return out
}
