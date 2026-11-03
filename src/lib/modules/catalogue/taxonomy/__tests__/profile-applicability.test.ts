/**
 * C1.12 (D-22) — profile applicability, the named fixtures of C1.12.10 over tree T-mixed.
 */
import { describe, expect, it } from 'vitest'
import { profilesWith, type ItemProfile } from '../../profiles'
import { buildTree } from '../tree'
import { readCategoryNodes, readTagNodes } from '../read'
import {
  appliesTo,
  cleanUseFor,
  effectiveProfiles,
  incompatibleAssignments,
  isCategoryCompatible,
  narrowingImpact,
  newIncompatibleAssignments,
  optionListIdsOf,
  optionListUseForOf,
  readUseFor,
  fieldsFromUseFor,
  type ApplicabilityItem,
  type ApplicabilityTaxonomy,
} from '../profile-applicability'
import { profileApplicabilityReport, studioProfileProblem } from '../profile-applicability-docs'
import type { CategoryNode } from '../types'

const FOOD: ItemProfile = profilesWith('foodInformation')[0]

const node = (key: string, parentKey: string | null, order: number, useFor?: unknown): CategoryNode => ({
  key,
  label: { en: key[0].toUpperCase() + key.slice(1) },
  parentKey,
  order,
  channelRules: {},
  defaultOptionListIds: [],
  archivedAt: null,
  ...fieldsFromUseFor(useFor),
})

/** T-mixed (C1.12.10). */
const T = buildTree([
  node('food', null, 1000, [FOOD]),
  node('pizza', 'food', 1000),
  node('pizza_bianche', 'pizza', 1000),
  node('books', null, 2000, ['book']),
  node('design', 'books', 1000),
  node('literature', 'books', 2000),
  node('shop', null, 3000, ['book', 'product']),
  node('gifts', 'shop', 1000),
  node('misc', null, 4000),
])
const TAGS = [
  { key: 'new' },
  { key: 'spicy', useFor: [FOOD] },
  { key: 'signed_copy', useFor: ['book'] as ItemProfile[] },
]
const TAX: ApplicabilityTaxonomy = { tree: T, tags: TAGS }
const LISTS = new Map([
  ['extras', { useFor: [FOOD] }],
  ['wrap', {}],
])
const item = (profile: ItemProfile | null, primary: string | null, additional: string[] = [], tags: string[] = [], optionListIds: string[] = []): ApplicabilityItem => ({ profile, assignment: { primary, additional }, tags, optionListIds })

describe('use-for/read', () => {
  it('dedupes, orders, drops unknown ids; unknown-only is corrupt; empty = all', () => {
    expect(readUseFor(['book', 'book', 'x'])).toEqual({ profiles: ['book'], unknownOnly: false })
    expect(readUseFor(['x'])).toEqual({ profiles: [], unknownOnly: true })
    expect(readUseFor(null)).toEqual({ profiles: [], unknownOnly: false })
    expect(readUseFor([])).toEqual({ profiles: [], unknownOnly: false })
    expect(readUseFor(['service', 'book']).profiles).toEqual(['book', 'service'])
  })
  it('writer input: unknown ids refused, null/[] = all', () => {
    expect(cleanUseFor(['service', 'book', 'book'])).toEqual(['book', 'service'])
    expect(cleanUseFor(null)).toEqual([])
    expect(cleanUseFor([])).toEqual([])
    expect(cleanUseFor(['all'])).toBeNull()
    expect(cleanUseFor('book')).toBeNull()
  })
  it('readers carry it on category and tag nodes', () => {
    expect(readCategoryNodes([{ key: 'books', label: { en: 'Books' }, order: 1, useFor: ['book'] }])[0].useFor).toEqual(['book'])
    expect(readCategoryNodes([{ key: 'misc', label: { en: 'Misc' }, order: 1 }])[0]).not.toHaveProperty('useFor')
    expect(readTagNodes([{ key: 'x', label: { en: 'X' }, order: 1, useFor: ['nope'] }])[0]).toMatchObject({ useFor: [], useForCorrupt: true })
  })
})

