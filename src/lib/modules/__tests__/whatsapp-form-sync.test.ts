import { describe, it, expect } from 'vitest'
import {
  WHATSAPP_FORM_ID,
  WHATSAPP_MESSAGE_KEY,
  WHATSAPP_SUBJECT_KEY,
  buildWhatsAppFormDocument,
  buildWhatsAppFormPatch,
  extractSubjectsFromForm,
  slugifySubjectValue,
  whatsAppFormId,
} from '../whatsapp/form-sync'
import type { ModuleConfigListEntry } from '../types'

// ── ADR-020 Amendment A — silent form ownership ──────────────────────────────
//
// The WhatsApp module derives a form definition from the subjects an admin types
// in the Modules pane, so lead capture keeps working while "form" never appears
// in the UI. The properties worth pinning are the ones that would silently
// corrupt data if they broke: stable ids, stable submission keys, and adoption
// of a form that already exists.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyType = any

const subject = (value: string, label: Record<string, string>): ModuleConfigListEntry => ({
  _key: value,
  value,
  label,
})

const SUBJECTS = [
  subject('emergency', { en: 'Dental emergency', it: 'Emergenza dentale' }),
  subject('book_appointment', { en: 'Book an appointment', it: 'Prenota un appuntamento' }),
]

describe('whatsAppFormId', () => {
  it('is derived from the tenant slug, so re-saving updates in place', () => {
    // A random id would create a new form on every save.
    expect(whatsAppFormId('studiomartegani')).toBe('formDefinition-studiomartegani-whatsapp')
    expect(whatsAppFormId('studiomartegani')).toBe(whatsAppFormId('studiomartegani'))
  })

  it('matches the id already live in production', () => {
    // Martegani's existing WhatsApp form must be adopted, not orphaned.
    expect(whatsAppFormId('studiomartegani')).toBe('formDefinition-studiomartegani-whatsapp')
  })
})

describe('buildWhatsAppFormPatch', () => {
  const patch = buildWhatsAppFormPatch({ tenantSlug: 'studiomartegani', subjects: SUBJECTS })

  it('produces a single-step form owned by the tenant', () => {
    expect(patch.formId).toBe(WHATSAPP_FORM_ID)
    expect(patch.formType).toBe('single-step')
    expect(patch.role).toBe('active')
    expect(patch.tenantSlug).toBe('studiomartegani')
    expect((patch.steps as AnyType[]).length).toBe(1)
  })

  it('emits a required subject field followed by a required message field', () => {
    const fields = (patch.steps as AnyType[])[0].fields
    expect(fields.map((f: AnyType) => f.internalKey)).toEqual([
      WHATSAPP_SUBJECT_KEY,
      WHATSAPP_MESSAGE_KEY,
    ])
    expect(fields[0].type).toBe('radio-group')
    expect(fields[0].required).toBe(true)
    expect(fields[1].type).toBe('textarea')
    expect(fields[1].required).toBe(true)
  })

  it('stores each subject under its stable value, never its label', () => {
    // This is the property that keeps historical submissions resolvable when a
    // label is renamed or newly translated.
    const options = (patch.steps as AnyType[])[0].fields[0].options
    expect(options.map((o: AnyType) => o.value)).toEqual(['emergency', 'book_appointment'])
  })

  it('carries every locale of every subject label', () => {
    const options = (patch.steps as AnyType[])[0].fields[0].options
    expect(options[0].label.en).toBe('Dental emergency')
    expect(options[0].label.it).toBe('Emergenza dentale')
    expect(options[0].label._type).toBe('localizedString')
  })

  it('preserves the admin-defined subject order', () => {
    const options = (patch.steps as AnyType[])[0].fields[0].options
    expect(options[0].value).toBe('emergency')
    expect(options[1].value).toBe('book_appointment')
  })

  it('omits the subject field entirely when no subjects are configured', () => {
    // A radio group with zero options is a dead control; message-only is still
    // a usable overlay.
    const empty = buildWhatsAppFormPatch({ tenantSlug: 't', subjects: [] })
    const fields = (empty.steps as AnyType[])[0].fields
    expect(fields.map((f: AnyType) => f.internalKey)).toEqual([WHATSAPP_MESSAGE_KEY])
  })

  it('does not set version — that is creation-only', () => {
    // version is pinned onto each submission; rewriting it on every save would
    // misrepresent which shape a historical submission was captured against.
    expect(patch.version).toBeUndefined()
  })
})

