// ── Build-time manifest validation ───────────────────────────────────────────
// ADR-014 Phase A. Mirrors src/lib/modules/validate.ts's structure and
// compiler-style diagnostic format exactly (numbered rules, collect-all-errors-
// before-throwing, [id] Rule N — message / Fix lines).
//
// Called at module load time from registry.ts — a failure throws immediately,
// which propagates as a build error in Next.js and Sanity Studio, the same as
// validateRegistry does for MODULE_REGISTRY.

import type { IntegrationManifest } from './types'

// ── Internal error record ─────────────────────────────────────────────────────

type ManifestError = {
  /** Integration id — null for registry-level (cross-manifest) rules. */
  integrationId: string | null
  rule: number
  message: string
  fix: string
}

// ── Validation constants ──────────────────────────────────────────────────────

/**
 * Lowercase kebab-case: starts with a letter, followed by letters, digits,
 * or hyphens. Rejects uppercase, spaces, underscores, and leading hyphens.
 * Identical pattern to modules/validate.ts's KEBAB_ID_RE.
 */
const KEBAB_ID_RE = /^[a-z][a-z0-9-]*$/

const VALID_CATEGORIES = new Set<string>([
  'analytics',
  'marketing',
  'forms',
  'ai',
  'payments',
  'developers',
])

const VALID_CONSENT_CATEGORIES = new Set<string>([
  'necessary',
  'analytics',
  'marketing',
  'functional',
])

const VALID_STATUSES = new Set<string>(['released', 'beta', 'deprecated'])

// ── Compiler-style formatter ──────────────────────────────────────────────────

