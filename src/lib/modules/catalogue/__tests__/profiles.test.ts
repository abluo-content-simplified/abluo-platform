import { describe, expect, it } from 'vitest'
import { FOOD_PROFILE_GROQ, PROFILES, PROFILE_ORDER, can, isItemProfile, offeringOf, profileOf, profilesWith } from '../profiles'

describe('profile registry (ADR-033 Amendment I, slice 4a)', () => {
  it('defines four profiles, each keyed by its own id with an icon', () => {
    expect(Object.keys(PROFILES).sort()).toEqual(['book', 'foodOrDrink', 'product', 'service'])
    for (const [k, p] of Object.entries(PROFILES)) {
      expect(p.id).toBe(k)
      expect(p.icon).toBeTruthy()
    }
    expect(new Set(Object.values(PROFILES).map((p) => p.icon)).size).toBe(4)
  })

  it('keeps book out of the selectable order until slice 4b', () => {
    expect(PROFILE_ORDER).toEqual(['foodOrDrink', 'product', 'service'])
    expect(isItemProfile('book')).toBe(false)
    expect(isItemProfile('foodOrDrink')).toBe(true)
  })

  it('profileOf falls back to product for unknown or not-yet-selectable values', () => {
    expect(profileOf('service')).toBe('service')
    expect(profileOf('book')).toBe('product')
    expect(profileOf('nonsense')).toBe('product')
    expect(profileOf(undefined)).toBe('product')
  })

  it('can / offeringOf / profilesWith', () => {
    expect(can('foodOrDrink', 'foodInformation')).toBe(true)
    expect(can('product', 'foodInformation')).toBe(false)
    expect(can('book', 'foodInformation')).toBe(false)
    expect(can('book', 'bookDetails')).toBe(true)
    expect(offeringOf('foodOrDrink', 'options')).toBe('default')
    expect(offeringOf('product', 'options')).toBe('onDemand')
    expect(profilesWith('foodInformation')).toEqual(['foodOrDrink'])
    expect(FOOD_PROFILE_GROQ).toBe('itemProfile == "foodOrDrink"')
  })

  it('maps profiles to their JSON-LD page type; Book needs no offer', () => {
    expect(PROFILES.foodOrDrink.jsonLd.itemPage).toBe('Product')
    expect(PROFILES.service.jsonLd.itemPage).toBe('Service')
    expect(PROFILES.book.jsonLd).toEqual({ itemPage: 'Book', needsOffer: false })
  })
})
