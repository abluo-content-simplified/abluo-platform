import { describe, it, expect } from 'vitest'
import {
  structuralFingerprint,
  hasStructuralChange,
  currentVersion,
  nextVersion,
} from '../version'

// ── Automatic form versioning ────────────────────────────────────────────────
//
// `version` is pinned onto every submission as `form_version`. The rule these
// tests protect is that it moves when — and only when — submissions before and
// after the edit stop being comparable. Bumping on cosmetic edits would inflate
// it into noise; not bumping on structural ones would make it a lie.

const form = (steps: unknown[], version = 1) => ({ version, steps }) as never

const contactStep = (overrides: Record<string, unknown> = {}) => ({
  key: 'contact',
  title: { en: 'Contact' },
  fields: [
    { internalKey: 'name', type: 'text', required: true, label: { en: 'Full Name' } },
    { internalKey: 'email', type: 'email', required: true, label: { en: 'Email' } },
    ...(overrides.extraFields as unknown[] ?? []),
  ],
  ...overrides,
})

describe('structuralFingerprint', () => {
  it('is stable across repeated calls on equal input', () => {
    expect(structuralFingerprint(form([contactStep()])))
      .toBe(structuralFingerprint(form([contactStep()])))
  })

  it('ignores the version itself, so republishing cannot cascade', () => {
    expect(structuralFingerprint(form([contactStep()], 1)))
      .toBe(structuralFingerprint(form([contactStep()], 9)))
  })

  it('treats an empty form and a missing form alike', () => {
    expect(structuralFingerprint(null)).toBe(structuralFingerprint(form([])))
  })
})

describe('hasStructuralChange — things that DO change the data', () => {
  const base = form([contactStep()])

  it('adding a field', () => {
    const next = form([contactStep({ extraFields: [{ internalKey: 'phone', type: 'tel' }] })])
    expect(hasStructuralChange(base, next)).toBe(true)
  })

  it('renaming a field key', () => {
    const next = form([{ key: 'contact', fields: [
      { internalKey: 'full_name', type: 'text', required: true },
      { internalKey: 'email', type: 'email', required: true },
    ] }])
    expect(hasStructuralChange(base, next)).toBe(true)
  })

  it('changing a field type', () => {
    const next = form([{ key: 'contact', fields: [
      { internalKey: 'name', type: 'textarea', required: true },
      { internalKey: 'email', type: 'email', required: true },
    ] }])
    expect(hasStructuralChange(base, next)).toBe(true)
  })

  it('making a field required', () => {
    const next = form([{ key: 'contact', fields: [
      { internalKey: 'name', type: 'text', required: true },
      { internalKey: 'email', type: 'email', required: false },
    ] }])
    expect(hasStructuralChange(base, next)).toBe(true)
  })

  it('adding an option value to a choice field', () => {
    const a = form([{ key: 's', fields: [{ internalKey: 'subject', type: 'radio-group', options: [{ value: 'a' }] }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'subject', type: 'radio-group', options: [{ value: 'a' }, { value: 'b' }] }] }])
    expect(hasStructuralChange(a, b)).toBe(true)
  })

  it('tightening validation bounds', () => {
    const a = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', minLength: 2 }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', minLength: 5 }] }])
    expect(hasStructuralChange(a, b)).toBe(true)
  })

  it('moving a field to a different step', () => {
    // The value now arrives in a different step, so past and future submissions
    // are not shaped the same.
    const a = form([{ key: 'one', fields: [{ internalKey: 'name', type: 'text' }] }, { key: 'two', fields: [] }])
    const b = form([{ key: 'one', fields: [] }, { key: 'two', fields: [{ internalKey: 'name', type: 'text' }] }])
    expect(hasStructuralChange(a, b)).toBe(true)
  })

  it('renaming a step key', () => {
    const a = form([{ key: 'contact', fields: [] }])
    const b = form([{ key: 'details', fields: [] }])
    expect(hasStructuralChange(a, b)).toBe(true)
  })
})