function formatErrors(errors: ManifestError[]): string {
  const count = errors.length
  const lines: string[] = [
    `INTEGRATION_REGISTRY validation failed (${count} ${count === 1 ? 'error' : 'errors'}):`,
    '',
  ]

  for (const err of errors) {
    const tag =
      err.integrationId !== null
        ? `[${err.integrationId}] Rule ${err.rule}`
        : `Rule ${err.rule}`

    const prefix = `  ${tag} — `
    const fixIndent = ' '.repeat(prefix.length)

    lines.push(`${prefix}${err.message}`)
    lines.push(`${fixIndent}Fix: ${err.fix}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ── validateIntegrationRegistry ───────────────────────────────────────────────

/**
 * Validates all entries in INTEGRATION_REGISTRY against all structural rules.
 *
 * Rules:
 *   1.  All id values are unique.
 *   2.  All id values are lowercase kebab-case.
 *   3.  category is one of: analytics, marketing, forms, ai, payments, developers.
 *   4.  consentCategory is one of: necessary, analytics, marketing, functional.
 *   5.  status is one of: released, beta, deprecated.
 *   6.  label is a non-empty string.
 *   7.  version is a non-empty string.
 *   8.  fields is a non-empty array.
 *   9.  Every field has a non-empty id, unique within the manifest.
 *   10. Every field's validation.regex (if set) compiles as a JavaScript RegExp.
 *   11. No field marked secret: true has type "boolean".
 *   12. renderContract.component, if renderContract is set, is a non-empty string.
 *
 * @throws {Error} If any rule is violated. The message lists all violations.
 */
export function validateIntegrationRegistry(registry: IntegrationManifest[]): void {
  const errors: ManifestError[] = []

  // Track first-seen positions for Rule 1.
  const seenIds = new Map<string, number>()

  for (let i = 0; i < registry.length; i++) {
    const m = registry[i]
    const mid: string = m.id || `[index ${i}]`

    // ── Rule 1: unique IDs ───────────────────────────────────────────────────
    if (seenIds.has(m.id)) {
      errors.push({
        integrationId: null,
        rule: 1,
        message: `id "${m.id}" is declared at positions ${seenIds.get(m.id)} and ${i}.`,
        fix: `Each integration must have a unique id.`,
      })
    } else {
      seenIds.set(m.id, i)
    }

    // ── Rule 2: lowercase kebab-case ─────────────────────────────────────────
    if (!KEBAB_ID_RE.test(m.id)) {
      errors.push({
        integrationId: mid,
        rule: 2,
        message: `id "${m.id}" is not lowercase kebab-case.`,
        fix: `Use only lowercase letters (a–z), digits (0–9), and hyphens. Must start with a letter (e.g. "my-integration").`,
      })
    }

    // ── Rule 3: valid category ───────────────────────────────────────────────
    if (!VALID_CATEGORIES.has(m.category)) {
      errors.push({
        integrationId: mid,
        rule: 3,
        message: `category "${m.category}" is not a valid value.`,
        fix: `Set category to one of: analytics, marketing, forms, ai, payments, developers.`,
      })
    }

    // ── Rule 4: valid consentCategory ────────────────────────────────────────
    if (!VALID_CONSENT_CATEGORIES.has(m.consentCategory)) {
      errors.push({
        integrationId: mid,
        rule: 4,
        message: `consentCategory "${m.consentCategory}" is not a valid value.`,
        fix: `Set consentCategory to one of: necessary, analytics, marketing, functional.`,
      })
    }

    // ── Rule 5: valid status ─────────────────────────────────────────────────
    if (!VALID_STATUSES.has(m.status)) {
      errors.push({
        integrationId: mid,
        rule: 5,
        message: `status "${m.status}" is not a valid value.`,
        fix: `Set status to one of: "released", "beta", "deprecated".`,
      })
    }

    // ── Rule 6: non-empty label ──────────────────────────────────────────────
    if (!m.label || m.label.trim().length === 0) {
      errors.push({
        integrationId: mid,
        rule: 6,
        message: `label is empty.`,
        fix: `Provide a non-empty, human-readable label.`,
      })
    }

    // ── Rule 7: non-empty version ─────────────────────────────────────────────
    if (!m.version || m.version.trim().length === 0) {
      errors.push({
        integrationId: mid,
        rule: 7,
        message: `version is empty.`,
        fix: `Provide a non-empty version string, e.g. "1.0.0".`,
      })
    }

    // ── Rule 8: fields non-empty ──────────────────────────────────────────────
    if (!m.fields || m.fields.length === 0) {
      errors.push({
        integrationId: mid,
        rule: 8,
        message: `fields is empty.`,
        fix: `Every integration must declare at least one field.`,
      })
    }

    // ── Rules 9–11: per-field checks ─────────────────────────────────────────
    const seenFieldIds = new Set<string>()
    for (const field of m.fields ?? []) {
      // Rule 9: non-empty, unique field id.
      if (!field.id || field.id.trim().length === 0) {
        errors.push({
          integrationId: mid,
          rule: 9,
          message: `fields contains an entry with an empty id.`,
          fix: `Every field must have a non-empty id string.`,
        })
      } else if (seenFieldIds.has(field.id)) {
        errors.push({
          integrationId: mid,
          rule: 9,
          message: `field id "${field.id}" is declared more than once.`,
          fix: `Each field id must be unique within the manifest.`,
        })
      } else {
        seenFieldIds.add(field.id)
      }

      // Rule 10: regex compiles.
      if (field.validation?.regex) {
        try {
          // eslint-disable-next-line no-new
          new RegExp(field.validation.regex)
        } catch {
          errors.push({
            integrationId: mid,
            rule: 10,
            message: `field "${field.id}" validation.regex "${field.validation.regex}" does not compile.`,
            fix: `Provide a valid JavaScript regular expression pattern.`,
          })
        }
      }

      // Rule 11: secret fields must not be boolean type.
      if (field.secret === true && field.type === 'boolean') {
        errors.push({
          integrationId: mid,
          rule: 11,
          message: `field "${field.id}" is marked secret but has type "boolean".`,
          fix: `Secret fields must hold a value that can be masked/stored securely — "boolean" is not a valid type for a secret field.`,
        })
      }
    }

    // ── Rule 12: renderContract.component non-empty when present ────────────
    if (
      m.renderContract !== undefined &&
      (!m.renderContract.component || m.renderContract.component.trim().length === 0)
    ) {
      errors.push({
        integrationId: mid,
        rule: 12,
        message: `renderContract is set but component is empty.`,
        fix: `Provide a non-empty component name, or remove renderContract entirely.`,
      })
    }
  }

  if (errors.length === 0) return

  throw new Error(formatErrors(errors))
}
