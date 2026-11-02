/** seedTaxonomyFromTerms — the one term → catalogueTaxonomy mapping (C1.9 D1, R2 seeding). */
import { describe, expect, it } from 'vitest'
import { seedTaxonomyFromTerms } from '../seed'
import { buildTree } from '../tree'
import { readCategoryNodes } from '../read'
import { termsToEntries } from '@/lib/taxonomy/vocabulary'

const l = (en: string) => ({ _type: 'localizedString', en })

describe('seedTaxonomyFromTerms', () => {
  it('tmz: categories technology/design/literature as roots with their order; 7 tags; keys verbatim', () => {
    const terms = [
      { kind: 'category', key: 'design', order: 2000, label: l('Design') },
      { kind: 'category', key: 'technology', order: 1000, label: l('Technology') },
      { kind: 'category', key: 'literature', order: 3000, label: l('Literature') },
      ...['fantasy', 'humour', 'illustrated_boos', 'inspirational', 'memoir', 'satire', 'science_fiction'].map((key, i) => ({ kind: 'tag', key, order: (i + 1) * 1000, label: l(key) })),
    ]
    const s = seedTaxonomyFromTerms(terms, [{ value: 'design' }, { value: 'technology' }])
    expect(s.categorySource).toBe('terms')
    expect(s.categories).toEqual([
      { _key: 'technology', _type: 'catalogueCategory', key: 'technology', label: l('Technology'), order: 1000 },
      { _key: 'design', _type: 'catalogueCategory', key: 'design', label: l('Design'), order: 2000 },
      { _key: 'literature', _type: 'catalogueCategory', key: 'literature', label: l('Literature'), order: 3000 },
    ])
    expect(s.tags.map((t) => t.key)).toContain('illustrated_boos')
    expect(s.findings).toEqual([])
    expect(buildTree(readCategoryNodes(s.categories)).issues).toEqual([])
  })

  it('keeps today vocabulary order (termsToEntries) also for records without an order', () => {
    const terms = [
      { kind: 'category', key: 'b', label: l('B') },
      { kind: 'category', key: 'a', order: 5000, label: l('A') },
      { kind: 'category', key: 'c', label: l('C') },
    ]
    const s = seedTaxonomyFromTerms(terms, null)
    expect(s.categories.map((c) => c.key)).toEqual(termsToEntries(terms).map((e) => e.value))
    expect(s.categories.map((c) => c.order)).toEqual([5000, 6000, 7000])
  })

  it('falls back to the legacy config list when there are no category records', () => {
    const s = seedTaxonomyFromTerms([], [{ value: 'romanzi', label: { it: 'Romanzi' } }, { value: 'saggi', label: { it: 'Saggi' } }])
    expect(s.categorySource).toBe('config')
    expect(s.categories.map((c) => [c.key, c.order, c.label])).toEqual([
      ['romanzi', 1000, { it: 'Romanzi' }],
      ['saggi', 2000, { it: 'Saggi' }],
    ])
  })

  it('reports duplicates and colours instead of merging or dropping silently', () => {
    const s = seedTaxonomyFromTerms(
      [
        { kind: 'category', key: 'x', order: 1, label: l('X'), color: '#123' },
        { kind: 'category', key: 'x', order: 2, label: l('X2') },
        { kind: 'tag', key: '' },
      ],
      null,
    )
    expect(s.categories).toHaveLength(1)
    expect(s.findings.map((f) => f.code).sort()).toEqual(['colorNotCarried', 'duplicateKey', 'invalidRow'])
  })

  it('is deterministic', () => {
    const terms = [{ kind: 'category', key: 'a', order: 1000, label: l('A') }]
    expect(JSON.stringify(seedTaxonomyFromTerms(terms, null))).toBe(JSON.stringify(seedTaxonomyFromTerms(terms, null)))
  })
})
