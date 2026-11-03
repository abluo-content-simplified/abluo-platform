/**
 * Catalogue V2 R2 — the item writer (C10-6 R2 row; C3, C4, C5/C5a, C1).
 *
 * Every switched writer leaves EXACTLY ONE shape on the document it wrote:
 * formats (+ channelAvailability) xor offers; primaryCategory/additionalCategories
 * xor categories. Legacy documents convert on their first save — whatever that
 * save touches — with exactly what the dual-read showed. Values are rebuilt and
 * validated with the commerce/taxonomy pure functions.
 */
import { describe, expect, it } from 'vitest'
import { CatalogueError, cleanCatalogueSet, type CleanedPatch, type PatchContext } from '../dashboard-patch'
import { assignmentSet, emptyFormats, formatsPatch, itemCommerceFromDoc, itemRulesPatch, itemStateFromDoc } from '../dashboard-form'
import { readChannels } from '../commerce/channels'
import { commerceOf, legacyOffersToFormats } from '../commerce/legacy-commerce'
import { readFormatDocs } from '../commerce/read'
import { asFormatKey, type ChannelAvailabilityRule } from '../commerce/commerce-types'
import type { Format } from '../commerce/formats'
import { buildTree } from '../taxonomy/tree'
import { itemCategoryAssignment } from '../taxonomy/read'
import type { CategoryNode } from '../taxonomy/types'
import { convertedAssignment, scheduleChanges } from '../item-writer'
import { cataloguePublishGate } from '@/lib/api/catalogue-publish-gate'
import type { CatalogueSite } from '@/lib/api/catalogue-drafts'
import type { LifecycleClient, PublishNode } from '@/lib/lifecycle/service'

const cat = (key: string, parentKey: string | null = null, archivedAt: string | null = null): CategoryNode => ({ key, label: { it: key }, parentKey, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt })
const TREE = buildTree([cat('food'), cat('pizza', 'food'), cat('drinks'), cat('old', null, '2026-01-01T00:00:00Z')])
// A migrated channel project (explicit defaults) and an unmigrated one (legacy entries, C10-4).
const MIGRATED = readChannels([
  { value: 'dine-in', label: { it: 'Al tavolo' }, defaultAvailability: 'unavailable' },
  { value: 'takeaway', label: { it: 'Asporto' }, defaultAvailability: 'unavailable' },
]).channels
const UNMIGRATED = readChannels([{ value: 'dine-in', label: { it: 'Al tavolo' } }, { value: 'takeaway', label: { it: 'Asporto' } }]).channels
const NONE = readChannels([]).channels

let n = 0
const ctx = (o: Partial<PatchContext> = {}): PatchContext => ({
  locales: new Set(['it', 'en']),
  defaultLocale: 'it',
  channels: ['dine-in', 'takeaway'],
  categories: ['food', 'pizza', 'drinks', 'old'],
  tags: [],
  dietary: [],
  previous: {},
  newKey: () => `k${++n}`,
  channelSet: MIGRATED,
  categoryTree: TREE,
  ...o,
})
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CatalogueError ? e.code : 'other'
  }
  return 'ok'
}

/** What Sanity leaves after setIfMissing → set → unset on top-level and one-level dotted paths. */
function apply(doc: Record<string, unknown>, p: CleanedPatch): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(doc)
  for (const [k, v] of Object.entries(p.setIfMissing)) if (out[k] === undefined) out[k] = v
  for (const [path, v] of Object.entries(p.set)) {
    const [a, b] = path.split('.')
    if (b === undefined) out[a] = v
    else out[a] = { ...((out[a] as Record<string, unknown>) ?? {}), [b]: v }
  }
  for (const path of p.unset) {
    const [a, b] = path.split('.')
    if (b === undefined) delete out[a]
    else if (out[a] && typeof out[a] === 'object') delete (out[a] as Record<string, unknown>)[b]
  }
  return out
}
const oneCommerceShape = (d: Record<string, unknown>) => !(d.formats !== undefined && d.offers !== undefined)
const oneCategoryShape = (d: Record<string, unknown>) => !((d.primaryCategory !== undefined || d.additionalCategories !== undefined) && d.categories !== undefined)

const LEGACY = {
  itemProfile: 'product',
  name: { _type: 'localizedString', it: 'Margherita' },
  offers: [
    { _key: 'o1', _type: 'catalogueOffer', price: 8, priceNote: { _type: 'localizedString', it: 'a pezzo' } },
    { _key: 'o2', _type: 'catalogueOffer', channel: 'takeaway', price: 7, availability: [{ _key: 'w', days: ['fri'], from: '18:00', to: '02:00' }] },
  ],
  categories: ['nope', 'pizza', 'drinks'],
}

