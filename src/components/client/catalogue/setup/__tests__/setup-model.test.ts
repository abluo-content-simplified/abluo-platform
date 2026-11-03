/**
 * Catalogue → Setup model (R2-B): who sees which section (ADR-042 N2a / spec §9.2), and the
 * screen-state → action payload mappings (channels, format templates, labels, deletion
 * choices, tree moves, impact counts).
 */
import { describe, expect, it } from 'vitest'
import { buildTree } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'
import { channelsFromInput, formatTemplatesFromInput } from '@/lib/modules/catalogue/settings/model'
import {
  SETUP_SECTIONS,
  canOpenSetupSection,
  channelInputs,
  channelsNeedMigration,
  cleanLabels,
  deletionNeeds,
  deletionOptions,
  flatTree,
  inheritedCategoryRule,
  isReorder,
  keyFromLabel,
  labelPatch,
  labelText,
  labelsOf,
  missingLocales,
  parseQuantity,
  previewImpact,
  reorderedList,
  reorderedSiblings,
  searchTree,
  setupHref,
  setupLanding,
  sumImpact,
  templateInputs,
  visibleSetupSections,
  type ChannelDraft,
} from '../setup-model'

const node = (key: string, parentKey: string | null, order: number, extra: Partial<CategoryNode> = {}): CategoryNode => ({
  key,
  label: { en: key[0].toUpperCase() + key.slice(1), it: key },
  parentKey,
  order,
  channelRules: {},
  defaultOptionListIds: [],
  archivedAt: null,
  ...extra,
})
const EVENING = { state: 'unavailable' as const, overrides: [{ kind: 'weekly' as const, key: 'eve', days: [], from: '18:00', to: '23:00', state: 'available' as const }] }
const TREE = buildTree([node('food', null, 1000, { channelRules: { delivery: EVENING } as never }), node('pizza', 'food', 1000), node('bianche', 'pizza', 1000), node('pasta', 'food', 2000), node('drinks', null, 2000)])
const SITE = { defaultLocale: 'en', locales: ['en', 'it'] }

describe('section visibility (N2a, spec §9.2)', () => {
  const matrix = [
    { who: 'Setup permission', access: { manage: true, taxonomy: false }, sees: [...SETUP_SECTIONS], landing: 'overview' },
    { who: 'Setup + category permission (Owner)', access: { manage: true, taxonomy: true }, sees: [...SETUP_SECTIONS], landing: 'overview' },
    { who: 'category permission only', access: { manage: false, taxonomy: true }, sees: ['categories'], landing: 'categories' },
    { who: 'neither', access: { manage: false, taxonomy: false }, sees: [], landing: null },
  ] as const
  for (const row of matrix) {
    it(`${row.who}: ${row.sees.join(', ') || 'nothing'}`, () => {
      expect(visibleSetupSections(row.access)).toEqual(row.sees)
      expect(setupLanding(row.access)).toBe(row.landing)
      for (const s of SETUP_SECTIONS) expect(canOpenSetupSection(s, row.access)).toBe((row.sees as readonly string[]).includes(s))
    })
  }
  it('hrefs: the Overview is the folder itself, each section its own route', () => {
    expect(setupHref('site-a', 'overview')).toBe('/site-a/catalogue/setup')
    expect(setupHref('site-a', 'categories')).toBe('/site-a/catalogue/setup/categories')
    expect(setupHref('site-a', 'starters')).toBe('/site-a/catalogue/setup/starters')
  })
})

describe('labels', () => {
  it('reads a stored label in a language with fallback, edits all site languages, sends only changes', () => {
    expect(labelText({ en: 'Food', it: 'Cibo' }, 'it', 'en')).toBe('Cibo')
    expect(labelText({ en: 'Food' }, 'de', 'en')).toBe('Food')
    expect(labelText({ _type: 'localizedString', it: 'Cibo' }, 'de', 'en')).toBe('Cibo')
    expect(labelText('Resolved', 'it', 'en')).toBe('Resolved')
    expect(labelsOf({ en: 'Food', _type: 'x' }, ['en', 'it'])).toEqual({ en: 'Food', it: '' })
    expect(cleanLabels({ en: ' Food ', it: ' ' })).toEqual({ en: 'Food' })
    expect(labelPatch({ en: 'Food', it: 'Cibo' }, { en: 'Food', it: '' })).toEqual({ it: null })
    expect(labelPatch({ en: 'Food', it: '' }, { en: 'Meals', it: 'Pasti' })).toEqual({ en: 'Meals', it: 'Pasti' })
    expect(missingLocales({ en: 'Food' }, ['en', 'it', 'de'])).toEqual(['it', 'de'])
  })
})

