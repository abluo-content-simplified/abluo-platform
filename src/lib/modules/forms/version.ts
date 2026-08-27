// ── version.ts ────────────────────────────────────────────────────────────────
//
// Automatic version bumping for form definitions.
//
// `version` is pinned onto every submission as `form_version`, so it is how a
// submission from March is read back against the form as it stood in March.
// ADR-018 Decision 4 specified a monotonic integer with a bump mechanism; the
// mechanism was deferred to "slice 7" and never landed, leaving the field a
// plain editable number whose only protection was a description asking editors
// not to decrement it. An admin could edit a live form and forget to bump, or
// type any number at all, and the submission record would say something untrue.
//
// The saving grace is that `definition_snapshot` — the whole definition as it
// was — is stored on each submission too, so the snapshot is authoritative and
// no data is actually lost. `version` is the human-readable label for that
// snapshot. This module makes the label honest.
//
// What counts as a change
// -----------------------
// A bump means "submissions before and after this point are not directly
// comparable". That is true when the *shape of the data* changes: which fields
// exist, what they are called, what type they hold, whether they are required,
// which option values are accepted, and the validation bounds.
//
// It is NOT true for presentation edits — fixing a typo in a label, translating
// a placeholder, switching a radio group from a list to cards. Those change how
// the form looks, not what a submission means. Bumping on them would inflate the
// version on every copy tweak and make it meaningless, which is the opposite of
// the point.

/** Field attributes that change the meaning or validity of submitted data. */
const STRUCTURAL_FIELD_KEYS = [
  'internalKey',
  'type',
  'required',
  'minLength',
  'maxLength',
  'pattern',
  'min',
  'max',
  'accept',
  'maxSizeMb',
] as const

interface RawOption {
  value?: unknown
}

interface RawField {
  internalKey?: unknown
  type?: unknown
  required?: unknown
  options?: RawOption[] | null
  [key: string]: unknown
}

interface RawStep {
  key?: unknown
  fields?: RawField[] | null
}

export interface VersionableForm {
  version?: unknown
  steps?: RawStep[] | null
}

function scalar(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

/**
 * A stable string describing everything about a form that affects its data.
 *
 * Two definitions with the same fingerprint accept the same submissions, so a
 * submission against one is directly comparable to a submission against the
 * other. Order matters: moving a field between steps changes which step a value
 * arrives in, so it is a structural change.
 */
export function structuralFingerprint(form: VersionableForm | null | undefined): string {
  const steps = Array.isArray(form?.steps) ? form!.steps! : []

  return steps
    .map((step) => {
      const fields = Array.isArray(step?.fields) ? step.fields! : []
      const fieldParts = fields.map((field) => {
        const attrs = STRUCTURAL_FIELD_KEYS.map((key) => `${key}=${scalar(field?.[key])}`)
        // Option values are the accepted vocabulary of a choice field. Sorted,
        // because reordering choices on screen does not change what is valid.
        const options = Array.isArray(field?.options) ? field.options! : []
        const values = options
          .map((option) => scalar(option?.value))
          .sort()
          .join('|')
        return `${attrs.join(';')};options=[${values}]`
      })
      return `step:${scalar(step?.key)}{${fieldParts.join('&')}}`
    })
    .join('||')
}

/** Whether two definitions differ in any way that affects submitted data. */
export function hasStructuralChange(
  published: VersionableForm | null | undefined,
  draft: VersionableForm | null | undefined
): boolean {
  return structuralFingerprint(published) !== structuralFingerprint(draft)
}

/** Read a version off a document, defaulting to 1 for anything unusable. */
export function currentVersion(form: VersionableForm | null | undefined): number {
  const raw = form?.version
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return 1
  return raw
}

/**
 * The version a draft should carry when published.
 *
 * - No published version yet → 1. A form nobody has submitted against has no
 *   history to be incompatible with.
 * - No structural change → whatever is already published. Presentation edits
 *   must not move it.
 * - Structural change → published + 1.
 *
 * Monotonic by construction: it is derived from the published version rather
 * than from anything in the draft, so a hand-edited draft value cannot lower it
 * and re-publishing without edits cannot inflate it.
 */
export function nextVersion(
  published: VersionableForm | null | undefined,
  draft: VersionableForm | null | undefined
): number {
  if (!published) return 1
  const base = currentVersion(published)
  return hasStructuralChange(published, draft) ? base + 1 : base
}
