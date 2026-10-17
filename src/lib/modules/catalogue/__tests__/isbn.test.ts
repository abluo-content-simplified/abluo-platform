import { describe, expect, it } from 'vitest'
import { bookYearMax, bookYearProblem, isValidIsbn, normalizeIsbn, parseBookYear } from '../isbn'

describe('ISBN (Amendment I-3.3)', () => {
  it('normalises spaces and hyphens away and upper-cases x', () => {
    expect(normalizeIsbn(' 978-0-345 39180-3 ')).toBe('9780345391803')
    expect(normalizeIsbn('0-8044-2957-x')).toBe('080442957X')
    expect(normalizeIsbn(undefined)).toBe('')
    expect(normalizeIsbn(42)).toBe('')
  })

  it('accepts a valid ISBN-13, with or without hyphens', () => {
    expect(isValidIsbn('9780345391803')).toBe(true)
    expect(isValidIsbn('978-0-345-39180-3')).toBe(true)
    expect(isValidIsbn('9788804668237')).toBe(true)
  })

  it('accepts a valid ISBN-10, including an X check digit', () => {
    expect(isValidIsbn('0345391802')).toBe(true)
    expect(isValidIsbn('0-8044-2957-X')).toBe(true)
    expect(isValidIsbn('080442957x')).toBe(true)
  })

  it('rejects a wrong check digit, a wrong length, letters and an empty value', () => {
    expect(isValidIsbn('9780345391804')).toBe(false)
    expect(isValidIsbn('0345391803')).toBe(false)
    expect(isValidIsbn('978034539180')).toBe(false)
    expect(isValidIsbn('12345')).toBe(false)
    expect(isValidIsbn('97803453918A3')).toBe(false)
    expect(isValidIsbn('X345391802')).toBe(false)
    expect(isValidIsbn('')).toBe(false)
    expect(isValidIsbn(null)).toBe(false)
  })

  it('an ISBN-13 must start with 978 or 979', () => {
    expect(isValidIsbn('9770345391808')).toBe(false)
  })
})

describe('book year (Amendment I-3.2)', () => {
  const now = new Date('2026-10-17T00:00:00Z')
  it('is a whole number from 1000 to next year', () => {
    expect(parseBookYear(1979, now)).toBe(1979)
    expect(parseBookYear('1979', now)).toBe(1979)
    expect(parseBookYear(' 2027 ', now)).toBe(2027)
    expect(bookYearMax(now)).toBe(2027)
    expect(parseBookYear(1000, now)).toBe(1000)
  })
  it('refuses out of range, fractions, text and blank', () => {
    for (const v of [999, 2028, 1979.5, 'c. 1950', '19 79', '', null, undefined, NaN, '-1979']) expect(parseBookYear(v, now)).toBeNull()
  })
  it('a problem is something typed that is not acceptable; blank is never a problem', () => {
    expect(bookYearProblem('', now)).toBe(false)
    expect(bookYearProblem('   ', now)).toBe(false)
    expect(bookYearProblem(undefined, now)).toBe(false)
    expect(bookYearProblem('19', now)).toBe(true)
    expect(bookYearProblem('1979', now)).toBe(false)
  })
})