describe('stable keys (never shown)', () => {
  it('channel keys follow the C2 pattern, start with a letter and are unique', () => {
    expect(keyFromLabel('Take-away & Delivery', [], 'channel')).toBe('take-away-delivery')
    expect(keyFromLabel('Consegna à domicilio', [], 'channel')).toBe('consegna-a-domicilio')
    expect(keyFromLabel('24h', [], 'channel')).toBe('c-24h')
    expect(keyFromLabel('Delivery', ['delivery', 'delivery-2'], 'channel')).toBe('delivery-3')
    expect(keyFromLabel('***', [], 'channel')).toBe('channel')
    expect(keyFromLabel('x'.repeat(80), [], 'channel').length).toBeLessThanOrEqual(40)
  })
  it('template keys follow the term-key rule', () => {
    expect(keyFromLabel('Bottle 75 cl', [], 'template')).toBe('bottle-75-cl')
    expect(keyFromLabel('75 cl', ['75-cl'], 'template')).toBe('75-cl-2')
  })
})

describe('channels → saveCatalogueChannelsAction payload', () => {
  const list: ChannelDraft[] = [
    { key: 'dine-in', label: { en: 'Dine-in', it: '' }, active: true, defaultAvailability: 'available', defaultSchedule: [], explicitDefault: true },
    { key: 'delivery', label: { en: 'Delivery', it: 'Consegna' }, active: false, defaultAvailability: 'unavailable', defaultSchedule: EVENING.overrides, explicitDefault: true },
  ]
  it('keeps order, cleans labels and sends override rows the settings model reads back unchanged', () => {
    const input = channelInputs(list)
    expect(input).toEqual([
      { key: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available', defaultSchedule: [] },
      { key: 'delivery', label: { en: 'Delivery', it: 'Consegna' }, active: false, defaultAvailability: 'unavailable', defaultSchedule: [{ key: 'eve', days: [], from: '18:00', to: '23:00', state: 'available' }] },
    ])
    // Round trip through the server's own parser (no issues, same values).
    const parsed = channelsFromInput(input, [], SITE)
    expect(parsed.issues).toEqual([])
    expect(parsed.channels.map((c) => [c.key, c.active, c.defaultAvailability, c.defaultSchedule])).toEqual([
      ['dine-in', true, 'available', []],
      ['delivery', false, 'unavailable', EVENING.overrides],
    ])
  })
  it('stored channels without an explicit default mean the data update is still pending', () => {
    expect(channelsNeedMigration(list)).toBe(false)
    expect(channelsNeedMigration([{ ...list[0], explicitDefault: false }])).toBe(true)
  })
})

describe('format templates → saveCatalogueSettingsAction payload', () => {
  it('omits an empty quantity and passes the server parser', () => {
    const input = templateInputs([
      { key: 'glass', label: { en: 'Glass', it: '' }, quantity: { value: 15, unit: 'cl' } },
      { key: 'bottle', label: { en: 'Bottle' }, quantity: null },
    ])
    expect(input).toEqual([
      { key: 'glass', label: { en: 'Glass' }, quantity: { value: 15, unit: 'cl' } },
      { key: 'bottle', label: { en: 'Bottle' } },
    ])
    expect(formatTemplatesFromInput(input, SITE).issues).toEqual([])
  })
  it('quantities: decimals with comma or dot, empty = none, anything else refused', () => {
    expect(parseQuantity('0,75')).toBe(0.75)
    expect(parseQuantity('75')).toBe(75)
    expect(parseQuantity(' ')).toBeNull()
    expect(parseQuantity('0')).toBeUndefined()
    expect(parseQuantity('abc')).toBeUndefined()
  })
})

describe('tree moves', () => {
  it('same parent = reorder (taxonomy.write) with the new sibling order; another parent = a structure move', () => {
    expect(isReorder(TREE, { key: 'pasta', newParentKey: 'food', index: 0 })).toBe(true)
    expect(reorderedSiblings(TREE, { key: 'pasta', newParentKey: 'food', index: 0 })).toEqual(['pasta', 'pizza'])
    expect(isReorder(TREE, { key: 'pasta', newParentKey: 'pizza', index: 0 })).toBe(false)
    expect(reorderedSiblings(TREE, { key: 'drinks', newParentKey: null, index: 0 })).toEqual(['drinks', 'food'])
  })
  it('flat lists (tags, channels, templates) reorder by index', () => {
    expect(flatTree(['a', 'b', 'c']).roots).toEqual(['a', 'b', 'c'])
    expect(reorderedList(['a', 'b', 'c'], { key: 'c', newParentKey: null, index: 0 })).toEqual(['c', 'a', 'b'])
    expect(reorderedList(['a', 'b', 'c'], { key: 'a', newParentKey: null })).toEqual(['b', 'c', 'a'])
  })
  it('search keeps the ancestors of a match', () => {
    const found = searchTree(TREE, 'bianche', { locale: 'en', defaultLocale: 'en', locales: ['en'] })
    expect([...found.nodes.keys()].sort()).toEqual(['bianche', 'food', 'pizza'])
  })
})

describe('category availability: what Inherit gives', () => {
  const channel = { key: 'delivery', defaultAvailability: 'available' as const, defaultSchedule: [] }
  it('the nearest ancestor rule (complete, never merged), else the channel default', () => {
    const fromFood = inheritedCategoryRule(TREE, 'bianche', channel)
    expect(fromFood.rule).toEqual(EVENING)
    expect(fromFood.source).toMatchObject({ level: 'category', categoryKey: 'food', path: ['food'], inheritedFromAncestor: true })
    const top = inheritedCategoryRule(TREE, 'food', channel)
    expect(top).toEqual({ rule: { state: 'available', overrides: [] }, source: { level: 'projectDefault', channel: 'delivery' } })
    expect(inheritedCategoryRule(TREE, 'drinks', { ...channel, key: 'takeaway' }).source.level).toBe('projectDefault')
  })
})

describe('impact counts → ImpactPreview', () => {
  it('maps the server (C12) counts and sums several channel changes', () => {
    expect(previewImpact({ items: 12, formats: 3, toAvailable: 0, toUnavailable: 9, shieldedByOverride: 2 })).toEqual({ itemsChanged: 12, formatsChanged: 3, shieldedByOverride: 2 })
    expect(sumImpact([{ items: 1, formats: 2, shieldedByOverride: 0 }, { items: 3, formats: 0, shieldedByOverride: 1 }])).toEqual({ items: 4, formats: 2, shieldedByOverride: 1 })
  })
})

describe('category deletion choices (D-3)', () => {
  const blockers = [
    { code: 'used_as_primary' as const, count: 4, cleanable: true, sample: [] },
    { code: 'used_as_additional' as const, count: 2, cleanable: true, sample: [] },
    { code: 'has_children' as const, count: 1, cleanable: true, sample: [] },
    { code: 'referenced_by_listing' as const, count: 1, cleanable: false, sample: [] },
  ]
  it('names what needs a choice and what must be changed by hand', () => {
    const needs = deletionNeeds(blockers)
    expect(needs).toMatchObject({ items: 4, children: 1 })
    expect(needs.manual.map((b) => b.code)).toEqual(['referenced_by_listing'])
    expect(deletionNeeds([])).toEqual({ items: 0, children: 0, cleanup: [], manual: [] })
  })
  it('sends only the options the blockers ask for', () => {
    expect(deletionOptions({ items: 4, children: 1 }, { kind: 'move', to: 'pasta' }, { kind: 'parent' })).toEqual({ reassignTo: 'pasta', promoteChildrenTo: 'parent' })
    expect(deletionOptions({ items: 4, children: 1 }, { kind: 'remove' }, { kind: 'top' })).toEqual({ reassignTo: null, promoteChildrenTo: null })
    expect(deletionOptions({ items: 0, children: 2 }, null, { kind: 'into', to: 'drinks' })).toEqual({ promoteChildrenTo: 'drinks' })
    expect(deletionOptions({ items: 0, children: 0 }, { kind: 'remove' }, { kind: 'parent' })).toEqual({})
  })
})