describe('legacy → new on the first save, whatever it touches (C10-6 R2)', () => {
  it('a name edit converts offers → formats and categories → primary/additional, unsetting both legacy fields', () => {
    const r = cleanCatalogueSet('item', { 'name.it': 'Margherita DOP' }, ctx({ previous: LEGACY }))
    const after = apply(LEGACY, r)
    expect(oneCommerceShape(after)).toBe(true)
    expect(oneCategoryShape(after)).toBe(true)
    expect(after.offers).toBeUndefined()
    expect(after.categories).toBeUndefined()
    expect(after.formats).toEqual(legacyOffersToFormats(LEGACY.offers))
    // D-15: the first EXISTING category is primary; nothing stored is dropped.
    expect({ primary: after.primaryCategory, additional: after.additionalCategories }).toEqual({ primary: 'pizza', additional: ['nope', 'drinks'] })
  })
  it('what the dual-read showed is exactly what is stored (formats, prices, notes, windows, keys)', () => {
    const before = commerceOf(LEGACY, MIGRATED)
    const after = commerceOf(apply(LEGACY, cleanCatalogueSet('item', { visibility: 'public' }, ctx({ previous: LEGACY }))), MIGRATED)
    expect(after.formats).toEqual(before.formats)
    expect([...after.itemRules]).toEqual([...before.itemRules])
    expect(after.source).toBe('formats')
  })
  it('in an UNMIGRATED channel project the availability the offers implied becomes explicit rows (behaviour unchanged)', () => {
    const r = cleanCatalogueSet('item', { visibility: 'public' }, ctx({ previous: LEGACY, channelSet: UNMIGRATED }))
    const after = apply(LEGACY, r)
    expect(after.channelAvailability).toEqual([
      { _key: 'dine-in', _type: 'catalogueChannelRule', channel: 'dine-in', state: 'available' },
      { _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state: 'available' },
    ])
    expect([...commerceOf(after, UNMIGRATED).itemRules]).toEqual([...commerceOf(LEGACY, UNMIGRATED).itemRules])
  })
  it('in a migrated project (and with no channels) no rows are invented', () => {
    expect(apply(LEGACY, cleanCatalogueSet('item', { visibility: 'public' }, ctx({ previous: LEGACY }))).channelAvailability).toBeUndefined()
    expect(apply(LEGACY, cleanCatalogueSet('item', { visibility: 'public' }, ctx({ previous: LEGACY, channelSet: NONE }))).channelAvailability).toBeUndefined()
  })
  it('a document with no offers and no categories gets no commerce or category writes', () => {
    const r = cleanCatalogueSet('item', { 'name.it': 'Nuovo' }, ctx({ previous: { itemProfile: 'product' } }))
    expect(r.set).toEqual({ 'name.it': 'Nuovo' })
    expect(r.unset).toEqual([])
  })
  it('a legacy document with an empty offers list: offers unset, no formats written', () => {
    const r = cleanCatalogueSet('item', { visibility: 'public' }, ctx({ previous: { offers: [] } }))
    expect(r.unset).toContain('offers')
    expect(r.set.formats).toBeUndefined()
  })
  it('a shadowed legacy list next to formats is removed and the formats kept', () => {
    const prev = { formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [] }], offers: [{ _key: 'x', price: 1 }] }
    const after = apply(prev, cleanCatalogueSet('item', { visibility: 'public' }, ctx({ previous: prev })))
    expect(after.offers).toBeUndefined()
    expect(after.formats).toEqual(prev.formats)
  })
})