describe('hasStructuralChange — things that do NOT change the data', () => {
  it('fixing a typo in a label', () => {
    const a = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', label: { en: 'Naem' } }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', label: { en: 'Name' } }] }])
    expect(hasStructuralChange(a, b)).toBe(false)
  })

  it('adding a translation', () => {
    const a = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', label: { en: 'Name' } }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', label: { en: 'Name', it: 'Nome' } }] }])
    expect(hasStructuralChange(a, b)).toBe(false)
  })

  it('switching a radio group from a list to cards', () => {
    // Exactly the edit made to the WhatsApp form — presentation only.
    const a = form([{ key: 's', fields: [{ internalKey: 'subject', type: 'radio-group', options: [{ value: 'a' }] }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'subject', type: 'radio-group', display: 'cards', options: [{ value: 'a' }] }] }])
    expect(hasStructuralChange(a, b)).toBe(false)
  })

  it('changing a field width', () => {
    const a = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', width: '100%' }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'name', type: 'text', width: '50%' }] }])
    expect(hasStructuralChange(a, b)).toBe(false)
  })

  it('reordering the choices shown for one field', () => {
    // The accepted vocabulary is identical; only the on-screen order moved.
    const a = form([{ key: 's', fields: [{ internalKey: 'x', type: 'radio-group', options: [{ value: 'a' }, { value: 'b' }] }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'x', type: 'radio-group', options: [{ value: 'b' }, { value: 'a' }] }] }])
    expect(hasStructuralChange(a, b)).toBe(false)
  })

  it('editing placeholder and help text', () => {
    const a = form([{ key: 's', fields: [{ internalKey: 'n', type: 'text', placeholder: { en: 'x' }, help: { en: 'y' } }] }])
    const b = form([{ key: 's', fields: [{ internalKey: 'n', type: 'text', placeholder: { en: 'p' }, help: { en: 'h' } }] }])
    expect(hasStructuralChange(a, b)).toBe(false)
  })
})

describe('currentVersion', () => {
  it('reads a valid integer', () => {
    expect(currentVersion({ version: 4 })).toBe(4)
  })

  it('falls back to 1 for missing, zero, negative, or non-integer values', () => {
    for (const version of [undefined, null, 0, -3, 1.5, '7', {}]) {
      expect(currentVersion({ version } as never)).toBe(1)
    }
  })
})

describe('nextVersion', () => {
  const published = form([contactStep()], 3)

  it('is 1 for a form being published for the first time', () => {
    expect(nextVersion(null, form([contactStep()], 99))).toBe(1)
  })

  it('holds steady when only presentation changed', () => {
    const draft = form([{ key: 'contact', fields: [
      { internalKey: 'name', type: 'text', required: true, label: { en: 'Your name' } },
      { internalKey: 'email', type: 'email', required: true },
    ] }], 3)
    expect(nextVersion(published, draft)).toBe(3)
  })

  it('increments by one on a structural change', () => {
    const draft = form([contactStep({ extraFields: [{ internalKey: 'phone', type: 'tel' }] })], 3)
    expect(nextVersion(published, draft)).toBe(4)
  })

  it('cannot be lowered by a hand-edited draft value', () => {
    // The whole reason the field is read-only: the new value is derived from
    // the published document, never from what the draft claims.
    const draft = form([contactStep({ extraFields: [{ internalKey: 'phone', type: 'tel' }] })], 1)
    expect(nextVersion(published, draft)).toBe(4)
  })

  it('does not inflate when the same draft is published twice', () => {
    const draft = form([contactStep()], 3)
    const once = nextVersion(published, draft)
    const twice = nextVersion(form([contactStep()], once), draft)
    expect(once).toBe(3)
    expect(twice).toBe(3)
  })

  it('steps once per structural change, not once per publish', () => {
    let current = form([contactStep()], 1)
    const changed = form([contactStep({ extraFields: [{ internalKey: 'phone', type: 'tel' }] })], 1)

    const after = nextVersion(current, changed)
    expect(after).toBe(2)

    // Publishing the same shape again must not move it to 3.
    current = form([contactStep({ extraFields: [{ internalKey: 'phone', type: 'tel' }] })], after)
    expect(nextVersion(current, changed)).toBe(2)
  })
})
