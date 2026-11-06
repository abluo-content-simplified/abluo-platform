import { describe, expect, it } from 'vitest'
import { LANGUAGE_CODES, isLanguageCode, languageDisplayName, languageGroups } from '../language-model'

describe('language model', () => {
  it('lists ISO 639-1 codes once, two letters each', () => {
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length)
    expect(LANGUAGE_CODES.every((c) => /^[a-z]{2}$/.test(c))).toBe(true)
    expect(LANGUAGE_CODES.length).toBeGreaterThan(180)
    expect(isLanguageCode('ja')).toBe(true)
    expect(isLanguageCode('xx')).toBe(false)
  })
  it('names languages in the UI language', () => {
    expect(languageDisplayName('de', 'it')).toBe('tedesco')
    expect(languageDisplayName('de', 'en')).toBe('German')
    expect(languageDisplayName('FR!', 'en')).toBe('FR!')
  })
  it('puts the suggested languages first and searches by name or code', () => {
    const g = languageGroups('en', ['it', 'en'])
    expect(g.first.map((l) => l.code)).toEqual(['it', 'en'])
    expect(g.other.some((l) => l.code === 'it')).toBe(false)
    expect(g.other.length).toBe(LANGUAGE_CODES.length - 2)
    expect(languageGroups('en', ['it'], 'japan').other.map((l) => l.code)).toEqual(['ja'])
    expect(languageGroups('en', [], 'sw').other.some((l) => l.code === 'sw')).toBe(true)
  })
})