describe('formats writer (C3, C4) — formats xor offers', () => {
  const price = (o: Record<string, unknown>) => ({ _key: `p${++n}`, amount: 5, ...o })
  it('writes the stored shape (types, keys kept) and unsets offers on the same document', () => {
    const r = cleanCatalogueSet('item', { formats: [{ _key: 'default', prices: [price({ _key: 'a', amount: 8.5, note: { it: 'a pezzo' } })] }] }, ctx({ previous: LEGACY }))
    const after = apply(LEGACY, r)
    expect(oneCommerceShape(after)).toBe(true)
    expect(after.formats).toEqual([{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'a', _type: 'cataloguePrice', amount: 8.5, note: { _type: 'localizedString', it: 'a pezzo' } }] }])
  })
  it('two formats need a name in the main language; a third locale, 25 formats, reserved fields are refused', () => {
    const two = [{ _key: 'a', label: { it: 'Piccola' }, prices: [] }, { _key: 'b', label: { en: 'Large' }, prices: [] }]
    expect(code(() => cleanCatalogueSet('item', { formats: two }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { formats: [{ _key: 'a', label: { fr: 'x' }, prices: [] }] }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { formats: Array.from({ length: 25 }, (_, i) => ({ _key: `f${i}`, label: { it: `F${i}` }, prices: [] })) }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { formats: Array.from({ length: 24 }, (_, i) => ({ _key: `f${i}`, label: { it: `F${i}` }, prices: [] })) }, ctx()))).toBe('ok')
    expect(code(() => cleanCatalogueSet('item', { formats: [{ _key: 'default', prices: [price({ currency: 'USD' })] }] }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { formats: [{ _key: 'default', prices: [price({ locationKey: 'x' })] }] }, ctx()))).toBe('invalid_value')
  })
  it('prices: amount rules, unknown channel, overlap within one scope (I-C4-2) — across scopes is fine', () => {
    const f = (prices: unknown[]) => ({ formats: [{ _key: 'default', prices }] })
    expect(code(() => cleanCatalogueSet('item', f([price({ amount: -1 })]), ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', f([price({ amount: 1.005 })]), ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', f([price({ channel: 'delivery' })]), ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', f([price({}), price({})]), ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', f([price({}), price({ channel: 'takeaway' })]), ctx()))).toBe('ok')
    expect(code(() => cleanCatalogueSet('item', f([price({ windows: [{ days: ['mon'], from: '12:00', to: '15:00' }] }), price({ windows: [{ days: ['mon'], from: '18:00', to: '23:00' }] })]), ctx()))).toBe('ok')
    expect(code(() => cleanCatalogueSet('item', f([price({ windows: [{ days: ['mon'], from: '12:00', to: '12:00' }] })]), ctx()))).toBe('invalid_value')
  })
  it('an implicit format carries no availability override (I-C3-4); a named one may', () => {
    const rule = [{ channel: 'takeaway', state: 'unavailable' }]
    expect(code(() => cleanCatalogueSet('item', { formats: [{ _key: 'default', channelAvailability: rule, prices: [] }] }, ctx()))).toBe('invalid_value')
    const two = [{ _key: 'a', label: { it: 'Bicchiere' }, channelAvailability: rule, prices: [] }, { _key: 'b', label: { it: 'Bottiglia' }, prices: [] }]
    const r = cleanCatalogueSet('item', { formats: two }, ctx())
    expect((r.set.formats as Array<{ channelAvailability?: unknown }>)[0].channelAvailability).toEqual([{ _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state: 'unavailable' }])
  })
  it('the empty implicit format is not stored (absent = implicit, I-C3-1); offers still go', () => {
    const r = cleanCatalogueSet('item', { formats: [{ _key: 'default', prices: [] }] }, ctx({ previous: LEGACY }))
    expect(r.unset).toEqual(expect.arrayContaining(['formats', 'offers']))
    expect(r.set.formats).toBeUndefined()
  })
  it('an older client sending `offers` is stored as formats (same validation, keys and stored notes kept)', () => {
    const r = cleanCatalogueSet('item', { offers: [{ _key: 'o1', price: 9 }] }, ctx({ previous: LEGACY }))
    const after = apply(LEGACY, r)
    expect(after.offers).toBeUndefined()
    expect(after.formats).toEqual([{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'o1', _type: 'cataloguePrice', amount: 9, note: { _type: 'localizedString', it: 'a pezzo' } }] }])
    expect(code(() => cleanCatalogueSet('item', { offers: [{ price: -1 }] }, ctx()))).toBe('invalid_value')
  })
})

