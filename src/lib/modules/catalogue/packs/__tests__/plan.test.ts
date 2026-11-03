/** C7.11 plan/*, update/*, bookshop/tmz fixtures — planPack / planPackUpdate are pure. */
import { describe, expect, it } from 'vitest'
import { explainAvailability, availabilityInputsOf, CATEGORY_RULES } from '../../commerce/channel-availability'
import { channelSetOf, readChannels } from '../../commerce/channels'
import { asChannelKey, asFormatKey } from '../../commerce/commerce-types'
import { IMPLICIT_FORMAT_KEY } from '../../commerce/formats'
import { readCategoryNodes } from '../../taxonomy/read'
import { buildTree } from '../../taxonomy/tree'
import type { CategoryNode } from '../../taxonomy/types'
import { buildPackMutations, configSet, taxonomyRows } from '../apply'
import { defaultSelection, packUpdateOffers, planPack, planPackUpdate, type CatalogueState, type PackSelection } from '../plan'
import { getPack, listPacks } from '../registry'
import type { AppliedPackRecord, PackDeclaration } from '../types'

const pizzeria = getPack('pizzeria')!
const cafe = getPack('cafe-and-bar')!
const bookshop = getPack('bookshop')!

function node(key: string, label: Record<string, string>, parentKey: string | null = null, o: Partial<CategoryNode> = {}): CategoryNode {
  return { key, label, parentKey, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null, ...o }
}

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
const sel = (pack: PackDeclaration, o: Partial<PackSelection> = {}): PackSelection => ({ ...defaultSelection(pack), ...o })
const keys = (items: readonly { area: string; key: string }[], area: string) => items.filter((i) => i.area === area).map((i) => i.key)

/** The state after applying a plan, as the readers see it (pure: through the mutation builder's rows). */
function after(s: CatalogueState, pack: PackDeclaration, selection: PackSelection): CatalogueState {
  const plan = planPack(s, pack, selection)
  const rows = taxonomyRows(plan, s)
  const set = configSet(plan, s, pack, { now: '2026-11-03T09:00:00Z', userId: 'u1', setupSource: 'pack' })
  const channels = readChannels(set.serviceChannels ?? s.raw.serviceChannels).channels.all
  return { ...s, categories: readCategoryNodes(rows.categories), channels, raw: { ...s.raw, categories: rows.categories, tags: rows.tags } }
}

