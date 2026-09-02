import { describe, it, expect } from 'vitest'
import { formFromTemplate, uniqueFormId } from '../template-clone'

// A trimmed stand-in for a published template document.
const TEMPLATE = {
  _id: 'formDefinition-template-contact-basic',
  _rev: 'abc123',
  _createdAt: '2026-08-14T13:24:04Z',
  _updatedAt: '2026-08-14T13:24:04Z',
  _system: { base: { id: 'x', rev: 'y' } },
  _type: 'formDefinition',
  formId: 'contact',
  internalName: 'Basic contact form',
  role: 'template',
  version: 7,
  steps: [{ _key: 's_contact', _type: 'formStep', key: 'contact', fields: [] }],
}

describe('uniqueFormId', () => {
  it('returns the root when nothing is taken', () => {
    expect(uniqueFormId('contact', new Set())).toBe('contact')
  })

  it('suffixes when the root is taken', () => {
    expect(uniqueFormId('contact', new Set(['contact']))).toBe('contact-2')
  })

  it('skips over taken suffixes', () => {
    expect(uniqueFormId('contact', new Set(['contact', 'contact-2', 'contact-3']))).toBe('contact-4')
  })

  it('strips an existing numeric suffix before searching', () => {
    // Cloning "contact-2" should give "contact-3", never "contact-2-2".
    expect(uniqueFormId('contact-2', new Set(['contact', 'contact-2']))).toBe('contact-3')
  })

  it('falls back to a usable id when the base is empty', () => {
    expect(uniqueFormId('', new Set())).toBe('form')
  })
})

describe('formFromTemplate', () => {
  const clone = formFromTemplate(TEMPLATE, 'livener', 'livener', 'contact')

  it('assigns the target tenant', () => {
    // The whole point of the guard: a clone belongs to exactly one tenant, and
    // never to the one whose template it came from.
    expect(clone.tenantSlug).toBe('livener')
  })

  it('becomes an active form, not another template', () => {
    expect(clone.role).toBe('active')
  })

  it('drops every Sanity metadata key so a new document is created', () => {
    for (const key of ['_id', '_rev', '_createdAt', '_updatedAt', '_system']) {
      expect(clone, key).not.toHaveProperty(key)
    }
  })

  it('keeps _type so the document is still a formDefinition', () => {
    expect(clone._type).toBe('formDefinition')
  })

  it('restarts versioning at 1 rather than inheriting the template version', () => {
    expect(clone.version).toBe(1)
  })

  it('takes the formId it is given, not the template one', () => {
    expect(formFromTemplate(TEMPLATE, 'livener', 'livener', 'contact-2').formId).toBe('contact-2')
  })

  it('names the clone for its tenant so the list is readable', () => {
    expect(clone.internalName).toBe('Basic contact form (livener)')
  })

  it('carries content fields through untouched', () => {
    expect(clone.steps).toEqual(TEMPLATE.steps)
  })

  it('carries unknown fields through, so new schema fields need no change here', () => {
    const extended = { ...TEMPLATE, someFutureField: { nested: true } }
    expect(formFromTemplate(extended, 'livener', 'livener', 'contact')).toHaveProperty(
      'someFutureField',
      { nested: true }
    )
  })

  it('omits projectSlug when none is given rather than writing undefined', () => {
    expect(formFromTemplate(TEMPLATE, 'livener', undefined, 'contact')).not.toHaveProperty('projectSlug')
  })

  it('does not mutate the template it was given', () => {
    const before = JSON.parse(JSON.stringify(TEMPLATE))
    formFromTemplate(TEMPLATE, 'other-tenant', 'other-main', 'x')
    expect(TEMPLATE).toEqual(before)
  })
})
