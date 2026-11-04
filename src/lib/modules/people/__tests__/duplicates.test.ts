/**
 * "Anna Rossi is already in your People": the name match is case-, accent-,
 * punctuation- and whitespace-insensitive, in either order; a one-name person
 * matches only a one-name person; anonymised people never match, archived do.
 */
import { describe, it, expect } from 'vitest'
import { matchDuplicates, normalisePersonName, personNameKeys, DUPLICATE_RESULT_LIMIT, type DuplicateCandidate } from '../duplicates'

const person = (o: Partial<DuplicateCandidate> & { id: string }): DuplicateCandidate => ({
  publicId: `pub-${o.id}`,
  firstName: '',
  lastName: '',
  displayName: '',
  archived: false,
  anonymised: false,
  ...o,
})

describe('normalisePersonName', () => {
  it('folds case, accents, punctuation and spacing', () => {
    expect(normalisePersonName('  Zoë   O’Brien-Müller ')).toBe('zoe o brien muller')
    expect(normalisePersonName('JOSÉ')).toBe('jose')
    expect(normalisePersonName('Weiß')).toBe('weiss')
    expect(normalisePersonName('Łukasz')).toBe('łukasz')
  })
  it('is empty for non-text and blanks', () => {
    expect(normalisePersonName(undefined)).toBe('')
    expect(normalisePersonName(42)).toBe('')
    expect(normalisePersonName(' . - ')).toBe('')
  })
})

describe('personNameKeys', () => {
  it('has both orders for two names, one key for one name, none for nothing', () => {
    expect(personNameKeys('Anna', 'Rossi').sort()).toEqual(['anna rossi', 'rossi anna'])
    expect(personNameKeys('Madonna', '')).toEqual(['madonna'])
    expect(personNameKeys('', 'Madonna')).toEqual(['madonna'])
    expect(personNameKeys(' ', '')).toEqual([])
  })
})

describe('matchDuplicates', () => {
  const people = [
    person({ id: 'a', firstName: 'Anna', lastName: 'Rossi' }),
    person({ id: 'b', firstName: 'Zoë', lastName: 'Müller' }),
    person({ id: 'c', firstName: 'Madonna' }),
    person({ id: 'd', firstName: 'Anna', lastName: 'Rossi', anonymised: true }),
    person({ id: 'e', firstName: 'Luca', lastName: 'Bianchi', archived: true }),
    person({ id: 'f', firstName: 'Marta', lastName: 'Verdi', displayName: 'Dott.ssa Marta Verdi' }),
  ]
  const ids = (first: string, last: string, list = people) => matchDuplicates({ firstName: first, lastName: last }, list).map((d) => d.id)

  it('matches regardless of case, accents and spacing', () => {
    expect(ids('  ANNA ', 'rossi')).toEqual(['a'])
    expect(ids('Zoe', 'Muller')).toEqual(['b'])
    expect(ids('zoë', ' müller ')).toEqual(['b'])
  })
  it('matches first and last swapped', () => {
    expect(ids('Rossi', 'Anna')).toEqual(['a'])
    expect(ids('Müller', 'Zoe')).toEqual(['b'])
  })
  it('one-name people match only one-name people', () => {
    expect(ids('Madonna', '')).toEqual(['c'])
    expect(ids('', 'Madonna')).toEqual(['c'])
    expect(ids('Anna', '')).toEqual([])
    expect(ids('Madonna', 'Rossi')).toEqual([])
    // a typed one-name must not match a person that has two names
    expect(ids('Rossi', '')).toEqual([])
  })
  it('never matches an anonymised person, but does match an archived one', () => {
    expect(ids('Anna', 'Rossi')).toEqual(['a'])
    expect(ids('Luca', 'Bianchi')).toEqual(['e'])
    expect(matchDuplicates({ firstName: 'Luca', lastName: 'Bianchi' }, people)[0].archived).toBe(true)
  })
  it('also matches the display name; the label is the display name else first + last', () => {
    expect(matchDuplicates({ firstName: 'Dott.ssa Marta', lastName: 'Verdi' }, people)).toEqual([{ id: 'f', publicId: 'pub-f', name: 'Dott.ssa Marta Verdi', archived: false }])
    expect(matchDuplicates({ firstName: 'Anna', lastName: 'Rossi' }, people)[0].name).toBe('Anna Rossi')
  })
  it('nothing typed, nothing found', () => {
    expect(ids('', '')).toEqual([])
    expect(ids(' ', ' ')).toEqual([])
  })
  it('caps the answer', () => {
    const many = Array.from({ length: 20 }, (_, i) => person({ id: `p${i}`, firstName: 'Anna', lastName: 'Rossi' }))
    expect(ids('Anna', 'Rossi', many)).toHaveLength(DUPLICATE_RESULT_LIMIT)
  })
})
