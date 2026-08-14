// ── WhatsApp module — silent form ownership ───────────────────────────────────
// ADR-020 Amendment A.
//
// In capture mode the WhatsApp button opens a subject + message overlay, records
// the enquiry, and only then hands off to WhatsApp. That recording is a Forms
// submission — the Forms module owns submissions, and WhatsApp must not grow a
// second, parallel copy of that machinery.
//
// But an admin who has just switched WhatsApp on should never be asked to pick a
// form. So the module OWNS a form definition: it derives one from the subjects
// configured in the Modules pane and keeps it in step. "formDefinition" is
// plumbing, and plumbing belongs behind the wall.
//
// ── What this guarantees ──────────────────────────────────────────────────────
//
// 1. One writer. The document is derived from module config, so config is the
//    source of truth and the form is a projection of it. Editing the form
//    directly is not a supported workflow.
// 2. Stable identity. The document id is derived from the project slug, so
//    re-saving updates in place rather than accumulating duplicates.
// 3. Stable submission keys. Field `internalKey`s (`subject`, `message`) and
//    each subject's `value` never change when labels are renamed or translated,
//    so historical submissions keep resolving.
// 4. No destructive writes. buildWhatsAppFormPatch() only ever sets the fields
//    this module derives; anything else on the document (notification topic,
//    privacy copy) is left untouched.
//
// This file is pure — it computes documents and patches. The Studio pane
// performs the actual writes, so the logic stays unit-testable without a client.

import type { ModuleConfigListEntry } from '../types'

/** Stable form id used in the submission route for every WhatsApp form. */
export const WHATSAPP_FORM_ID = 'whatsapp'

/** Stable internal keys recorded on every WhatsApp submission. */
export const WHATSAPP_SUBJECT_KEY = 'subject'
export const WHATSAPP_MESSAGE_KEY = 'message'

/** The single step key. WhatsApp capture is deliberately one screen. */
export const WHATSAPP_STEP_KEY = 'contact'

/**
 * Deterministic document id for a project's WhatsApp form.
 *
 * Derived rather than random so that re-saving the module updates the same
 * document. Matches the id already in production for Studio Martegani
 * (`formDefinition-studiomartegani-whatsapp`), so the existing form and its
 * submissions are adopted rather than orphaned.
 */
export function whatsAppFormId(tenantSlug: string): string {
  return `formDefinition-${tenantSlug}-${WHATSAPP_FORM_ID}`
}

export type WhatsAppFormInput = {
  /** URL tenant slug, e.g. "studiomartegani" — used for the id and ownership. */
  tenantSlug: string
  /** Subjects as configured in the Modules pane, in display order. */
  subjects: ModuleConfigListEntry[]
  /** Localized label for the message field, keyed by locale. */
  messageLabel?: Record<string, string>
}

/** A Sanity-shaped localizedString. */
function localizedString(values: Record<string, string>): Record<string, string> {
  return { _type: 'localizedString', ...values }
}

/**
 * Builds the field list for the WhatsApp form: a required subject choice
 * followed by a required free-text message.
 *
 * The subject field is omitted entirely when no subjects are configured — a
 * radio group with zero options is a dead control, and the overlay is still
 * useful as message-only.
 */
function buildFields(input: WhatsAppFormInput) {
  const fields: Record<string, unknown>[] = []

  if (input.subjects.length > 0) {
    fields.push({
      _type: 'formDefinitionField',
      _key: WHATSAPP_SUBJECT_KEY,
      internalKey: WHATSAPP_SUBJECT_KEY,
      type: 'radio-group',
      required: true,
      label: localizedString({ en: 'Subject', it: 'Oggetto', de: 'Betreff' }),
      options: input.subjects.map((subject) => ({
        _key: subject.value,
        // The stored value is the subject's stable key, never its label — a
        // renamed or newly translated label must not orphan past submissions.
        value: subject.value,
        label: localizedString(subject.label),
      })),
    })
  }

  fields.push({
    _type: 'formDefinitionField',
    _key: WHATSAPP_MESSAGE_KEY,
    internalKey: WHATSAPP_MESSAGE_KEY,
    type: 'textarea',
    required: true,
    label: localizedString(
      input.messageLabel ?? { en: 'Message', it: 'Messaggio', de: 'Nachricht' }
    ),
  })

  return fields
}

/**
 * The fields this module derives and therefore owns on the form document.
 *
 * Returned as a patch body rather than a whole document so an existing form —
 * including the one already live for Studio Martegani — keeps any settings the
 * module does not manage.
 */
export function buildWhatsAppFormPatch(input: WhatsAppFormInput): Record<string, unknown> {
  return {
    formId: WHATSAPP_FORM_ID,
    internalName: `WhatsApp (${input.tenantSlug})`,
    formType: 'single-step',
    role: 'active',
    tenantSlug: input.tenantSlug,
    steps: [
      {
        _type: 'formStep',
        _key: WHATSAPP_STEP_KEY,
        key: WHATSAPP_STEP_KEY,
        fields: buildFields(input),
      },
    ],
  }
}

/**
 * The full document used when no WhatsApp form exists yet.
 *
 * `version` is set once at creation and never touched afterwards: it is pinned
 * onto each submission, and rewriting it on every save would misrepresent which
 * shape a historical submission was captured against.
 */
export function buildWhatsAppFormDocument(input: WhatsAppFormInput): Record<string, unknown> {
  return {
    _id: whatsAppFormId(input.tenantSlug),
    _type: 'formDefinition',
    version: 1,
    ...buildWhatsAppFormPatch(input),
  }
}

/**
 * Reads subjects back out of a stored form definition.
 *
 * Used to adopt a form that already exists — Studio Martegani's five subjects
 * were authored before the module owned them, and must appear in the pane the
 * first time it is opened rather than looking like an empty list the admin is
 * about to overwrite.
 */
export function extractSubjectsFromForm(
  form: { steps?: { fields?: { internalKey?: string; options?: { value?: string; label?: Record<string, string> }[] }[] }[] } | null | undefined
): ModuleConfigListEntry[] {
  if (!form?.steps) return []

  for (const step of form.steps) {
    for (const field of step.fields ?? []) {
      if (field.internalKey !== WHATSAPP_SUBJECT_KEY) continue
      return (field.options ?? [])
        .filter((option): option is { value: string; label?: Record<string, string> } =>
          typeof option.value === 'string' && option.value.length > 0
        )
        .map((option) => {
          // Drop Sanity's _type marker — the pane edits plain locale→string maps.
          const { _type, ...labels } = (option.label ?? {}) as Record<string, string>
          void _type
          return { _key: option.value, value: option.value, label: labels }
        })
    }
  }

  return []
}

/**
 * Derives a stable machine value from an admin-typed label.
 *
 * Only ever used when CREATING a subject — an existing subject keeps the value
 * it was born with, so later edits to its label never move it.
 */
export function slugifySubjectValue(label: string, existing: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      // Strip combining marks so "Preventivo" and "Prevéntivo" don't produce
      // two different keys.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'subject'

  if (!existing.includes(base)) return base

  let n = 2
  while (existing.includes(`${base}_${n}`)) n++
  return `${base}_${n}`
}