describe('channel availability writer (C5-7, C5a)', () => {
  it('rows keyed by channel, schedules typed; "Use category default" (empty) unsets the field', () => {
    const r = cleanCatalogueSet('item', { channelAvailability: [{ channel: 'takeaway', state: 'unavailable', schedule: [{ _key: 's1', days: ['fri', 'mon'], from: '18:00', to: '23:00', state: 'available' }] }] }, ctx())
    expect(r.set.channelAvailability).toEqual([
      { _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state: 'unavailable', schedule: [{ _key: 's1', _type: 'catalogueWeeklyOverride', days: ['mon', 'fri'], from: '18:00', to: '23:00', state: 'available' }] },
    ])
    expect(cleanCatalogueSet('item', { channelAvailability: [] }, ctx()).unset).toContain('channelAvailability')
  })
  it('refuses an unknown channel, a second row for one channel, overlapping hours, a bad state', () => {
    expect(code(() => cleanCatalogueSet('item', { channelAvailability: [{ channel: 'delivery', state: 'available' }] }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { channelAvailability: [{ channel: 'takeaway', state: 'available' }, { channel: 'takeaway', state: 'unavailable' }] }, ctx()))).toBe('invalid_value')
    const overlap = [{ days: ['mon'], from: '10:00', to: '14:00', state: 'unavailable' }, { days: ['mon'], from: '12:00', to: '16:00', state: 'unavailable' }]
    expect(code(() => cleanCatalogueSet('item', { channelAvailability: [{ channel: 'takeaway', state: 'available', schedule: overlap }] }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { channelAvailability: [{ channel: 'takeaway', state: 'inherit' }] }, ctx()))).toBe('invalid_value')
  })
})

describe('category writer (C1, D-15) — assignment xor categories', () => {
  it('primary + additional written, legacy list unset on the same document', () => {
    const r = cleanCatalogueSet('item', { primaryCategory: 'pizza', additionalCategories: ['drinks', 'pizza'] }, ctx({ previous: LEGACY }))
    const after = apply(LEGACY, r)
    expect(oneCategoryShape(after)).toBe(true)
    expect([after.primaryCategory, after.additionalCategories, after.categories]).toEqual(['pizza', ['drinks'], undefined])
  })
  it('a draft saves without any category (D-15 is a publish rule)', () => {
    const r = cleanCatalogueSet('item', { primaryCategory: null, additionalCategories: [] }, ctx({ previous: LEGACY }))
    expect(r.unset).toEqual(expect.arrayContaining(['categories', 'primaryCategory', 'additionalCategories']))
    expect(oneCategoryShape(apply(LEGACY, r))).toBe(true)
  })
  it('refuses an unknown key, a newly assigned archived category, additional without a primary', () => {
    expect(code(() => cleanCatalogueSet('item', { primaryCategory: 'nope' }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { primaryCategory: 'old' }, ctx()))).toBe('invalid_value')
    expect(code(() => cleanCatalogueSet('item', { primaryCategory: null, additionalCategories: ['food'] }, ctx()))).toBe('invalid_value')
    // An archived category already on the item may stay (C1 validateAssignment `previous`).
    expect(code(() => cleanCatalogueSet('item', { additionalCategories: ['food'] }, ctx({ previous: { primaryCategory: 'old' } })))).toBe('ok')
  })
  it('a partial patch keeps the other half from the draft', () => {
    const r = cleanCatalogueSet('item', { additionalCategories: ['drinks'] }, ctx({ previous: { primaryCategory: 'pizza', additionalCategories: ['food'] } }))
    expect(r.set).toEqual({ primaryCategory: 'pizza', additionalCategories: ['drinks'] })
  })
  it('convertedAssignment: first existing key primary, every key kept, duplicates once', () => {
    expect(convertedAssignment(['nope', 'pizza', 'pizza', 'drinks'], TREE)).toEqual({ primary: 'pizza', additional: ['nope', 'drinks'] })
    expect(convertedAssignment(['nope'], TREE)).toEqual({ primary: 'nope', additional: [] })
    expect(convertedAssignment([], TREE)).toEqual({ primary: null, additional: [] })
  })
})

describe('draft/published pairing', () => {
  const site = { defaultLocale: 'it', locales: ['it'], timeZone: 'Europe/Rome', config: { serviceChannels: [], categoryNodes: [], migrations: {} } } as unknown as CatalogueSite
  const client = { fetch: async () => [] } as unknown as LifecycleClient
  it('the writer touches the draft only; publishing that draft writes the new shape to the published version', async () => {
    const draft = apply(LEGACY, cleanCatalogueSet('item', { 'name.it': 'Margherita' }, ctx({ previous: LEGACY })))
    const node = { d: { type: 'catalogueItem', label: () => 'x' }, id: 'i1', draft, published: { ...LEGACY, _id: 'i1' }, isRoot: true } as unknown as PublishNode
    const published = await cataloguePublishGate(site, () => 'u')(node, { client, projectSlug: 'p' })
    expect(oneCommerceShape(published) && oneCategoryShape(published)).toBe(true)
    expect(published.offers).toBeUndefined()
    expect(published.formats).toEqual(legacyOffersToFormats(LEGACY.offers))
    // The live copy the website still serves until then reads identically through the dual-read.
    expect(commerceOf(published as Record<string, unknown>, NONE).formats).toEqual(commerceOf(LEGACY, NONE).formats)
  })
})

