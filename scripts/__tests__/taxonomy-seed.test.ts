/** The Catalogue category seed planner (scripts/lib/taxonomy-seed.mjs) — pure, no network. */
import { describe, expect, it } from 'vitest'
import { compareResolved, labelMapOf, planCategorySeed, resolveWith, seedMutations, termIdFor, vocabularyOf } from '../lib/taxonomy-seed.mjs'
import { termId } from '@/lib/taxonomy/ids'
import { catalogueCategoryVocabulary } from '@/lib/taxonomy/vocabulary'

const NOW = '2026-10-17T10:00:00.000Z'
const LIST = [
  { _key: 'a', value: 'romanzi', label: { _type: 'localizedString', it: 'Romanzi', en: 'Novels' }, color: '#123456' },
  { _key: 'b', value: 'saggi_brevi', label: { it: 'Saggi brevi', en: ' ' } },
]

describe('planCategorySeed', () => {
  it('one create per entry: identical key and label map, deterministic id, order in steps of 1000', () => {
    const p = planCategorySeed({ projectSlug: 'tmz', configList: LIST, now: NOW })
    expect(p.items.map((i) => i.status)).toEqual(['create', 'create'])
    expect(p.items[0].doc).toMatchObject({ _id: 'term.tmz.catalogue.category.romanzi', _type: 'taxonomyTerm', projectSlug: 'tmz', module: 'catalogue', kind: 'category', key: 'romanzi', order: 1000, color: '#123456', label: { _type: 'localizedString', it: 'Romanzi', en: 'Novels' } })
    expect(p.items[1].doc).toMatchObject({ key: 'saggi_brevi', order: 2000, label: { _type: 'localizedString', it: 'Saggi brevi' } })
    expect(p.items[1].doc).not.toHaveProperty('color')
  })
  it('ids match the app termId()', () => {
    expect(termIdFor('tmz', 'saggi_brevi')).toBe(termId({ projectSlug: 'tmz', module: 'catalogue', kind: 'category', key: 'saggi_brevi' }))
  })
  it('is idempotent: existing ids are not planned again; a different label is reported, not overwritten', () => {
    const existing = [{ _id: 'term.tmz.catalogue.category.romanzi', key: 'romanzi', label: { it: 'Romanzi', en: 'Novels' } }, { _id: 'term.tmz.catalogue.category.saggi_brevi', key: 'saggi_brevi', label: { it: 'Altro' } }]
    const p = planCategorySeed({ projectSlug: 'tmz', configList: LIST, existing, now: NOW })
    expect(p.items.map((i) => i.status)).toEqual(['exists', 'differs'])
    expect(seedMutations(p)).toEqual([])
  })
  it('only createIfNotExists mutations', () => {
    const m = seedMutations(planCategorySeed({ projectSlug: 'tmz', configList: LIST, now: NOW }))
    expect(m).toHaveLength(2)
    for (const x of m) expect(Object.keys(x)).toEqual(['createIfNotExists'])
  })
  it('flags keys that would not be valid term keys, duplicates and missing values; never invents a key', () => {
    const p = planCategorySeed({ projectSlug: 'tmz', configList: [{ value: 'Bad Key', label: { it: 'x' } }, { value: 'ok', label: { it: 'ok' } }, { value: 'ok', label: { it: 'dup' } }, { label: {} }, null], now: NOW })
    expect(p.items.map((i) => i.status)).toEqual(['invalid', 'create', 'invalid', 'invalid', 'invalid'])
  })
  it('handles a project without a list and a bad project slug', () => {
    expect(planCategorySeed({ projectSlug: 'tmz', configList: null, now: NOW }).items).toEqual([])
    expect(planCategorySeed({ projectSlug: 'Bad.Slug', configList: [], now: NOW }).problems).toHaveLength(1)
  })
})

describe('labelMapOf', () => {
  it('drops bookkeeping keys and blank strings', () => {
    expect(labelMapOf({ _type: 'localizedString', translationStatus: {}, it: 'A', en: '' })).toEqual({ it: 'A' })
  })
})

describe('compareResolved (before / after)', () => {
  const items = [{ id: 'i1', name: 'Dune', categories: ['saggi_brevi', 'romanzi', 'gone', 'romanzi'] }, { id: 'i2', name: 'Vuoto', categories: [] }]
  const seeded = () => planCategorySeed({ projectSlug: 'tmz', configList: LIST, now: NOW }).items.map((i) => ({ key: i.doc.key, label: i.doc.label, color: i.doc.color, order: i.doc.order }))

  it('seeded records resolve identically to the config list, in every locale (unknown keys dropped, duplicates collapsed)', () => {
    const rows = compareResolved({ items, configList: LIST, terms: seeded(), locales: ['it', 'en'], defaultLocale: 'it' })
    expect(rows.every((r) => r.identical)).toBe(true)
    expect(rows[0].perLocale[0].after.map((c) => c.value)).toEqual(['saggi_brevi', 'romanzi'])
    expect(rows[0].perLocale[1].after.map((c) => c.label)).toEqual(['Saggi brevi', 'Novels'])
  })
  it('detects a difference', () => {
    const terms = seeded().map((t) => (t.key === 'romanzi' ? { ...t, label: { it: 'Narrativa' } } : t))
    expect(compareResolved({ items, configList: LIST, terms, locales: ['it'], defaultLocale: 'it' })[0].identical).toBe(false)
  })
  it('agrees with the app helper on which vocabulary wins', () => {
    const t = seeded()
    expect(vocabularyOf(t, LIST).map((e) => e.value)).toEqual((catalogueCategoryVocabulary(t.map((x) => ({ ...x })), LIST) as { value: string }[]).map((e) => e.value))
    expect(vocabularyOf([], LIST)).toBe(LIST)
    expect(resolveWith(['x'], vocabularyOf([], LIST), 'it', 'it')).toEqual([])
  })
})
