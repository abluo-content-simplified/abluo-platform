/** Catalogue category vocabulary: term records win entirely, else the config list (ADR-033 Amendment J, J-8). */
import { describe, expect, it } from 'vitest'
import { catalogueCategoryTermsGroq, catalogueCategoryVocabulary, termsToEntries } from '../vocabulary'

const CONFIG = [
  { _key: 'a', value: 'pizza', label: { it: 'Pizze' }, color: '#c00' },
  { _key: 'b', value: 'dolci', label: { it: 'Dolci' } },
]

describe('catalogueCategoryVocabulary', () => {
  it('falls back to the config list, returned untouched, when there are no terms', () => {
    for (const none of [undefined, null, []]) expect(catalogueCategoryVocabulary(none, CONFIG)).toBe(CONFIG)
  })
  it('falls back (null / undefined config included) when no term has a usable key', () => {
    expect(catalogueCategoryVocabulary([null, { key: '' }, { key: 5 }, undefined], CONFIG)).toBe(CONFIG)
    expect(catalogueCategoryVocabulary([], undefined)).toBeUndefined()
    expect(catalogueCategoryVocabulary(null, null)).toBeNull()
  })
  it('term records win entirely — config entries are not mixed in', () => {
    const v = catalogueCategoryVocabulary([{ key: 'romanzi', label: { it: 'Romanzi' }, order: 1000 }], CONFIG)
    expect(v).toEqual([{ value: 'romanzi', label: { it: 'Romanzi' } }])
  })
  it('sorts by order, then key; terms without order go last', () => {
    const v = termsToEntries([
      { key: 'c', order: 3000 },
      { key: 'z' },
      { key: 'b', order: 1000 },
      { key: 'a', order: 1000 },
      { key: 'y' },
    ])
    expect(v.map((e) => e.value)).toEqual(['a', 'b', 'c', 'y', 'z'])
  })
  it('passes labels through unchanged (map or already-resolved string) and keeps colour only when set', () => {
    const v = termsToEntries([
      { key: 'a', label: { it: 'A', en: 'Ay' }, color: '#fff' },
      { key: 'b', label: 'Bee', color: '' },
      { key: 'c', label: ['bad'] },
    ])
    expect(v).toEqual([
      { value: 'a', label: { it: 'A', en: 'Ay' }, color: '#fff' },
      { value: 'b', label: 'Bee' },
      { value: 'c', label: undefined },
    ])
  })
  it('keeps the first record of a duplicated key', () => {
    expect(termsToEntries([{ key: 'a', label: 'one', order: 2 }, { key: 'a', label: 'two', order: 1 }]).map((e) => e.label)).toEqual(['one'])
  })
  it('identical keys and labels give the same entries as the config list (the seed invariant)', () => {
    const fromTerms = termsToEntries(CONFIG.map((c, i) => ({ key: c.value, label: c.label, color: c.color, order: (i + 1) * 1000 })))
    expect(fromTerms.map(({ value, label, color }) => ({ value, label, color: color ?? undefined }))).toEqual(
      CONFIG.map(({ value, label, color }) => ({ value, label, color })),
    )
  })
})

describe('catalogueCategoryTermsGroq', () => {
  it('is scoped to the project, module, kind and published records', () => {
    const q = catalogueCategoryTermsGroq('label')
    expect(q).toContain('projectSlug == $projectSlug')
    expect(q).toContain('module == "catalogue"')
    expect(q).toContain('kind == "category"')
    expect(q).toContain('!(_id in path("drafts.**"))')
    expect(q).toContain('order(order asc, key asc)')
  })
})
