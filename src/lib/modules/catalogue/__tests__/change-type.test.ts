import { describe, expect, it } from 'vitest'
import { changeTypeWarning } from '../change-type'
import { PROFILE_ORDER } from '../profiles'

const w = (from: Parameters<typeof changeTypeWarning>[0]['from'], to: Parameters<typeof changeTypeWarning>[0]['to'], hasBookDetails = false) => changeTypeWarning({ from, to, hasBookDetails })

describe('changeTypeWarning (Amendment I-4.2)', () => {
  it('warns about allergens when leaving food, whatever the target', () => {
    expect(w('foodOrDrink', 'product')).toBe('allergens')
    expect(w('foodOrDrink', 'service')).toBe('allergens')
    expect(w('foodOrDrink', 'book')).toBe('allergens')
  })
  it('gives the lighter book note only when details are filled and the book is left', () => {
    expect(w('book', 'product', true)).toBe('bookDetails')
    expect(w('book', 'foodOrDrink', true)).toBe('bookDetails')
    expect(w('book', 'product', false)).toBeNull()
  })
  it('does not warn for other changes or for the same type', () => {
    expect(w('product', 'foodOrDrink')).toBeNull()
    expect(w('product', 'book', true)).toBeNull()
    expect(w('service', 'product')).toBeNull()
    expect(w(null, 'book')).toBeNull()
    for (const p of PROFILE_ORDER) expect(w(p, p, true)).toBeNull()
  })
})
