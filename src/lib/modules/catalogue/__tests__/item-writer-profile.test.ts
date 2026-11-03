/**
 * C1.12.4 (D-22) — the item writer refuses ADDING a category (primary or additional), tag or option
 * list that is not used for the item's profile; it never removes one, and a profile change is always
 * saved with every assignment kept. Option lists' "Use for" also needs Catalogue Setup to change.
 */
import { describe, expect, it } from 'vitest'
import { CatalogueError, cleanCatalogueSet, type PatchContext } from '../dashboard-patch'
import { readChannels } from '../commerce/channels'
import { buildTree } from '../taxonomy/tree'
import { profilesWith } from '../profiles'
import { capabilitiesFor } from '../capabilities'
import type { CategoryNode } from '../taxonomy/types'

const FOOD = profilesWith('foodInformation')[0]
const cat = (key: string, parentKey: string | null, useFor?: string[]): CategoryNode => ({ key, label: { it: key }, parentKey, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null, ...(useFor && { useFor: useFor as never }) })
const TREE = buildTree([cat('books', null, ['book']), cat('design', 'books'), cat('literature', 'books'), cat('food', null, [FOOD]), cat('pizza', 'food'), cat('misc', null)])

let n = 0
const ctx = (previous: Record<string, unknown>, o: Partial<PatchContext> = {}): PatchContext => ({
  locales: new Set(['it']),
  defaultLocale: 'it',
  channels: [],
  categories: [...TREE.nodes.keys()],
  tags: ['new', 'signed'],
  dietary: [],
  previous,
  newKey: () => `k${++n}`,
  channelSet: readChannels([]).channels,
  categoryTree: TREE,
  applicability: { tags: [{ key: 'new' }, { key: 'signed', useFor: ['book'] }], optionLists: new Map([['salse', { useFor: [FOOD] }]]) },
  ...o,
})
const refusal = (fn: () => unknown): { code: string; field?: string } | null => {
  try {
    fn()
    return null
  } catch (e) {
    if (e instanceof CatalogueError) return { code: e.code, field: (e.detail as { field?: string } | undefined)?.field }
    throw e
  }
}

const PIZZA = { itemProfile: FOOD, primaryCategory: 'design' }

describe('writer/refuse-add', () => {
  it('adding an incompatible additional category is refused, naming the field; nothing is cleaned', () => {
    expect(refusal(() => cleanCatalogueSet('item', { additionalCategories: ['literature'] }, ctx(PIZZA)))).toEqual({ code: 'invalid_value', field: 'additionalCategories' })
  })
  it('choosing an incompatible primary is refused', () => {
    expect(refusal(() => cleanCatalogueSet('item', { primaryCategory: 'literature' }, ctx({ itemProfile: FOOD, primaryCategory: 'pizza' })))).toEqual({ code: 'invalid_value', field: 'primaryCategory' })
  })
  it('an incompatible tag or option list is refused', () => {
    expect(refusal(() => cleanCatalogueSet('item', { tags: ['new', 'signed'] }, ctx({ itemProfile: FOOD, primaryCategory: 'pizza' })))).toEqual({ code: 'invalid_value', field: 'tags' })
    expect(refusal(() => cleanCatalogueSet('item', { optionLists: [{ listId: 'salse', min: 0, max: null }] }, ctx({ itemProfile: 'book', primaryCategory: 'design' })))).toEqual({ code: 'invalid_value', field: 'optionLists' })
  })
  it('compatible choices save; a root without "Use for" fits every type', () => {
    expect(refusal(() => cleanCatalogueSet('item', { additionalCategories: ['misc'], tags: ['new'] }, ctx({ itemProfile: FOOD, primaryCategory: 'pizza' })))).toBeNull()
    expect(refusal(() => cleanCatalogueSet('item', { optionLists: [{ listId: 'salse', min: 0, max: null }] }, ctx({ itemProfile: FOOD, primaryCategory: 'pizza' })))).toBeNull()
  })
})

describe('writer/keep-existing', () => {
  it('the pizza already in Design saves its name and keeps Design', () => {
    const p = cleanCatalogueSet('item', { 'name.it': 'Margherita' }, ctx(PIZZA))
    expect(p.unset).not.toContain('primaryCategory')
    expect(p.set.primaryCategory).toBeUndefined()
  })
  it('a profile change is saved and keeps every assignment (findings surface instead)', () => {
    const p = cleanCatalogueSet('item', { itemProfile: FOOD }, ctx({ itemProfile: 'book', primaryCategory: 'design', tags: ['signed'] }))
    expect(p.set.itemProfile).toBe(FOOD)
    expect(p.unset).not.toEqual(expect.arrayContaining(['primaryCategory', 'tags']))
  })
  it('a legacy draft (categories list) converting on save is never refused', () => {
    const p = cleanCatalogueSet('item', { 'name.it': 'Margherita' }, ctx({ itemProfile: FOOD, categories: ['design'] }))
    expect(p.set.primaryCategory).toBe('design')
  })
  it('moving an existing incompatible category from additional to primary is not "adding"', () => {
    expect(refusal(() => cleanCatalogueSet('item', { primaryCategory: 'design', additionalCategories: ['pizza'] }, ctx({ itemProfile: FOOD, primaryCategory: 'pizza', additionalCategories: ['design'] })))).toBeNull()
  })
})

describe('option list "Use for" (C1.12.7)', () => {
  it('is a plain option-list field: stored as profile ids, cleared for "All item types"', () => {
    expect(cleanCatalogueSet('optionList', { useFor: ['service', 'book'] }, ctx({})).set.useFor).toEqual(['book', 'service'])
    expect(cleanCatalogueSet('optionList', { useFor: [] }, ctx({})).unset).toContain('useFor')
    expect(refusal(() => cleanCatalogueSet('optionList', { useFor: ['all'] }, ctx({})))).toMatchObject({ code: 'invalid_value' })
    expect(refusal(() => cleanCatalogueSet('item', { useFor: ['book'] }, ctx({})))).toMatchObject({ code: 'invalid_field' })
  })
  it('needs Catalogue Setup on top of editing the list', () => {
    expect(capabilitiesFor({ op: 'optionList.setUseFor' })).toEqual(['catalogue.item.write', 'catalogue.setup.manage'])
    expect(capabilitiesFor({ op: 'term.setUseFor', kind: 'category' })).toEqual(['catalogue.setup.manage'])
    expect(capabilitiesFor({ op: 'term.setUseFor', kind: 'tag' })).toEqual(['catalogue.taxonomy.write'])
  })
})
