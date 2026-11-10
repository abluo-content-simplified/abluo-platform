import { describe, it, expect } from 'vitest'
import { resolveSuccessTitle, defaultSuccessBody, applySuccessTemplate, MAX_FIRST_NAME_LENGTH } from '@/lib/forms/render-mapping'
import { getFormSectionMessages } from '@/lib/i18n/form-section-messages'

const en = getFormSectionMessages('en').successTitleNamed
const it_ = getFormSectionMessages('it').successTitleNamed

describe('resolveSuccessTitle (default personalized thank-you)', () => {
  it('greets the visitor by first name when a name was given', () => {
    expect(resolveSuccessTitle(undefined, en, { name: '  Anna Rossi ' })).toBe('Thank you, Anna!')
    expect(resolveSuccessTitle(undefined, it_, { name: 'Anna' })).toBe('Grazie, Anna!')
  })

  it('shows no title when the name was left empty or blank', () => {
    expect(resolveSuccessTitle(undefined, en, { name: '' })).toBeUndefined()
    expect(resolveSuccessTitle(undefined, en, { name: '   ' })).toBeUndefined()
  })

  it('shows no title when the form has no name field', () => {
    expect(resolveSuccessTitle(undefined, en, { email: 'a@b.it' })).toBeUndefined()
    expect(resolveSuccessTitle('', en, { email: 'a@b.it' })).toBeUndefined()
  })

  it("lets the form's own successTitle override the default", () => {
    expect(resolveSuccessTitle('See you soon, {first_name}', en, { name: 'Anna' })).toBe('See you soon, Anna')
    expect(resolveSuccessTitle('Request received', en, {})).toBe('Request received')
  })

  it('caps a very long name and keeps it as plain text', () => {
    const long = 'A'.repeat(500)
    const title = resolveSuccessTitle(undefined, en, { name: long })!
    expect(title).toBe(`Thank you, ${'A'.repeat(MAX_FIRST_NAME_LENGTH)}…!`)
    // Markup in a name is returned verbatim as a string (React escapes it on render).
    expect(resolveSuccessTitle(undefined, en, { name: '<b>Anna</b>' })).toBe('Thank you, <b>Anna</b>!')
  })

  it('has a named default in every supported website locale', () => {
    for (const loc of ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt']) {
      expect(getFormSectionMessages(loc).successTitleNamed).toContain('{first_name}')
    }
  })

  it('finds the name under other common keys (Hoffmann: nome)', () => {
    expect(resolveSuccessTitle(undefined, it_, { nome: 'Claudia', cognome: 'Hoffmann' })).toBe('Grazie, Claudia!')
    expect(resolveSuccessTitle(undefined, en, { first_name: 'Anna', last_name: 'Rossi' })).toBe('Thank you, Anna!')
    expect(applySuccessTemplate('Hi {first_name}', { vorname: 'Jens' })).toBe('Hi Jens')
    // `name` wins when both are filled; an empty `name` falls through to the next key.
    expect(resolveSuccessTitle(undefined, en, { name: 'Anna', nome: 'Claudia' })).toBe('Thank you, Anna!')
    expect(resolveSuccessTitle(undefined, en, { name: '  ', nome: 'Claudia' })).toBe('Thank you, Claudia!')
  })

  it('does not thank the visitor twice: under a title the default body drops its "Thank you!"', () => {
    for (const loc of ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt']) {
      const m = getFormSectionMessages(loc)
      expect(defaultSuccessBody('Thank you, Anna!', m)).toBe(m.successMessageSent)
      expect(defaultSuccessBody(undefined, m)).toBe(m.successMessage)
      expect(m.successMessageSent.length).toBeGreaterThan(0)
    }
    expect(defaultSuccessBody('Thank you, Anna!', getFormSectionMessages('en'))).toBe('Your message has been sent.')
  })
})
