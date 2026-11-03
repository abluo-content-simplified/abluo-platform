/** C1.12.8 (D-22) pack/use-for — every pack sets "Use for"; plan → apply writes it on created nodes only. */
import { describe, expect, it } from 'vitest'
import { profilesWith } from '../../profiles'
import { readCategoryNodes, readTagNodes } from '../../taxonomy/read'
import { buildTree } from '../../taxonomy/tree'
import { effectiveProfiles } from '../../taxonomy/profile-applicability'
import { packOptionListDoc, taxonomyRows } from '../apply'
import { defaultSelection, planPack, type CatalogueState } from '../plan'
import { RELEASED_PACK_VERSIONS, getPack, listPacks } from '../registry'
import { validatePackDeclaration, validateRegistry } from '../validate'
import { withExtraCategory } from '@/components/client/catalogue/setup/starters/starters-model'
import type { PackDeclaration } from '../types'

const FOOD = profilesWith('foodInformation')[0]

function state(o: Partial<CatalogueState> = {}): CatalogueState {
  return {
    projectSlug: 'trattoria',
    defaultLocale: 'en',
    locales: ['en', 'it'],
    categories: [],
    tags: [],
    channels: [],
    channelsUnmigrated: false,
    settings: { setupCompletedAt: null, publicSegment: null, publicSegmentHistory: [], publicName: {}, defaultItemProfile: null },
    collections: [],
    takenSlugs: [],
    optionLists: [],
    formatTemplates: [],
    pageFirstSegments: [],
    history: [],
    revisions: { project: 'p1', taxonomy: 't1', history: '' },
    raw: { categories: [], tags: [], serviceChannels: [], formatTemplates: [], collections: {} },
    ...o,
  }
}

describe('pack/use-for (C1.12.8)', () => {
  it('the registry stays valid; every root and option group of a non-empty pack declares "Use for"', () => {
    expect(validateRegistry(listPacks(), RELEASED_PACK_VERSIONS)).toEqual([])
    for (const p of listPacks()) {
      for (const c of p.categories) {
        if (c.parent === null) expect(c.useFor?.length, `${p.id}.${c.key}`).toBeGreaterThan(0)
        else expect(c.useFor, `${p.id}.${c.key}`).toBeUndefined()
      }
      for (const g of p.optionGroups) expect(g.useFor?.length, `${p.id}.${g.key}`).toBeGreaterThan(0)
    }
  })

  it('Bookshop → Book; the five restaurant packs → Food or drink; generic tags stay for every type', () => {
    const roots = (id: string) => getPack(id)!.categories.filter((c) => c.parent === null).map((c) => c.useFor)
    expect(new Set(roots('bookshop').map((u) => u!.join()))).toEqual(new Set(['book']))
    for (const id of ['pizzeria', 'traditional-restaurant', 'fine-dining', 'cafe-and-bar', 'wine-bar']) expect(new Set(roots(id).map((u) => u!.join()))).toEqual(new Set([FOOD]))
    const tag = (pack: string, key: string) => getPack(pack)!.tags.find((t) => t.key === key)!
    expect(tag('bookshop', 'new').useFor).toBeUndefined()
    expect(tag('pizzeria', 'seasonal').useFor).toBeUndefined()
    expect(tag('bookshop', 'signed_copy').useFor).toEqual(['book'])
    expect(tag('pizzeria', 'spicy').useFor).toEqual([FOOD])
  })

  it('validation codes: missing on a root, present on a child, unknown profile', () => {
    const base = getPack('bookshop')!
    const bad: PackDeclaration = {
      ...base,
      categories: [
        { key: 'a', label: base.categories[0].label, parent: null },
        { key: 'b', label: base.categories[1].label, parent: 'a', useFor: ['book'] },
        { key: 'c', label: base.categories[2].label, parent: null, useFor: ['nope' as never] },
      ],
    }
    const codes = validatePackDeclaration(bad, { released: [1], otherIds: [] }).map((i) => i.code)
    expect(codes).toEqual(expect.arrayContaining(['pack_use_for_missing', 'pack_use_for_not_root', 'pack_profile_unknown']))
  })

  it('plan → apply writes "Use for" on created roots, tags and option lists; children inherit', () => {
    const pizzeria = getPack('pizzeria')!
    const plan = planPack(state(), pizzeria, defaultSelection(pizzeria))
    expect(plan.add.find((i) => i.area === 'category' && i.key === 'pizza')).toMatchObject({ useFor: [FOOD] })
    expect(plan.add.find((i) => i.area === 'category' && i.key === 'pizza_bianche')).not.toHaveProperty('useFor')
    const rows = taxonomyRows(plan, state())
    const tree = buildTree(readCategoryNodes(rows.categories))
    expect(effectiveProfiles(tree, 'pizza_bianche')).toEqual([FOOD])
    expect(rows.categories.find((r) => r.key === 'pizza_bianche')).not.toHaveProperty('useFor')
    expect(readTagNodes(rows.tags).find((t) => t.key === 'spicy')!.useFor).toEqual([FOOD])
    expect(readTagNodes(rows.tags).find((t) => t.key === 'new')).not.toHaveProperty('useFor')
    const group = plan.add.find((i) => i.area === 'optionGroup')!
    expect(packOptionListDoc(state(), group, pizzeria, (l) => l as Record<string, string>).useFor).toEqual([FOOD])
  })

  it('never writes "Use for" on an existing (equivalent) node — the tenant’s choice stays', () => {
    const existing = [{ _key: 'pizza', _type: 'catalogueCategory', key: 'pizza', label: { _type: 'localizedString', en: 'Pizza' }, order: 1000 }]
    const s = state({ categories: readCategoryNodes(existing), raw: { categories: existing, tags: [], serviceChannels: [], formatTemplates: [], collections: {} } })
    const pizzeria = getPack('pizzeria')!
    const rows = taxonomyRows(planPack(s, pizzeria, defaultSelection(pizzeria)), s)
    expect(rows.categories[0]).toEqual(existing[0])
  })

  it('the person’s own top-level category in a pack preview gets the pack’s item type; a child inherits', () => {
    const pizzeria = getPack('pizzeria')!
    const s1 = withExtraCategory(defaultSelection(pizzeria), pizzeria, null, { en: 'Focacce' }, null, 'en')
    expect(s1.extras?.categories?.[0]).toMatchObject({ parent: null, useFor: [FOOD] })
    const s2 = withExtraCategory(defaultSelection(pizzeria), pizzeria, null, { en: 'Rosse' }, 'pizza', 'en')
    expect(s2.extras?.categories?.[0]).not.toHaveProperty('useFor')
    const plan = planPack(state(), pizzeria, s1)
    expect(plan.add.find((i) => i.area === 'category' && i.label.en === 'Focacce')).toMatchObject({ useFor: [FOOD] })
  })
})
