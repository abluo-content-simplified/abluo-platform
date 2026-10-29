import { describe, expect, it } from 'vitest'
import { cleanPrefill } from '../client-form'

describe('cleanPrefill', () => {
  it('keeps plain text, takes the first of many, trims and limits', () => {
    expect(cleanPrefill('  Hello  ', 50)).toBe('Hello')
    expect(cleanPrefill(['a', 'b'], 50)).toBe('a')
    expect(cleanPrefill('abcdef', 3)).toBe('abc')
  })
  it('drops control characters and empty values', () => {
    expect(cleanPrefill('a\u0000b\u0007c', 50)).toBe('abc')
    expect(cleanPrefill('   ', 50)).toBeUndefined()
    expect(cleanPrefill(undefined, 50)).toBeUndefined()
  })
  it('does not interpret markup (it stays text)', () => {
    expect(cleanPrefill('<img src=x onerror=alert(1)>', 120)).toBe('<img src=x onerror=alert(1)>')
  })
})