describe('use-for/inherit', () => {
  it('descendants inherit the root; no setting = all; unknown key = all', () => {
    expect(effectiveProfiles(T, 'pizza_bianche')).toEqual([FOOD])
    expect(effectiveProfiles(T, 'gifts')).toEqual(['book', 'product'])
    expect(effectiveProfiles(T, 'misc')).toEqual([])
    expect(effectiveProfiles(T, 'nope')).toEqual([])
  })
  it('use-for/non-root-ignored: a child with its own value still follows its root', () => {
    const t = buildTree([node('books', null, 1, ['book']), node('design', 'books', 1, ['service'])])
    expect(effectiveProfiles(t, 'design')).toEqual(['book'])
    expect(isCategoryCompatible(t, 'design', 'service')).toBe(false)
  })
  it('use-for/unknown-only: a corrupt root applies to no profile', () => {
    const t = buildTree([node('weird', null, 1, ['x'])])
    for (const p of ['book', 'product', 'service', FOOD] as ItemProfile[]) expect(isCategoryCompatible(t, 'weird', p)).toBe(false)
    expect(appliesTo({ useForCorrupt: true }, 'book')).toBe(false)
  })
})

describe('compat', () => {
  it('compat/pizza-design', () => {
    expect(incompatibleAssignments(item(FOOD, 'design'), TAX)).toEqual([{ kind: 'primary', key: 'design', root: 'books', useFor: ['book'] }])
  })
  it('compat/additional: additional categories must be compatible too', () => {
    expect(incompatibleAssignments(item('book', 'literature', ['pizza']), TAX)).toEqual([{ kind: 'additional', key: 'pizza', root: 'food', useFor: [FOOD] }])
  })
  it('compat/multi-profile: a root may serve several profiles', () => {
    expect(incompatibleAssignments(item('product', 'gifts'), TAX)).toEqual([])
    expect(incompatibleAssignments(item('book', 'gifts'), TAX)).toEqual([])
    expect(incompatibleAssignments(item('service', 'gifts'), TAX)).toHaveLength(1)
  })
  it('compat/tags-options', () => {
    expect(incompatibleAssignments(item(FOOD, 'pizza', [], ['new', 'signed_copy'], ['extras', 'wrap']), TAX, LISTS)).toEqual([{ kind: 'tag', key: 'signed_copy', useFor: ['book'] }])
    expect(incompatibleAssignments(item('book', 'design', [], [], ['extras']), TAX, LISTS)).toEqual([{ kind: 'option', key: 'extras', useFor: [FOOD] }])
  })
  it('compat/order: primary → additional → tags → option lists', () => {
    expect(incompatibleAssignments(item('service', 'design', ['pizza'], ['spicy'], ['extras']), TAX, LISTS).map((f) => f.kind)).toEqual(['primary', 'additional', 'tag', 'option'])
  })
  it('compat/no-profile: nothing to judge', () => {
    expect(incompatibleAssignments(item(null, 'design', ['pizza'], ['spicy']), TAX)).toEqual([])
  })
  it('compat/profile-change: findings follow the profile; the assignment is untouched', () => {
    const before = item('book', 'literature')
    const after = { ...before, profile: FOOD }
    expect(incompatibleAssignments(before, TAX)).toEqual([])
    expect(incompatibleAssignments(after, TAX).map((f) => f.key)).toEqual(['literature'])
    expect(after.assignment).toEqual({ primary: 'literature', additional: [] })
  })
  it('unknown terms are not profile findings (integrity reports them)', () => {
    expect(incompatibleAssignments(item(FOOD, 'gone', [], ['gone_tag'], ['gone_list']), TAX, LISTS)).toEqual([])
  })
})

describe('new — the writer rule', () => {
  it('new/only-added: only the term this save adds is new', () => {
    const f = newIncompatibleAssignments(item(FOOD, 'design'), item(FOOD, 'design', ['literature']), TAX)
    expect(f.map((x) => x.key)).toEqual(['literature'])
  })
  it('new/profile-change-never-refuses', () => {
    expect(newIncompatibleAssignments(item('book', 'design'), item(FOOD, 'design'), TAX)).toEqual([])
  })
  it('moving an existing incompatible category from additional to primary is not "adding"', () => {
    expect(newIncompatibleAssignments(item(FOOD, 'pizza', ['design']), item(FOOD, 'design', ['pizza']), TAX)).toEqual([])
  })
  it('a new tag or option list is judged too', () => {
    expect(newIncompatibleAssignments(item(FOOD, 'pizza'), item(FOOD, 'pizza', [], ['signed_copy']), TAX).map((f) => f.kind)).toEqual(['tag'])
    expect(newIncompatibleAssignments(item('book', 'design'), item('book', 'design', [], [], ['extras']), TAX, LISTS).map((f) => f.kind)).toEqual(['option'])
  })
})