describe('plan', () => {
  it('plan/empty-project: everything is added, nothing equivalent, no conflicts', () => {
    const plan = planPack(state(), pizzeria, sel(pizzeria))
    expect(keys(plan.add, 'category')).toEqual(pizzeria.categories.map((c) => c.key))
    expect(keys(plan.add, 'tag')).toEqual(pizzeria.tags.map((t) => t.key))
    expect(keys(plan.add, 'collection')).toEqual(['menu'])
    expect(keys(plan.add, 'section')).toEqual(['pizza', 'starters', 'salads', 'desserts', 'beverages'])
    expect(keys(plan.add, 'optionGroup')).toEqual(['extra_toppings', 'remove_ingredients'])
    expect(keys(plan.add, 'formatSuggestion')).toEqual(['glass_25', 'bottle_33', 'bottle_75'])
    expect(keys(plan.add, 'channelSuggestion')).toEqual(['dine-in', 'takeaway', 'delivery'])
    expect(keys(plan.add, 'setting')).toEqual(['publicName', 'defaultItemProfile', 'publicSegment'])
    expect(plan.equivalent).toEqual([])
    expect(plan.conflicts).toEqual([])
    expect(plan.needsChunking).toBe(false)
    // Policy suggestions wait for the publication-standards slice: listed, never written.
    expect(plan.skipped.map((s) => `${s.area}:${s.key}:${s.note}`)).toEqual(['policySuggestion:pizza_photo:not_available_yet'])
  })

  it('labels are restricted to the site languages (main language falls back to English)', () => {
    const plan = planPack(state({ defaultLocale: 'fr', locales: ['fr', 'de'] }), bookshop, sel(bookshop))
    expect(plan.add.find((i) => i.key === 'fiction')!.label).toEqual({ fr: 'Fiction', de: 'Belletristik' })
  })

  it('plan/key-equivalence: same key is equivalent; children attach; parent_differs only when parents differ', () => {
    const s = state({ categories: [node('food', { en: 'Food' }), node('pizza', { en: 'Pizza' }, 'food')] })
    const plan = planPack(s, pizzeria, sel(pizzeria))
    expect(keys(plan.equivalent, 'category')).toEqual(['pizza'])
    expect(plan.add.find((i) => i.key === 'pizza_bianche')!.parentKey).toBe('pizza')
    expect(plan.conflicts.filter((c) => c.code === 'parent_differs').map((c) => c.key)).toEqual(['pizza'])
    const root = planPack(state({ categories: [node('pizza', { en: 'Pizza' })] }), pizzeria, sel(pizzeria))
    expect(root.conflicts.filter((c) => c.code === 'parent_differs')).toEqual([])
  })

  it('plan/label-is-proposal: a label match is a proposal, never merged; unanswered = add anyway', () => {
    const s = state({ categories: [node('dolci', { en: 'Sweets', it: 'Dolci' })] })
    const itPizzeria = { ...pizzeria }
    const plan = planPack({ ...s, defaultLocale: 'it', locales: ['it', 'en'] }, itPizzeria, sel(itPizzeria))
    expect(keys(plan.add, 'category')).toContain('desserts')
    expect(plan.proposals).toContainEqual({ area: 'category', packKey: 'desserts', existingKey: 'dolci', basis: 'default_locale_label' })
    expect(keys(plan.equivalent, 'category')).not.toContain('desserts')
  })

  it('plan/resolution-use-existing: pack children attach under the person\'s node; history maps it', () => {
    const s = state({ categories: [node('dolci', { en: 'Desserts' })] })
    const traditional = getPack('traditional-restaurant')!
    const withChild: PackDeclaration = { ...traditional, categories: [...traditional.categories, { key: 'cakes', label: { en: 'Cakes', it: 'Torte', de: 'Kuchen' }, parent: 'desserts' }] }
    const plan = planPack(s, withChild, sel(withChild, { resolutions: { 'category:desserts': { use: 'existing', key: 'dolci' } } }))
    expect(keys(plan.add, 'category')).not.toContain('desserts')
    expect(plan.add.find((i) => i.key === 'cakes')!.parentKey).toBe('dolci')
    expect(plan.mapped).toEqual({ 'category:desserts': 'dolci' })
    const built = buildPackMutations(plan, withChild, s, { now: 'n', userId: 'u1', setupSource: 'pack' })
    expect(built.history.mapped).toEqual({ 'category:desserts': 'dolci' })
  })

  it('plan/archived-equivalent: equivalent with a note; never unarchived', () => {
    const s = state({ categories: [node('pizza', { en: 'Pizza' }, null, { archivedAt: '2026-01-01' })], raw: { categories: [{ _key: 'pizza', key: 'pizza', label: { en: 'Pizza' }, archivedAt: '2026-01-01', order: 1000 }], tags: [], serviceChannels: [], formatTemplates: [], collections: {} } })
    const plan = planPack(s, pizzeria, sel(pizzeria))
    expect(plan.equivalent.find((i) => i.key === 'pizza')!.note).toBe('archived_in_project')
    expect(taxonomyRows(plan, s).categories[0]).toEqual(s.raw.categories[0])
  })

  it('plan/segment-clash: blocking; plan/segment-set: info, unchanged', () => {
    const clash = planPack(state({ pageFirstSegments: ['menu'] }), pizzeria, sel(pizzeria))
    expect(clash.conflicts).toContainEqual(expect.objectContaining({ code: 'segment_clash', blocking: true }))
    const set = planPack(state({ settings: { ...state().settings, publicSegment: 'carta' } }), pizzeria, sel(pizzeria))
    expect(set.conflicts).toContainEqual(expect.objectContaining({ code: 'setting_differs', key: 'publicSegment', blocking: false }))
    expect(keys(set.add, 'setting')).not.toContain('publicSegment')
  })

  it('plan/slug-collision: blocking until slugOverrides clears it', () => {
    const s = state({ takenSlugs: [{ locale: 'en', slug: 'menu', id: 'item-1' }] })
    const plan = planPack(s, pizzeria, sel(pizzeria))
    expect(plan.conflicts).toContainEqual({ code: 'slug_collision', area: 'collection', key: 'menu', blocking: true, detail: { locale: 'en', slug: 'menu' } })
    const cleared = planPack(s, pizzeria, sel(pizzeria, { slugOverrides: { menu: { en: 'our-menu' } } }))
    expect(cleared.conflicts.filter((c) => c.code === 'slug_collision')).toEqual([])
    expect(cleared.add.find((i) => i.area === 'collection')!.slugs).toEqual({ en: 'our-menu', it: 'menu' })
  })

  it('plan/limit: at 299 categories, a pack adding more than one → limit_exceeded', () => {
    const many = Array.from({ length: 298 }, (_, i) => node(`c${i}`, { en: `C ${i}` }))
    const plan = planPack(state({ categories: many }), bookshop, sel(bookshop, { exclude: ['category:non_fiction', 'category:fiction'] }))
    expect(keys(plan.add, 'category')).toHaveLength(2)
    expect(plan.conflicts.find((c) => c.code === 'limit_exceeded')).toBeUndefined()
    const over = planPack(state({ categories: [...many, node('c299', { en: 'C 299' })] }), bookshop, sel(bookshop))
    expect(over.conflicts).toContainEqual(expect.objectContaining({ code: 'limit_exceeded', blocking: true }))
  })

  it('plan/channel-default-explicit + plan/channel-schedule-written: an item created afterwards is available on dine-in and takeaway all week, delivery 18:00–23:00, spirits never on delivery', () => {
    const s = state()
    const selection = sel(pizzeria, { acceptChannels: ['dine-in', 'takeaway', 'delivery'] })
    const plan = planPack(s, pizzeria, selection)
    expect(plan.add.find((i) => i.key === 'dine-in')!.channel).toEqual({ defaultAvailability: 'available', defaultSchedule: [] })
    expect(plan.add.find((i) => i.key === 'delivery')!.channel).toEqual({ defaultAvailability: 'unavailable', defaultSchedule: [{ kind: 'weekly', key: 'evening', days: [], from: '18:00', to: '23:00', state: 'available' }] })
    const set = configSet(plan, s, pizzeria, { now: 'n', userId: 'u', setupSource: 'pack' })
    expect(set.serviceChannels).toEqual([
      expect.objectContaining({ value: 'dine-in', active: true, defaultAvailability: 'available' }),
      expect.objectContaining({ value: 'takeaway', active: true, defaultAvailability: 'available' }),
      expect.objectContaining({ value: 'delivery', active: true, defaultAvailability: 'unavailable', defaultSchedule: [{ _key: 'evening', _type: 'catalogueWeeklyOverride', from: '18:00', to: '23:00', state: 'available' }] }),
    ])
    const a = after(s, pizzeria, selection)
    const tree = buildTree([...a.categories])
    const inputs = availabilityInputsOf(channelSetOf(a.channels), { tree, category: CATEGORY_RULES })
    const item = (primary: string) => ({ itemId: 'i', primaryCategory: primary, itemRules: new Map(), formats: [{ key: asFormatKey(IMPLICIT_FORMAT_KEY), implicit: true, availability: new Map() }] })
    const at = (iso: string, primary: string, channel: string) => explainAvailability(inputs, item(primary), asFormatKey(IMPLICIT_FORMAT_KEY), { kind: 'channel', channel: asChannelKey(channel) }, new Date(iso), 'Europe/Rome').state
    // Tuesday 2026-11-03 (CET = UTC+1)
    expect(at('2026-11-03T18:00:00Z', 'pizza_classiche', 'delivery')).toBe('available') // 19:00 local
    expect(at('2026-11-03T14:00:00Z', 'pizza_classiche', 'delivery')).toBe('unavailable') // 15:00 local
    expect(at('2026-11-03T14:00:00Z', 'pizza_classiche', 'dine-in')).toBe('available')
    expect(at('2026-11-03T03:00:00Z', 'pizza_classiche', 'takeaway')).toBe('available')
    expect(at('2026-11-03T18:00:00Z', 'spirits', 'delivery')).toBe('unavailable')
  })

  it('plan/category-schedules-written: breakfast 07:00–11:00, cocktails overnight', () => {
    const s = state()
    const selection = sel(cafe, { acceptChannels: ['dine-in', 'takeaway'], channelRules: 'apply' })
    const plan = planPack(s, cafe, selection)
    const rows = taxonomyRows(plan, s).categories
    expect(rows.find((r) => r.key === 'breakfast')!.channelRules).toEqual([
      { _key: 'dine-in', _type: 'catalogueChannelRule', channel: 'dine-in', state: 'unavailable', schedule: [{ _key: 'breakfast', _type: 'catalogueWeeklyOverride', from: '07:00', to: '11:00', state: 'available' }] },
      { _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state: 'unavailable', schedule: [{ _key: 'breakfast', _type: 'catalogueWeeklyOverride', from: '07:00', to: '11:00', state: 'available' }] },
    ])
    const a = after(s, cafe, selection)
    const inputs = availabilityInputsOf(channelSetOf(a.channels), { tree: buildTree([...a.categories]), category: CATEGORY_RULES })
    const at = (iso: string, primary: string) =>
      explainAvailability(inputs, { itemId: 'i', primaryCategory: primary, itemRules: new Map(), formats: [{ key: asFormatKey(IMPLICIT_FORMAT_KEY), implicit: true, availability: new Map() }] }, asFormatKey(IMPLICIT_FORMAT_KEY), { kind: 'channel', channel: asChannelKey('dine-in') }, new Date(iso), 'Europe/Rome').state
    expect(at('2026-11-03T07:00:00Z', 'breakfast')).toBe('available') // 08:00
    expect(at('2026-11-03T11:00:00Z', 'breakfast')).toBe('unavailable') // 12:00
    expect(at('2026-11-03T23:30:00Z', 'cocktails')).toBe('available') // 00:30 Wed, started Tue
    expect(at('2026-11-03T11:00:00Z', 'cocktails')).toBe('unavailable')
  })

  it('plan/schedule-declined: no category rule, no schedule; Pizzeria delivery written available', () => {
    const plan = planPack(state(), pizzeria, sel(pizzeria, { channelRules: 'skip' }))
    expect(plan.add.filter((i) => i.rules?.length)).toEqual([])
    expect(plan.add.find((i) => i.key === 'delivery')!.channel).toEqual({ defaultAvailability: 'available', defaultSchedule: [] })
    expect(taxonomyRows(plan, state()).categories.some((r) => r.channelRules)).toBe(false)
  })

  it('plan/schedules-never-overwrite: the tenant\'s own rule on an equivalent category is untouched (setting_differs)', () => {
    const own = { 'dine-in': { state: 'available' as const, overrides: [] } }
    const s = state({
      categories: [node('breakfast', { en: 'Breakfast' }, null, { channelRules: own as never })],
      channels: readChannels([{ _key: 'c', value: 'dine-in', label: { en: 'Dine-in' }, active: true, defaultAvailability: 'available' }]).channels.all,
      raw: { categories: [{ _key: 'breakfast', key: 'breakfast', label: { en: 'Breakfast' }, order: 1000, channelRules: [{ _key: 'dine-in', channel: 'dine-in', state: 'available' }] }], tags: [], serviceChannels: [], formatTemplates: [], collections: {} },
    })
    const plan = planPack(s, cafe, sel(cafe))
    expect(keys(plan.equivalent, 'category')).toContain('breakfast')
    expect(plan.conflicts).toContainEqual({ code: 'setting_differs', area: 'category', key: 'breakfast', blocking: false, detail: { channel: 'dine-in' } })
    expect(taxonomyRows(plan, s).categories[0]).toEqual(s.raw.categories[0])
  })

  it('plan/channels-never-activated: nothing ticked → no channel, rules reported and not written', () => {
    const plan = planPack(state(), pizzeria, sel(pizzeria, { acceptChannels: [] }))
    expect(keys(plan.add, 'channelSuggestion')).toEqual([])
    expect(plan.skipped.filter((i) => i.area === 'channelSuggestion').map((i) => i.note)).toEqual(['declined', 'declined', 'declined'])
    expect(plan.conflicts).toContainEqual({ code: 'rule_skipped_inactive_channel', area: 'category', key: 'spirits', blocking: false, detail: { channel: 'delivery' } })
    expect(configSet(plan, state(), pizzeria, { now: 'n', userId: 'u', setupSource: 'pack' }).serviceChannels).toBeUndefined()
  })

  it('an existing INACTIVE channel is never activated, and gets no rule', () => {
    const s = state({ channels: readChannels([{ _key: 'c', value: 'delivery', label: { en: 'Delivery' }, active: false, defaultAvailability: 'unavailable' }]).channels.all })
    const plan = planPack(s, pizzeria, sel(pizzeria))
    expect(keys(plan.equivalent, 'channelSuggestion')).toEqual(['delivery'])
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ code: 'rule_skipped_inactive_channel', key: 'spirits' }))
  })

  it('plan/currency-readonly: the plan has no currency element; config writes never name it', () => {
    const plan = planPack(state(), pizzeria, sel(pizzeria))
    expect(JSON.stringify(plan)).not.toMatch(/currency/i)
    expect(Object.keys(configSet(plan, state(), pizzeria, { now: 'n', userId: 'u', setupSource: 'pack' }))).not.toContain('currency')
  })

  it('plan/idempotent: after apply everything is equivalent and the pack is already applied', () => {
    const s = state()
    const plan = planPack(s, bookshop, sel(bookshop))
    const rows = taxonomyRows(plan, s)
    const applied: AppliedPackRecord = buildPackMutations(plan, bookshop, s, { now: 'n', userId: 'u', setupSource: 'pack' }).history
    const next = state({
      categories: readCategoryNodes(rows.categories),
      tags: rows.tags.map((r) => ({ key: r.key!, label: r.label as Record<string, string>, order: r.order as number, archivedAt: null })),
      collections: [{ id: 'catalogue-collection.trattoria.all-books', exists: 'draft', name: { en: 'All books' }, slugs: {}, sectionKeys: ['books'] }],
      formatTemplates: bookshop.formatSuggestions.map((f) => ({ key: f.key, label: { en: f.label.en } })),
      settings: { setupCompletedAt: 'n', publicSegment: 'books', publicSegmentHistory: ['books'], publicName: { en: 'Books', it: 'Libri' }, defaultItemProfile: 'book' },
      history: [applied],
    })
    const again = planPack(next, bookshop, sel(bookshop))
    expect(again.add).toEqual([])
    expect(again.conflicts).toContainEqual(expect.objectContaining({ code: 'pack_already_applied', blocking: true }))
  })

  it('the fingerprint changes with the state revisions and with the selection', () => {
    const a = planPack(state(), pizzeria, sel(pizzeria))
    expect(planPack(state(), pizzeria, sel(pizzeria)).fingerprint).toBe(a.fingerprint)
    expect(planPack(state({ revisions: { project: 'p2', taxonomy: 't1', history: '' } }), pizzeria, sel(pizzeria)).fingerprint).not.toBe(a.fingerprint)
    expect(planPack(state(), pizzeria, sel(pizzeria, { channelRules: 'skip' })).fingerprint).not.toBe(a.fingerprint)
  })

  it('excluding a category excludes its whole subtree', () => {
    const plan = planPack(state(), pizzeria, sel(pizzeria, { exclude: ['category:beverages'] }))
    expect(keys(plan.add, 'category')).not.toEqual(expect.arrayContaining(['beverages', 'beer', 'spirits']))
    expect(plan.skipped.filter((i) => i.area === 'category').map((i) => i.key)).toEqual(['beverages', 'soft_drinks', 'beer', 'wine', 'spirits'])
  })

  it('channel_migration_pending blocks ticked channels while stored channels await D2', () => {
    const plan = planPack(state({ channelsUnmigrated: true }), pizzeria, sel(pizzeria))
    expect(plan.conflicts.filter((c) => c.code === 'channel_migration_pending').map((c) => c.blocking)).toEqual([true, true, true])
    expect(planPack(state({ channelsUnmigrated: true }), pizzeria, sel(pizzeria, { acceptChannels: [] })).conflicts.some((c) => c.code === 'channel_migration_pending')).toBe(false)
  })
})

