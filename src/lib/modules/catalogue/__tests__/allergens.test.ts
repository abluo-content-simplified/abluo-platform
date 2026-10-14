import { describe, expect, it } from 'vitest'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'
import { ALLERGENS, allergenDeclarationIssues, describeDeclarationIssue, isAllergenKey, isFreeTextAddChoice, isPublishableDeclaration, optionDeclarationIssues, unknownAllergenKeys, unreviewedChoices } from '../allergens'

describe('EU allergens (ADR-033 C3)', () => {
  it('is exactly the fourteen of Reg. 1169/2011 Annex II, in order', () => {
    expect(ALLERGENS).toEqual([
      'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
      'treeNuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs',
    ])
    expect(new Set(ALLERGENS).size).toBe(14)
  })

  it('cannot be extended or trimmed at runtime', () => {
    expect(Object.isFrozen(ALLERGENS)).toBe(true)
    expect(() => (ALLERGENS as unknown as string[]).push('x')).toThrow()
  })

  it('recognises keys and reports unknown ones', () => {
    expect(isAllergenKey('milk')).toBe(true)
    expect(isAllergenKey('latte')).toBe(false)
    expect(unknownAllergenKeys(['milk', 'latte', 3])).toEqual(['latte', 3])
    expect(unknownAllergenKeys(undefined)).toEqual([])
  })

  it.each([['en', en], ['it', it_], ['de', de]] as const)('%s has a non-empty label for every allergen', (_l, messages) => {
    const labels = (messages as { catalogue?: { allergens?: Record<string, string> } }).catalogue?.allergens ?? {}
    for (const key of ALLERGENS) expect(labels[key]?.trim(), key).toBeTruthy()
    expect(Object.keys(labels).sort()).toEqual([...ALLERGENS].sort())
  })
})

describe('allergen declaration (ADR-033 D-3)', () => {
  it('notReviewed is a valid draft but never publishable', () => {
    expect(allergenDeclarationIssues({ status: 'notReviewed' })).toEqual(['notReviewed'])
    expect(allergenDeclarationIssues(undefined)).toEqual(['missing'])
    expect(isPublishableDeclaration({ status: 'notReviewed' })).toBe(false)
  })
  it('contains requires ≥ 1 allergen ("may contain" alone is not enough); an empty array never means none', () => {
    expect(allergenDeclarationIssues({ status: 'containsListedAllergens', allergens: [] })).toEqual(['noAllergens'])
    expect(allergenDeclarationIssues({ status: 'containsListedAllergens', allergens: [], mayContain: ['milk'] })).toEqual(['noAllergens'])
    expect(isPublishableDeclaration({ status: 'containsListedAllergens', allergens: ['milk'], mayContain: ['sesame'] })).toBe(true)
  })
  it('noneDeclared requires the explicit confirmation', () => {
    expect(allergenDeclarationIssues({ status: 'noneDeclared' })).toEqual(['notConfirmed'])
    expect(allergenDeclarationIssues({ status: 'noneDeclared', confirmed: 'yes' })).toEqual(['notConfirmed'])
    expect(isPublishableDeclaration({ status: 'noneDeclared', confirmed: true, note: { it: 'x' } })).toBe(true)
  })
  it('unknown statuses, allergen keys and fields are refused', () => {
    expect(allergenDeclarationIssues({ status: 'allergenFree' })).toEqual(['unknownStatus'])
    expect(allergenDeclarationIssues({ status: 'containsListedAllergens', allergens: ['milk', 'coffee'] })).toEqual(['unknownKey'])
    expect(allergenDeclarationIssues({ status: 'containsListedAllergens', allergens: ['milk'], mayContain: ['coffee'] })).toEqual(['unknownKey'])
    expect(allergenDeclarationIssues({ status: 'noneDeclared', confirmed: true, glutenFree: true })).toEqual(['unexpectedField'])
  })
  it('a field of another status left behind by Studio is tolerated (it is never read); Sanity keys are ignored', () => {
    expect(allergenDeclarationIssues({ _type: 'object', status: 'noneDeclared', confirmed: true, allergens: ['milk'] })).toEqual([])
  })
  it('every issue has Studio text', () => {
    for (const i of ['missing', 'notReviewed', 'unknownStatus', 'unknownKey', 'noAllergens', 'notConfirmed', 'unexpectedField'] as const) expect(describeDeclarationIssue(i)).toMatch(/\w/)
  })
})

describe('option choice declarations (ADR-033 D-3a)', () => {
  it('the same explicit states, without a note', () => {
    expect(optionDeclarationIssues({ status: 'containsListedAllergens', allergens: ['milk'] })).toEqual([])
    expect(optionDeclarationIssues({ status: 'noneDeclared', confirmed: true })).toEqual([])
    expect(optionDeclarationIssues({ status: 'noneDeclared', confirmed: true, note: { it: 'x' } })).toEqual(['unexpectedField'])
    expect(optionDeclarationIssues({ status: 'notReviewed' })).toEqual(['notReviewed'])
    expect(optionDeclarationIssues(undefined)).toEqual(['missing'])
  })
  it('only free-text "add" choices carry their own; remove and linked choices never', () => {
    expect(isFreeTextAddChoice({ kind: 'add' })).toBe(true)
    expect(isFreeTextAddChoice({})).toBe(true)
    expect(isFreeTextAddChoice({ kind: 'remove' })).toBe(false)
    expect(isFreeTextAddChoice({ kind: 'add', item: { _ref: 'x' } })).toBe(false)
  })
  it('unreviewedChoices: free-text add choices whose declaration is not publishable', () => {
    const opts = [
      { _key: 'a', allergenDeclaration: { status: 'notReviewed' } },
      { _key: 'b' },
      { _key: 'c', allergenDeclaration: { status: 'containsListedAllergens', allergens: [] } },
      { _key: 'd', allergenDeclaration: { status: 'containsListedAllergens', allergens: ['fish'] } },
      { _key: 'e', kind: 'remove' },
      { _key: 'f', item: { _ref: 'x' } },
    ]
    expect(unreviewedChoices(opts).map((o) => o._key)).toEqual(['a', 'b', 'c'])
    expect(unreviewedChoices(undefined)).toEqual([])
  })
})

describe('"none declared" may carry "may contain" (ADR-033 E-1)', () => {
  it('for items and option choices alike; unknown keys refused', () => {
    expect(allergenDeclarationIssues({ status: 'noneDeclared', confirmed: true, mayContain: ['treeNuts'] })).toEqual([])
    expect(optionDeclarationIssues({ status: 'noneDeclared', confirmed: true, mayContain: ['treeNuts'] })).toEqual([])
    expect(allergenDeclarationIssues({ status: 'noneDeclared', confirmed: true, mayContain: ['coffee'] })).toEqual(['unknownKey'])
    expect(allergenDeclarationIssues({ status: 'noneDeclared', mayContain: ['milk'] })).toEqual(['notConfirmed'])
  })
})
