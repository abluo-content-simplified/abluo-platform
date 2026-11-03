import { describe, expect, it } from 'vitest'
import { contactProblem, contactsSignature, publishBlockers, savableContacts, suggestSlug, type ContactRow } from '../person-editor'

const row = (over: Partial<ContactRow>): ContactRow => ({ _key: 'k1', kind: 'email', value: '', label: '', preferred: false, visibility: 'private', ...over })

describe('contactProblem', () => {
  it('accepts what the server accepts', () => {
    expect(contactProblem('email', 'anna@example.com')).toBeNull()
    expect(contactProblem('phone', '+39 0544 123456')).toBeNull()
    expect(contactProblem('whatsapp', '+393331234567')).toBeNull()
    expect(contactProblem('instagram', '@anna.b')).toBeNull()
    expect(contactProblem('linkedin', 'https://linkedin.com/in/anna')).toBeNull()
    expect(contactProblem('website', 'https://example.com')).toBeNull()
  })
  it('names the problem', () => {
    expect(contactProblem('email', '   ')).toBe('empty')
    expect(contactProblem('email', 'anna@')).toBe('email')
    expect(contactProblem('phone', 'call me')).toBe('phone')
    expect(contactProblem('instagram', 'not a handle')).toBe('handle')
    expect(contactProblem('url', 'example.com')).toBe('url')
  })
})

describe('savableContacts', () => {
  const rows = [
    row({ _key: 'a', value: 'anna@example.com', visibility: 'public', label: ' Work ' }),
    row({ _key: 'b', value: 'half@', visibility: 'public' }),
    row({ _key: 'c', kind: 'phone', value: '+39 333 1234567', visibility: 'private' }),
    row({ _key: 'd', value: '', visibility: 'private' }),
  ]
  it('keeps only valid rows of the side, trimmed', () => {
    expect(savableContacts(rows, 'public')).toEqual([{ _key: 'a', kind: 'email', value: 'anna@example.com', label: 'Work', preferred: false }])
    expect(savableContacts(rows, 'private').map((c) => c._key)).toEqual(['c'])
  })
  it('signatures differ when anything saved changes', () => {
    const a = contactsSignature(savableContacts(rows, 'public'))
    const b = contactsSignature(savableContacts([{ ...rows[0], preferred: true }], 'public'))
    expect(a).not.toBe(b)
    expect(contactsSignature(savableContacts(rows, 'public'))).toBe(a)
  })
})

describe('publishBlockers', () => {
  const base = { slug: {}, defaultLocale: 'it', firstName: 'Anna', lastName: 'Bianchi' }
  it('a person with their own page needs a web address in the main language', () => {
    expect(publishBlockers({ ...base, visibility: 'page' })).toEqual([{ id: 'slug', locale: 'it' }])
    expect(publishBlockers({ ...base, visibility: 'page', slug: { it: 'anna' } })).toEqual([])
    expect(publishBlockers({ ...base, visibility: 'page', slug: { de: 'anna' } })).toEqual([{ id: 'slug', locale: 'it' }])
  })
  it('listed or hidden people need nothing more', () => {
    expect(publishBlockers({ ...base, visibility: 'listed' })).toEqual([])
    expect(publishBlockers({ ...base, visibility: 'off' })).toEqual([])
  })
})

describe('suggestSlug', () => {
  it('drops accents and punctuation', () => {
    expect(suggestSlug('Zoé', "D'Angelo")).toBe('zoe-d-angelo')
    expect(suggestSlug('  ', ' ')).toBe('')
  })
})