describe('narrow/impact', () => {
  it('counts items that become incompatible (per id; drafts and published once)', () => {
    const narrowed = buildTree([...[...T.nodes.values()].filter((n) => n.key !== 'shop'), node('shop', null, 3000, ['book'])])
    const items = [
      { id: 'a', item: item('product', 'gifts') },
      { id: 'a', item: item('product', 'gifts') }, // draft + published of one item
      { id: 'b', item: item('product', 'pizza', ['gifts']) },
      { id: 'c', item: item('book', 'gifts') },
    ]
    expect(narrowingImpact(items, { taxonomy: TAX }, { taxonomy: { tree: narrowed, tags: TAGS } })).toEqual({ items: 2, sample: ['a', 'b'] })
  })
  it('an already-incompatible item is not counted again', () => {
    expect(narrowingImpact([{ id: 'p', item: item(FOOD, 'design') }], { taxonomy: TAX }, { taxonomy: TAX }).items).toBe(0)
  })
})

describe('stored documents', () => {
  it('option list ids and the published-else-draft rule', () => {
    expect(optionListIdsOf({ optionLists: [{ list: { _ref: 'drafts.a' } }, { list: { _ref: 'a' } }, { list: { _ref: 'b' } }, null] })).toEqual(['a', 'b'])
    const m = optionListUseForOf([{ _id: 'drafts.a', useFor: ['book'] }, { _id: 'a', useFor: [FOOD] }, { _id: 'drafts.b', useFor: ['service'] }])
    expect(m.get('a')).toEqual({ useFor: [FOOD] })
    expect(m.get('b')).toEqual({ useFor: ['service'] })
  })

  const taxonomyDoc = {
    categories: [
      { key: 'books', label: { en: 'Books' }, order: 1000, useFor: ['book'] },
      { key: 'design', label: { en: 'Design' }, parentKey: 'books', order: 1000 },
    ],
    tags: [{ key: 'illustrated', label: { en: 'Illustrated' }, order: 1000, useFor: ['book'] }],
  }

  it('studio/validation: names the first finding; compatible → true', () => {
    expect(studioProfileProblem({ itemProfile: FOOD, primaryCategory: 'design' }, { taxonomy: taxonomyDoc, lists: [] })).toMatch(/Main category "Books › Design" isn't used for/)
    expect(studioProfileProblem({ itemProfile: 'book', primaryCategory: 'design', tags: ['illustrated'] }, { taxonomy: taxonomyDoc, lists: [] })).toBe(true)
    expect(studioProfileProblem({ itemProfile: FOOD, primaryCategory: 'design', tags: ['illustrated'] }, { taxonomy: taxonomyDoc, lists: [] })).toMatch(/\(1 more\.\)$/)
    // No taxonomy document yet: nothing restricts anything.
    expect(studioProfileProblem({ itemProfile: FOOD, categories: ['design'] }, { taxonomy: null, lists: [] })).toBe(true)
  })

  it('report: tmz after the Books root — exactly the pizza draft is flagged (RUNBOOK §13)', () => {
    const docs = [
      { _id: 'catalogue-taxonomy.tmz', _type: 'catalogueTaxonomy', projectSlug: 'tmz', ...taxonomyDoc },
      { _id: 'b1', _type: 'catalogueItem', projectSlug: 'tmz', itemProfile: 'book', primaryCategory: 'design' },
      { _id: 'drafts.p1', _type: 'catalogueItem', projectSlug: 'tmz', itemProfile: FOOD, primaryCategory: 'design' },
      { _id: 'n1', _type: 'catalogueItem', projectSlug: 'tmz', primaryCategory: 'design' },
      { _id: 'versions.x.p1', _type: 'catalogueItem', projectSlug: 'tmz', itemProfile: FOOD, primaryCategory: 'design' },
      { _id: 'o1', _type: 'catalogueItem', projectSlug: 'other', itemProfile: FOOD, primaryCategory: 'design' },
    ]
    const [r] = profileApplicabilityReport(docs, { project: 'tmz' })
    expect(r).toMatchObject({ project: 'tmz', items: 3, withoutProfile: 1 })
    expect(r.rows).toEqual([{ id: 'drafts.p1', draft: true, profile: FOOD, findings: [{ kind: 'primary', key: 'design', root: 'books', useFor: ['book'] }] }])
  })
})
