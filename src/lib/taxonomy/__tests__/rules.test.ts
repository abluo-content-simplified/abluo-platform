import { describe, it, expect } from 'vitest'
import { deriveTermKey, keyChangeIssue, labelIssues, termLimitIssue, nextOrder, isKindDeclared, termIsRoutable, MAX_TERMS_PER_KIND, MAX_LABEL_LENGTH } from '../rules'
import { isValidTermKey } from '../ids'

describe('deriveTermKey', () => {
  it('slugifies like the vocabulary editor', () => {
    expect(deriveTermKey('Science Fiction')).toBe('science_fiction')
    expect(deriveTermKey('Prevéntivo')).toBe('preventivo')
  })
  it('adds a numeric suffix on collision', () => {
    expect(deriveTermKey('Humour', ['humour'])).toBe('humour_2')
    expect(deriveTermKey('Humour', ['humour', 'humour_2'])).toBe('humour_3')
  })
  it('falls back to "term" for labels without latin characters, and always yields a valid key', () => {
    expect(deriveTermKey('日本語')).toBe('term')
    expect(deriveTermKey('日本語', ['term'])).toBe('term_2')
    expect(isValidTermKey(deriveTermKey('x'.repeat(200)))).toBe(true)
    expect(isValidTermKey(deriveTermKey('!!!'))).toBe(true)
  })
})

describe('rules', () => {
  it('key immutability', () => {
    expect(keyChangeIssue('a', 'a')).toBeNull()
    expect(keyChangeIssue('a', undefined)).toBeNull()
    expect(keyChangeIssue('a', 'b')?.code).toBe('key-immutable')
  })
  it('default label required, length bounded', () => {
    expect(labelIssues({ it: 'Ciao' }, 'en').map((i) => i.code)).toEqual(['label-required'])
    expect(labelIssues({ en: '  ' }, 'en').map((i) => i.code)).toEqual(['label-required'])
    expect(labelIssues({ en: 'ok' }, 'en')).toEqual([])
    expect(labelIssues({ en: 'x'.repeat(MAX_LABEL_LENGTH + 1) }, 'en').map((i) => i.code)).toEqual(['label-too-long'])
    expect(labelIssues(undefined, 'en')).toHaveLength(1)
  })
  it('limit', () => {
    expect(termLimitIssue(MAX_TERMS_PER_KIND - 1)).toBeNull()
    expect(termLimitIssue(MAX_TERMS_PER_KIND)?.code).toBe('too-many-terms')
  })
  it('nextOrder spaces by 1000', () => {
    expect(nextOrder([])).toBe(1000)
    expect(nextOrder([1000, 3000, 2000])).toBe(4000)
  })
  it('kinds declared per module', () => {
    expect(isKindDeclared([{ kind: 'category' }], 'category')).toBe(true)
    expect(isKindDeclared([{ kind: 'category' }], 'tag')).toBe(false)
    expect(isKindDeclared(undefined, 'category')).toBe(false)
  })
  it('routing fields only for routable module categories', () => {
    expect(termIsRoutable('blog', 'category')).toBe(true)
    expect(termIsRoutable('catalogue', 'category')).toBe(false)
    expect(termIsRoutable('blog', 'tag')).toBe(false)
  })
})
