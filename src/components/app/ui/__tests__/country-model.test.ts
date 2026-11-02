import { describe, expect, it } from 'vitest'
import { COUNTRY_CODES, EU_COUNTRY_CODES, countryGroups, countryName, foldText, isCountryCode, isEuCountry, matchesCountry } from '../country-model'

describe('country list', () => {
  it('holds all 249 ISO 3166-1 alpha-2 codes, unique and upper-case', () => {
    expect(COUNTRY_CODES).toHaveLength(249)
    expect(new Set(COUNTRY_CODES).size).toBe(249)
    for (const c of COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/)
    expect(isCountryCode('IT')).toBe(true)
    expect(isCountryCode('EL')).toBe(false)
    expect(isCountryCode('it')).toBe(false)
  })
  it('the 27 EU member states are all in the list', () => {
    expect(EU_COUNTRY_CODES).toHaveLength(27)
    for (const c of EU_COUNTRY_CODES) expect(isCountryCode(c)).toBe(true)
    expect(isEuCountry('GR')).toBe(true)
    expect(isEuCountry('GB')).toBe(false)
    expect(isEuCountry('CH')).toBe(false)
  })
})

describe('countryName', () => {
  it('localises with Intl.DisplayNames', () => {
    expect(countryName('IT', 'it')).toBe('Italia')
    expect(countryName('DE', 'de')).toBe('Deutschland')
    expect(countryName('DE', 'en')).toBe('Germany')
    expect(countryName('it', 'en')).toBe('Italy')
  })
  it('never throws on odd input', () => {
    expect(countryName('???', 'en')).toBe('???')
    expect(countryName('IT', 'not a locale!')).toBeTypeOf('string')
  })
})

describe('countryGroups', () => {
  it('EU first, then the rest; each sorted by localised name', () => {
    const { eu, other } = countryGroups('de')
    expect(eu).toHaveLength(27)
    expect(other).toHaveLength(249 - 27)
    const names = eu.map((c) => c.name)
    expect(names).toEqual([...names].sort(new Intl.Collator('de', { sensitivity: 'base' }).compare))
    // Österreich sorts with O in German, after Niederlande and before Polen.
    expect(names.indexOf('Österreich')).toBeGreaterThan(names.indexOf('Niederlande'))
    expect(names.indexOf('Österreich')).toBeLessThan(names.indexOf('Polen'))
    expect(other.some((c) => c.code === 'CH')).toBe(true)
  })
  it('search matches the localised name (accents ignored) or the code', () => {
    expect(countryGroups('de', 'osterr').eu.map((c) => c.code)).toEqual(['AT'])
    expect(countryGroups('it', 'germ').eu.map((c) => c.code)).toEqual(['DE'])
    const byCode = countryGroups('en', 'ch')
    expect(byCode.other.map((c) => c.code)).toContain('CH')
    expect(countryGroups('en', 'zzzz')).toEqual({ eu: [], other: [] })
  })
  it('matchesCountry and foldText', () => {
    expect(foldText(' Österreich ')).toBe('osterreich')
    expect(matchesCountry({ code: 'IT', name: 'Italy' }, '')).toBe(true)
    expect(matchesCountry({ code: 'IT', name: 'Italy' }, 'it')).toBe(true)
    expect(matchesCountry({ code: 'FR', name: 'France' }, 'it')).toBe(false)
  })
})
