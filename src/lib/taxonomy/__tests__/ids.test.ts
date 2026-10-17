import { describe, it, expect } from 'vitest'
import { termId, parseTermId, isValidTermKey, termIdPartIssues } from '../ids'

const parts = { projectSlug: 'tmz', module: 'catalogue', kind: 'category' as const, key: 'science_fiction' }

describe('termId', () => {
  it('builds the deterministic id', () => {
    expect(termId(parts)).toBe('term.tmz.catalogue.category.science_fiction')
  })
  it('round-trips through parseTermId, tolerating a drafts. prefix', () => {
    expect(parseTermId(termId(parts))).toEqual(parts)
    expect(parseTermId('drafts.' + termId(parts))).toEqual(parts)
  })
  it('rejects every malformed part rather than building a lookalike', () => {
    for (const bad of [
      { ...parts, projectSlug: 'a.b' },
      { ...parts, projectSlug: '' },
      { ...parts, module: 'Cat' },
      { ...parts, kind: 'topic' as never },
      { ...parts, key: 'has.dot' },
      { ...parts, key: 'UPPER' },
      { ...parts, key: 'x'.repeat(49) },
    ]) {
      expect(() => termId(bad)).toThrow()
      expect(termIdPartIssues(bad).length).toBeGreaterThan(0)
    }
  })
  it('parse returns null for non-term ids', () => {
    for (const id of ['post.1', 'term.tmz.catalogue.category', 'term.tmz.catalogue.topic.x', 'term.a.b.category.c.d']) {
      expect(parseTermId(id)).toBeNull()
    }
  })
  it('key validation', () => {
    expect(isValidTermKey('fantasy')).toBe(true)
    expect(isValidTermKey('sci-fi_2')).toBe(true)
    expect(isValidTermKey('_x')).toBe(false)
    expect(isValidTermKey('a__b')).toBe(false)
    expect(isValidTermKey(5)).toBe(false)
  })
})