describe('buildWhatsAppFormDocument', () => {
  const doc = buildWhatsAppFormDocument({ tenantSlug: 'studiomartegani', subjects: SUBJECTS })

  it('is a complete formDefinition with a derived id', () => {
    expect(doc._type).toBe('formDefinition')
    expect(doc._id).toBe('formDefinition-studiomartegani-whatsapp')
  })

  it('sets version 1 at creation', () => {
    expect(doc.version).toBe(1)
  })
})

describe('extractSubjectsFromForm', () => {
  it('reads subjects back out of a stored form', () => {
    // Adoption: Martegani's five subjects were authored before the module owned
    // them and must appear in the pane rather than looking like an empty list.
    const form = {
      steps: [
        {
          fields: [
            {
              internalKey: 'subject',
              options: [
                { value: 'emergency', label: { _type: 'localizedString', en: 'Emergency', it: 'Emergenza' } },
              ],
            },
          ],
        },
      ],
    }
    const subjects = extractSubjectsFromForm(form)
    expect(subjects).toHaveLength(1)
    expect(subjects[0].value).toBe('emergency')
    expect(subjects[0].label).toEqual({ en: 'Emergency', it: 'Emergenza' })
  })

  it('strips Sanity’s _type marker from the label map', () => {
    const form = {
      steps: [{ fields: [{ internalKey: 'subject', options: [{ value: 'a', label: { _type: 'localizedString', en: 'A' } }] }] }],
    }
    expect(extractSubjectsFromForm(form)[0].label).not.toHaveProperty('_type')
  })

  it('returns an empty list for a form with no subject field', () => {
    const form = { steps: [{ fields: [{ internalKey: 'message' }] }] }
    expect(extractSubjectsFromForm(form)).toEqual([])
  })

  it('returns an empty list for null, undefined, or a stepless form', () => {
    expect(extractSubjectsFromForm(null)).toEqual([])
    expect(extractSubjectsFromForm(undefined)).toEqual([])
    expect(extractSubjectsFromForm({})).toEqual([])
  })

  it('skips options with no stable value', () => {
    const form = {
      steps: [{ fields: [{ internalKey: 'subject', options: [{ label: { en: 'Orphan' } }, { value: 'ok', label: { en: 'Ok' } }] }] }],
    }
    expect(extractSubjectsFromForm(form).map((s) => s.value)).toEqual(['ok'])
  })

  it('round-trips: build then extract yields the original subjects', () => {
    const patch = buildWhatsAppFormPatch({ tenantSlug: 't', subjects: SUBJECTS })
    const extracted = extractSubjectsFromForm(patch as AnyType)
    expect(extracted.map((s) => s.value)).toEqual(SUBJECTS.map((s) => s.value))
    expect(extracted[0].label.en).toBe('Dental emergency')
  })
})

describe('slugifySubjectValue', () => {
  it('derives a machine key from a typed label', () => {
    expect(slugifySubjectValue('Dental emergency')).toBe('dental_emergency')
  })

  it('strips accents so equivalent labels do not diverge', () => {
    expect(slugifySubjectValue('Preventivo')).toBe(slugifySubjectValue('Prevéntivo'))
  })

  it('collapses punctuation and trims separators', () => {
    expect(slugifySubjectValue('Quote / cost estimate!')).toBe('quote_cost_estimate')
  })

  it('falls back for a label with no usable characters', () => {
    expect(slugifySubjectValue('!!!')).toBe('subject')
  })

  it('disambiguates against values already in use', () => {
    expect(slugifySubjectValue('Emergency', ['emergency'])).toBe('emergency_2')
    expect(slugifySubjectValue('Emergency', ['emergency', 'emergency_2'])).toBe('emergency_3')
  })

  it('is stable for the same input', () => {
    expect(slugifySubjectValue('Book an appointment')).toBe(slugifySubjectValue('Book an appointment'))
  })
})