describe('UI payload mapping (dashboard-form → writer → readers)', () => {
  const formats: Format[] = [
    { key: asFormatKey('a'), label: { it: 'Bicchiere', en: 'Glass' }, identifiers: { sku: 'W-1' }, quantity: { value: 15, unit: 'cl' }, templateKey: 'glass-15cl', availability: new Map([['takeaway' as never, { state: 'unavailable', overrides: [] }]]), prices: [{ key: 'p1', scope: null, amount: 6, note: null, windows: [] }, { key: 'p2', scope: 'takeaway' as never, amount: 5.5, note: { it: 'asporto' }, windows: [{ days: ['fri'], from: '18:00', to: '02:00' }] }], implicit: false },
    { key: asFormatKey('b'), label: { it: 'Bottiglia' }, identifiers: {}, quantity: null, templateKey: null, availability: new Map(), prices: [{ key: 'p3', scope: null, amount: 28, note: null, windows: [] }], implicit: false },
  ]
  const rules: Record<string, ChannelAvailabilityRule> = { 'dine-in': { state: 'available', overrides: [{ kind: 'weekly', key: 'o1', days: ['sun'], from: null, to: null, state: 'unavailable' }] } }
  it('formatsPatch / itemRulesPatch round-trip through the server to the same model', () => {
    const r = cleanCatalogueSet('item', { formats: formatsPatch(formats), channelAvailability: itemRulesPatch(rules) }, ctx())
    const back = readFormatDocs(r.set.formats as unknown[])
    expect(back.map((f) => ({ ...f, availability: [...f.availability] }))).toEqual(formats.map((f) => ({ ...f, availability: [...f.availability], prices: f.prices.map((p) => ({ ...p, windows: p.windows.map((w) => ({ days: w.days, from: w.from, to: w.to })) })) })))
    expect(Object.fromEntries(commerceOf({ formats: r.set.formats, channelAvailability: r.set.channelAvailability }).itemRules)).toEqual(rules)
  })
  it('itemStateFromDoc reads back what the writer stored (editor reopens identical)', () => {
    const r = cleanCatalogueSet('item', { formats: formatsPatch(formats), channelAvailability: itemRulesPatch(rules), ...assignmentSet({ primary: 'pizza', additional: ['drinks'] }) }, ctx())
    const s = itemStateFromDoc(apply({}, r), null, MIGRATED)
    expect(s.formats.map((f) => f.key)).toEqual(['a', 'b'])
    expect(s.itemRules).toEqual(rules)
    expect(s.assignment).toEqual({ primary: 'pizza', additional: ['drinks'] })
    expect(itemCategoryAssignment(apply({}, r))).toEqual(s.assignment)
  })
  it('a new item starts as one implicit empty format; the legacy item opens through the dual-read', () => {
    expect(emptyFormats()).toEqual(commerceOf({}).formats)
    expect(itemCommerceFromDoc(LEGACY, UNMIGRATED).itemRules).toEqual({ 'dine-in': { state: 'available', overrides: [] }, takeaway: { state: 'available', overrides: [] } })
  })
})

describe('C12 availability.schedule_changed (content-free inputs)', () => {
  const row = (state: string, schedule?: unknown[]) => ({ _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state, ...(schedule ? { schedule } : {}) })
  const sched = [{ _key: 's', _type: 'catalogueWeeklyOverride', from: '18:00', to: '23:00', state: 'available' }]
  it('reports an explicit rule whose hours changed, item and format level; nothing for unchanged or hour-less rules', () => {
    const prev = { channelAvailability: [row('unavailable', sched)], formats: [{ _key: 'a', channelAvailability: [row('unavailable', sched)], prices: [] }, { _key: 'b', prices: [] }] }
    const changes = scheduleChanges(prev, { set: { channelAvailability: [row('unavailable')], formats: [{ _key: 'a', channelAvailability: [row('available', sched)], prices: [] }, { _key: 'b', prices: [] }] }, unset: [] })
    expect(changes.map((c) => [c.level, c.targetKey, c.channel, c.formats])).toEqual([['item', 'item', 'takeaway', 2], ['format', 'a', 'takeaway', 1]])
    expect(scheduleChanges(prev, { set: { 'name.it': 'x' }, unset: [] })).toEqual([])
    expect(scheduleChanges({ channelAvailability: [row('available')] }, { set: { channelAvailability: [row('unavailable')] }, unset: [] })).toEqual([])
  })
})
