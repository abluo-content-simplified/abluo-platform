import { describe, expect, it } from 'vitest'
import { REFERENCE_ALPHABET, cleanProjectCode, generateReference, isValidReferenceFormat, normaliseReference } from '../reference'

const seq = (...n: number[]) => { let i = 0; return () => n[i++ % n.length] }

describe('alphabet', () => {
  it('has no ambiguous characters', () => {
    for (const c of '0O1IL') expect(REFERENCE_ALPHABET).not.toContain(c)
    expect(new Set(REFERENCE_ALPHABET).size).toBe(REFERENCE_ALPHABET.length)
  })
})

describe('generateReference', () => {
  it('builds PREFIX-BODY from the random source', () => {
    expect(generateReference('cyce', seq(0, 1, 2, 3, 4))).toBe('CYCE-ABCDE')
  })
  it('cleans and truncates the project code', () => {
    expect(cleanProjectCode(' ch-psico terapeuta ')).toBe('CHPSIC')
    expect(generateReference('a.b', seq(0))).toBe('AB-AAAAA')
  })
  it('rejects an empty code and bad random values', () => {
    expect(() => generateReference('---', seq(0))).toThrow()
    expect(() => generateReference('X', () => REFERENCE_ALPHABET.length)).toThrow()
    expect(() => generateReference('X', () => 1.5)).toThrow()
  })
  it('supports body lengths 4-6 only', () => {
    expect(generateReference('X', seq(0), 4)).toBe('X-AAAA')
    expect(generateReference('X', seq(0), 6)).toBe('X-AAAAAA')
    expect(() => generateReference('X', seq(0), 3)).toThrow()
    expect(() => generateReference('X', seq(0), 7)).toThrow()
  })
  it('default random source yields valid references', () => {
    for (let i = 0; i < 50; i++) expect(isValidReferenceFormat(generateReference('CYCE'))).toBe(true)
  })
})

describe('isValidReferenceFormat', () => {
  it('accepts canonical references', () => {
    expect(isValidReferenceFormat('CYCE-7K2MQ')).toBe(true)
    expect(isValidReferenceFormat('A1-ABCD')).toBe(true)
  })
  it('rejects wrong shapes and ambiguous characters', () => {
    for (const bad of ['cyce-7k2mq', 'CYCE7K2MQ', 'CYCE-7K2M0', 'CYCE-7K2MO', 'CYCE-7K2M1', 'CYCE-ABC', 'CYCE-ABCDEFG', 'TOOLONGX-ABCDE', '-ABCDE', ''])
      expect(isValidReferenceFormat(bad)).toBe(false)
  })
})

describe('normaliseReference', () => {
  it('trims, upper-cases and unifies separators', () => {
    expect(normaliseReference('  cyce-7k2mq ')).toBe('CYCE-7K2MQ')
    expect(normaliseReference('cyce 7k2mq')).toBe('CYCE-7K2MQ')
    expect(normaliseReference('CYCE–7K2MQ')).toBe('CYCE-7K2MQ')
    expect(normaliseReference('CYCE_  -7K2MQ')).toBe('CYCE-7K2MQ')
  })
  it('is idempotent and leaves confusable characters alone', () => {
    const once = normaliseReference('cyce 7k2m0')
    expect(once).toBe('CYCE-7K2M0')
    expect(normaliseReference(once)).toBe(once)
    expect(isValidReferenceFormat(once)).toBe(false)
  })
})
