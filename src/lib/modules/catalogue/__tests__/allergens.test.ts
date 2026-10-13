import { describe, expect, it } from 'vitest'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'
import { ALLERGENS, isAllergenKey, unknownAllergenKeys } from '../allergens'

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
