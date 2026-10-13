import { describe, it, expect } from 'vitest'
import {
  SLUG_NAMESPACE_QUERY,
  CURRENCY_ITEM_PRICES_QUERY,
  CURRENCY_OPTION_DELTAS_QUERY,
  currencyChangeNeedsConfirmation,
  currencyChanged,
  currencyImpact,
  labelOf,
  namedSlugConflicts,
  slugNamespaceParams,
  toSlugOwners,
  type NamedSlugOwner,
} from '../validation'

const owner = (o: Partial<NamedSlugOwner> & { id: string }): NamedSlugOwner => ({ type: 'item', hasPage: true, slugs: {}, label: o.id, ...o })

describe('slug namespace — items AND collections, per locale, naming the document', () => {
  const existing = [
    owner({ id: 'i1', label: 'Margherita', slugs: { it: 'margherita', en: 'margherita-pizza' } }),
    owner({ id: 'c1', type: 'collection', label: 'Menu di Natale', slugs: { it: 'natale' } }),
    owner({ id: 'i2', label: 'No page', hasPage: false, slugs: { it: 'senza-pagina' } }),
  ]
  const cand = (slugs: Record<string, string>, id = 'new', hasPage = true) => ({ id, hasPage, slugs })

  it('an item conflicts with another item and names it', () => {
    expect(namedSlugConflicts(cand({ it: 'margherita' }), existing)).toEqual([
      { locale: 'it', slug: 'margherita', owner: { id: 'i1', type: 'item', label: 'Margherita' } },
    ])
  })
  it('an item conflicts with a COLLECTION — one namespace', () => {
    expect(namedSlugConflicts(cand({ it: 'natale' }), existing)[0].owner).toEqual({ id: 'c1', type: 'collection', label: 'Menu di Natale' })
  })
  it('a collection conflicts with an item', () => {
    expect(namedSlugConflicts(cand({ it: 'margherita' }, 'c9'), existing)).toHaveLength(1)
  })
  it('same slug in a different locale is not a conflict', () => {
    expect(namedSlugConflicts(cand({ en: 'natale' }), existing)).toEqual([])
    expect(namedSlugConflicts(cand({ de: 'margherita' }), existing)).toEqual([])
  })
  it('case, slashes and Unicode form do not hide a conflict', () => {
    expect(namedSlugConflicts(cand({ it: ' /Margherita/ ' }), existing)).toHaveLength(1)
    const decomposed = 'caffè'
    expect(namedSlugConflicts(cand({ it: decomposed }), [owner({ id: 'x', slugs: { it: 'caffè' } })])).toHaveLength(1)
  })
  it('itself, documents without a page, and a candidate without a page never conflict', () => {
    expect(namedSlugConflicts(cand({ it: 'margherita' }, 'i1'), existing)).toEqual([])
    expect(namedSlugConflicts(cand({ it: 'senza-pagina' }), existing)).toEqual([])
    expect(namedSlugConflicts(cand({ it: 'margherita' }, 'new', false), existing)).toEqual([])
  })
  it('a draft id is the same document as its published id', () => {
    expect(namedSlugConflicts(cand({ it: 'margherita' }, 'drafts.i1'), existing)).toEqual([])
  })
  it('reports every locale that clashes', () => {
    expect(namedSlugConflicts(cand({ it: 'margherita', en: 'margherita-pizza' }), existing).map((c) => c.locale)).toEqual(['it', 'en'])
  })
})

describe('toSlugOwners + the query', () => {
  it('is filtered by projectSlug and covers both types', () => {
    expect(SLUG_NAMESPACE_QUERY).toContain('projectSlug == $projectSlug')
    expect(SLUG_NAMESPACE_QUERY).toContain('"catalogueItem", "catalogueCollection"')
    expect(slugNamespaceParams('lucia')).toEqual({ projectSlug: 'lucia' })
  })
  it('reads localizedSlug, merges a draft over its published copy, and labels by name', () => {
    const owners = toSlugOwners([
      { _id: 'i1', _type: 'catalogueItem', hasPage: true, label: { _type: 'localizedString', it: 'Margherita' }, slug: { _type: 'localizedSlug', it: { _type: 'slug', current: 'margherita' } } },
      { _id: 'drafts.i1', _type: 'catalogueItem', hasPage: true, label: { it: 'Margherita DOP' }, slug: { it: { current: 'margherita-dop' } } },
      { _id: 'c1', _type: 'catalogueCollection', hasPage: true, label: null, slug: { en: { current: 'wines' } } },
    ])
    expect(owners).toEqual([
      { id: 'i1', type: 'item', hasPage: true, slugs: { it: 'margherita-dop' }, label: 'Margherita DOP' },
      { id: 'c1', type: 'collection', hasPage: true, slugs: { en: 'wines' }, label: 'c1' },
    ])
  })
  it('labelOf takes the first non-empty text', () => {
    expect(labelOf({ _type: 'x', it: ' ', en: 'Hello' }, 'f')).toBe('Hello')
    expect(labelOf(undefined, 'f')).toBe('f')
  })
})

describe('currency-change impact (ADR-033 D7)', () => {
  it('counts offer prices and the items carrying them', () => {
    expect(currencyImpact([{ _id: 'a', prices: [9.5, 12] }, { _id: 'b', prices: [3] }, { _id: 'c', prices: [] }, { _id: 'd', prices: null }])).toEqual({
      prices: 3, items: 2, optionDeltas: 0, optionLists: 0,
    })
  })
  it('price 0 (free) is a price; non-numbers are not', () => {
    expect(currencyImpact([{ _id: 'a', prices: [0, '9', null, NaN] }]).prices).toBe(1)
  })
  it('a draft supersedes its published copy — counted once', () => {
    expect(currencyImpact([{ _id: 'a', prices: [1, 2] }, { _id: 'drafts.a', prices: [1, 2, 3] }])).toMatchObject({ prices: 3, items: 1 })
  })
  it('option price changes are reported separately; zero deltas are not counted', () => {
    const r = currencyImpact([{ _id: 'a', prices: [5] }], [{ _id: 'l1', deltas: [1.5, -0.5, 0] }, { _id: 'l2', deltas: [] }])
    expect(r).toEqual({ prices: 1, items: 1, optionDeltas: 2, optionLists: 1 })
  })
  it('needs confirmation only when something is reinterpreted', () => {
    expect(currencyChangeNeedsConfirmation(currencyImpact([]))).toBe(false)
    expect(currencyChangeNeedsConfirmation(currencyImpact([{ _id: 'a', prices: [1] }]))).toBe(true)
    expect(currencyChangeNeedsConfirmation(currencyImpact([], [{ _id: 'l', deltas: [2] }]))).toBe(true)
  })
  it('queries are project-scoped; currencyChanged ignores case and blanks', () => {
    expect(CURRENCY_ITEM_PRICES_QUERY).toContain('projectSlug == $projectSlug')
    expect(CURRENCY_OPTION_DELTAS_QUERY).toContain('projectSlug == $projectSlug')
    expect(currencyChanged('eur', 'EUR')).toBe(false)
    expect(currencyChanged('EUR', 'CHF')).toBe(true)
    expect(currencyChanged(undefined, 'EUR')).toBe(true)
  })
})