describe('update', () => {
  const v3: AppliedPackRecord = {
    _key: 'pizzeria@3',
    id: 'pizzeria',
    version: 3,
    appliedAt: '2026-11-01',
    appliedBy: 'u1',
    added: { categories: pizzeria.categories.map((c) => c.key), tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: [] },
    mapped: {},
    skipped: [],
  }
  const v4: PackDeclaration = {
    ...pizzeria,
    version: 4,
    categories: [...pizzeria.categories.filter((c) => c.key !== 'calzoni'), { key: 'focacce', label: { en: 'Focaccia', it: 'Focacce', de: 'Focaccia' }, parent: null }, { key: 'fritti_dolci', label: { en: 'Sweet fried', it: 'Fritti dolci', de: 'Süßes Frittiertes' }, parent: 'desserts' }],
  }

  it('update/offer: two new categories added; dropped one in noLongerInPack; tenant-deleted one in removedByTenant', () => {
    const existing = pizzeria.categories.filter((c) => c.key !== 'calzoni' && c.key !== 'salads').map((c) => node(c.key, { en: c.label.en }, c.parent))
    const s = state({ categories: existing, history: [v3] })
    const plan = planPackUpdate(s, v3, pizzeria, v4, sel(v4))
    expect(keys(plan.add, 'category')).toEqual(['focacce', 'fritti_dolci'])
    expect(plan.noLongerInPack.map((i) => `${i.area}:${i.key}`)).toContain('category:calzoni')
    expect(plan.removedByTenant.map((i) => i.key)).toEqual(['salads'])
    expect(plan.from).toBe(3)
  })

  it('update/never-auto: an offer is computed, nothing else (the planner is pure, no mutation without applyPack)', () => {
    expect(packUpdateOffers([v3], [v4])).toEqual([{ id: 'pizzeria', fromVersion: 3, toVersion: 4 }])
    expect(packUpdateOffers([v3], listPacks())).toEqual([])
  })

  it('guard/legacy-preset + bookshop/tmz: bookshop@1 offers bookshop@3 — segment equivalent, profile kept (product), categories/tags/formats as additions', () => {
    const legacy: AppliedPackRecord = { _key: 'bookshop@1', id: 'bookshop', version: 1, appliedAt: '2026-06-01', appliedBy: 'migration', added: { categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: ['publicSegment', 'defaultItemProfile'] }, mapped: {}, skipped: [] }
    expect(packUpdateOffers([legacy], listPacks())).toEqual([{ id: 'bookshop', fromVersion: 1, toVersion: 3 }])
    const tmz = state({
      projectSlug: 'tmz',
      locales: ['en', 'it', 'de'],
      categories: [node('technology', { en: 'Technology' }), node('design', { en: 'Design' }), node('literature', { en: 'Literature' })],
      settings: { setupCompletedAt: '2026-06-01', publicSegment: 'books', publicSegmentHistory: ['books'], publicName: { en: 'Books', it: 'Libri', de: 'Bücher' }, defaultItemProfile: 'product' },
      history: [legacy],
    })
    const plan = planPackUpdate(tmz, legacy, null, bookshop, sel(bookshop))
    expect(plan.equivalent.find((i) => i.key === 'publicSegment')?.note).toBe('already_set')
    expect(plan.conflicts).toContainEqual({ code: 'setting_differs', area: 'setting', key: 'defaultItemProfile', blocking: false })
    expect(keys(plan.add, 'category')).toEqual(bookshop.categories.map((c) => c.key))
    expect(keys(plan.add, 'tag')).toEqual(bookshop.tags.map((t) => t.key))
    expect(keys(plan.add, 'formatSuggestion')).toEqual(['paperback', 'hardcover', 'ebook'])
    expect(plan.proposals).toEqual([]) // "Art and design" ≠ "Design"
    expect(plan.conflicts.filter((c) => c.blocking)).toEqual([])
    // setup already complete: never re-stamped
    expect(configSet(plan, tmz, bookshop, { now: 'n', userId: 'u', setupSource: 'pack' })).not.toHaveProperty('setupCompletedAt')
  })
})
