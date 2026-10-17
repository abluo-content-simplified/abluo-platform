import { describe, expect, it } from 'vitest'
import { canOfferCreate, filterTerms, findByLabel, foldText, mergeTerms, newTermLabels, pickerLabel, selectKey, toPickerTerm, toggleKey, type PickerTerm } from '../term-picker-model'

const t = (value: string, label: Record<string, string>): PickerTerm => ({ value, label, color: null })
const TERMS = [t('design', { it: 'Design', en: 'Design' }), t('technology', { it: 'Tecnologia', en: 'Technology' }), t('poesia', { it: 'Poesia' })]
const KEYS = TERMS.map((x) => x.value)

describe('pickerLabel', () => {
  it('prefers the dashboard language, then the default, then any, then the key', () => {
    expect(pickerLabel(TERMS[1], 'en', 'it')).toBe('Technology')
    expect(pickerLabel(TERMS[2], 'en', 'it')).toBe('Poesia')
    expect(pickerLabel(TERMS[2], 'en', 'de')).toBe('Poesia')
    expect(pickerLabel(t('x', {}), 'en', 'it')).toBe('x')
  })
})

describe('toPickerTerm', () => {
  it('maps a service term', () => {
    expect(toPickerTerm({ key: 'a', label: { it: 'A' } })).toEqual({ value: 'a', label: { it: 'A' }, color: null })
  })
})

describe('mergeTerms', () => {
  it('appends new terms after the page ones, without duplicates', () => {
    const added = [t('poesia', { it: 'Poesia' }), t('novel', { it: 'Romanzo' })]
    expect(mergeTerms(TERMS, added).map((x) => x.value)).toEqual(['design', 'technology', 'poesia', 'novel'])
    expect(mergeTerms(TERMS.slice(0, 2), [added[0]]).map((x) => x.value)).toEqual(['design', 'technology', 'poesia'])
  })
  it('lets the page copy win', () => {
    const base = [t('a', { it: 'Nuovo nome' })]
    expect(mergeTerms(base, [t('a', { it: 'Vecchio' })])[0].label.it).toBe('Nuovo nome')
  })
})

describe('filterTerms', () => {
  it('matches any language, ignoring case and accents', () => {
    expect(filterTerms(TERMS, 'TECNO').map((x) => x.value)).toEqual(['technology'])
    expect(filterTerms(TERMS, 'techno').map((x) => x.value)).toEqual(['technology'])
    expect(filterTerms([t('caffe', { it: 'Caffè' })], 'caffe')).toHaveLength(1)
  })
  it('keeps everything for an empty search and keeps selected terms visible', () => {
    expect(filterTerms(TERMS, '  ')).toHaveLength(3)
    expect(filterTerms(TERMS, 'poes', ['design']).map((x) => x.value)).toEqual(['design', 'poesia'])
  })
})

describe('findByLabel / canOfferCreate', () => {
  it('finds an existing name regardless of case, accents, spacing', () => {
    expect(findByLabel(TERMS, '  technology ', 'it', 'it')?.value).toBe('technology')
    expect(findByLabel(TERMS, 'tecnologia', 'en', 'it')?.value).toBe('technology')
    expect(findByLabel(TERMS, 'Novel', 'en', 'it')).toBeNull()
    expect(findByLabel(TERMS, '', 'en', 'it')).toBeNull()
  })
  it('offers + Add only for a new, non-empty name by someone who may add', () => {
    const base = { terms: TERMS, ui: 'en', defaultLocale: 'it' }
    expect(canOfferCreate({ ...base, canAdd: true, query: 'Novel' })).toBe(true)
    expect(canOfferCreate({ ...base, canAdd: true, query: 'design' })).toBe(false)
    expect(canOfferCreate({ ...base, canAdd: true, query: '   ' })).toBe(false)
    expect(canOfferCreate({ ...base, canAdd: false, query: 'Novel' })).toBe(false)
  })
})

describe('selectKey / toggleKey', () => {
  it('keeps the list order, like the chips', () => {
    expect(selectKey(['technology'], 'design', KEYS)).toEqual(['design', 'technology'])
    expect(toggleKey(['technology'], 'design', KEYS)).toEqual(['design', 'technology'])
    expect(toggleKey(['design', 'technology'], 'design', KEYS)).toEqual(['technology'])
  })
  it('is idempotent for a key already chosen', () => {
    expect(selectKey(['design'], 'design', KEYS)).toEqual(['design'])
  })
  it('a term created inline lands at the end of the saved array (wizard = editor)', () => {
    const keys = [...KEYS, 'novel']
    expect(selectKey(['design'], 'novel', keys)).toEqual(['design', 'novel'])
    expect(selectKey([], 'novel', keys)).toEqual(['novel'])
  })
  it('keeps unknown stored keys instead of dropping them on add', () => {
    expect(selectKey(['legacy'], 'design', KEYS)).toEqual(['design', 'legacy'])
  })
})

describe('newTermLabels / foldText', () => {
  it('creates in the default language only, trimmed', () => {
    expect(newTermLabels('  Science   Fiction ', 'it')).toEqual({ it: 'Science Fiction' })
    expect(newTermLabels('   ', 'it')).toBeNull()
  })
  it('folds text', () => {
    expect(foldText(' Èè  Ab ')).toBe('ee ab')
  })
})

describe('tag kind (slice 7) — the model is kind-agnostic, tags are multi-select', () => {
  const TAGS = [t('humour', { it: 'Umorismo', en: 'Humour' }), t('scifi', { it: 'Fantascienza', en: 'Science Fiction' })]
  const tagKeys = TAGS.map((x) => x.value)
  it('selects several tags in list order and an inline-created tag lands in the saved array', () => {
    expect(selectKey(selectKey([], 'scifi', tagKeys), 'humour', tagKeys)).toEqual(['humour', 'scifi'])
    const created = toPickerTerm({ key: 'cult', label: { it: 'Cult' } })
    const merged = mergeTerms(TAGS, [created])
    expect(selectKey(['humour'], 'cult', merged.map((x) => x.value))).toEqual(['humour', 'cult'])
  })
  it('searches tag labels in any language and offers + Add only for a new name', () => {
    expect(filterTerms(TAGS, 'science').map((x) => x.value)).toEqual(['scifi'])
    expect(findByLabel(TAGS, 'humour', 'en', 'it')?.value).toBe('humour')
    expect(canOfferCreate({ terms: TAGS, ui: 'en', defaultLocale: 'it', canAdd: true, query: 'Noir' })).toBe(true)
    expect(canOfferCreate({ terms: TAGS, ui: 'en', defaultLocale: 'it', canAdd: false, query: 'noir' })).toBe(false)
  })
})
