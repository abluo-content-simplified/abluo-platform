import { describe, expect, it } from 'vitest'
import type { ListedTerm } from '@/lib/taxonomy/service'
import { translationCoverage } from '@/lib/taxonomy/coverage'
import {
  applyOrder,
  buildRows,
  cleanText,
  deleteState,
  errorKey,
  hasTranslations,
  itemHref,
  moveKey,
  moveKeyTo,
  removeTerm,
  reorderLocally,
  summarize,
  termName,
  upsertTerm,
} from '../taxonomy-view'

const LOCALES = ['it', 'en', 'de']
const term = (key: string, order: number, label: Record<string, string>, usedBy = 0): ListedTerm => ({
  id: `term.p.catalogue.category.${key}`,
  key,
  label,
  color: null,
  order,
  rev: 'r1',
  coverage: translationCoverage(label, LOCALES, 'it'),
  usedBy,
})
const list = () => ({
  module: 'catalogue',
  kind: 'category' as const,
  defaultLocale: 'it',
  locales: LOCALES,
  canWrite: true,
  color: false,
  terms: [term('poesia', 1000, { it: 'Poesia', en: 'Poetry', de: 'Poesie' }, 3), term('romanzi', 2000, { it: 'Romanzi' }), term('saggi', 3000, { it: 'Saggi', en: 'Essays' }, 1)],
})

describe('rows', () => {
  it('shows the default-language name, usage and one chip per enabled language (default first)', () => {
    const rows = buildRows(list(), 'all')
    expect(rows.map((r) => r.name)).toEqual(['Poesia', 'Romanzi', 'Saggi'])
    expect(rows[0]).toMatchObject({ usedBy: 3, needsTranslation: false })
    expect(rows[1].chips).toEqual([
      { locale: 'it', code: 'IT', complete: true },
      { locale: 'en', code: 'EN', complete: false },
      { locale: 'de', code: 'DE', complete: false },
    ])
    expect(rows[2].chips.filter((c) => !c.complete).map((c) => c.code)).toEqual(['DE'])
  })

  it('the "missing translations" filter keeps only terms needing one, in order', () => {
    expect(buildRows(list(), 'missing').map((r) => r.key)).toEqual(['romanzi', 'saggi'])
  })

  it('summary counts terms that need a translation', () => {
    expect(summarize(list().terms)).toEqual({ needTranslation: 2, total: 3 })
    expect(summarize([])).toEqual({ needTranslation: 0, total: 0 })
  })

  it('never shows the key: falls back to another language, then to nothing', () => {
    expect(termName({ label: { en: 'Poetry' } }, 'it')).toBe('Poetry')
    expect(termName({ label: {} }, 'it')).toBe('')
  })

  it('translation UI needs more than one language', () => {
    expect(hasTranslations({ locales: ['it'] })).toBe(false)
    expect(hasTranslations({ locales: LOCALES })).toBe(true)
  })
})

describe('keeping the list in step', () => {
  it('upsert appends a new term in order and replaces an existing one keeping its usage', () => {
    const added = upsertTerm(list(), { ...term('nuovo', 4000, { it: 'Nuovo' }), usedBy: undefined })
    expect(added.terms.map((t) => t.key)).toEqual(['poesia', 'romanzi', 'saggi', 'nuovo'])
    expect(added.terms[3].usedBy).toBe(0)
    const replaced = upsertTerm(list(), { ...term('poesia', 1000, { it: 'Versi', en: 'Poetry', de: 'Poesie' }), usedBy: undefined })
    expect(replaced.terms[0]).toMatchObject({ key: 'poesia', usedBy: 3 })
    expect(termName(replaced.terms[0], 'it')).toBe('Versi')
    expect(replaced.terms).toHaveLength(3)
  })

  it('remove drops the term', () => {
    expect(removeTerm(list(), 'romanzi').terms.map((t) => t.key)).toEqual(['poesia', 'saggi'])
  })

  it('moveKeyTo moves to an index (a drop) and refuses no-ops', () => {
    expect(moveKeyTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a'])
    expect(moveKeyTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moveKeyTo(['a', 'b', 'c'], 'b', 1)).toBeNull()
    expect(moveKeyTo(['a', 'b', 'c'], 'x', 1)).toBeNull()
    expect(moveKeyTo(['a', 'b', 'c'], 'a', 3)).toBeNull()
  })

  it('moveKey moves one place and refuses the ends', () => {
    expect(moveKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveKey(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(moveKey(['a', 'b', 'c'], 'a', -1)).toBeNull()
    expect(moveKey(['a', 'b', 'c'], 'c', 1)).toBeNull()
    expect(moveKey(['a'], 'zz', 1)).toBeNull()
  })

  it('reorderLocally then applyOrder end in the server order', () => {
    const optimistic = reorderLocally(list(), ['saggi', 'poesia', 'romanzi'])
    expect(optimistic.terms.map((t) => t.key)).toEqual(['saggi', 'poesia', 'romanzi'])
    const confirmed = applyOrder(list(), [
      { key: 'saggi', order: 1000 },
      { key: 'poesia', order: 2000 },
      { key: 'romanzi', order: 3000 },
    ])
    expect(confirmed.terms.map((t) => [t.key, t.order])).toEqual([['saggi', 1000], ['poesia', 2000], ['romanzi', 3000]])
  })
})

describe('delete state', () => {
  it('an unused term can be deleted', () => {
    expect(deleteState(0, null)).toEqual({ kind: 'free' })
    expect(deleteState(5, { count: 0, items: [] })).toEqual({ kind: 'free' }) // the server's fresh answer wins
  })

  it('a used term is blocked with the count; before the list loads nothing is shown', () => {
    expect(deleteState(3, null)).toEqual({ kind: 'blocked', count: 3, shown: [], more: 3 })
  })

  it('shows at most 10 items and counts the rest', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, name: `Book ${i}`, type: 'catalogueItem' }))
    const s = deleteState(1, { count: 14, items })
    expect(s).toMatchObject({ kind: 'blocked', count: 14, more: 4 })
    if (s.kind === 'blocked') expect(s.shown).toHaveLength(10)
    const few = deleteState(2, { count: 2, items: items.slice(0, 2) })
    expect(few).toMatchObject({ more: 0 })
  })

  it('links catalogue items to their editor, other types to nothing', () => {
    expect(itemHref('tmz', { id: 'abc', type: 'catalogueItem' })).toBe('/tmz/catalogue/abc')
    expect(itemHref('tmz', { id: 'abc', type: 'somethingElse' })).toBeNull()
  })
})

describe('errors and text', () => {
  it('known codes map to their own message, anything else to the generic one', () => {
    expect(errorKey('label_required')).toBe('label_required')
    expect(errorKey('conflict')).toBe('conflict')
    expect(errorKey('key_immutable')).toBe('failed')
    expect(errorKey(undefined)).toBe('failed')
  })
  it('cleanText trims and collapses spaces', () => {
    expect(cleanText('  Science   Fiction ')).toBe('Science Fiction')
  })
})
