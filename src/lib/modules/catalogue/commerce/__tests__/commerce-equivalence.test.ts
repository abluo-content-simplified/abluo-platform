/**
 * C10-5 — equivalence of visitor-visible outcomes (D-7), synthetic fixtures
 * F-E1…F-E10 plus the production (tmz) shapes, and the R1 guarantee that
 * public output for legacy data is byte-identical before/after: the website
 * DTO (`offers`, every pre-R1 field) and JSON-LD, both through the raw
 * resolver and through the real website GROQ projection (groq-js).
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { catalogueItemBySlugQuery, catalogueModuleConfigQuery } from '@/lib/sanity/queries'
import { resolveCatalogueConfig, resolveItemPage, type RawCatalogueConfigRow, type RawCatalogueItem } from '../../resolve'
import { catalogueItemJsonLd } from '../../structured'
import { compareCommerce, legacyOfferDtos, type EquivalenceProject } from '../equivalence'
import { commerceOf, legacyAvailability, legacyOffersToFormats, legacyOfferRefusals, migrateChannelEntries, migrateCommerceDoc } from '../legacy-commerce'
import { readChannels } from '../channels'
import { explainAvailability, availabilityInputsOf } from '../channel-availability'
import { ZONE, at, ck, fk } from './fixtures'

type Doc = RawCatalogueItem & { _id: string }
const NO_CHANNELS: EquivalenceProject = { channelsBefore: null, channelsAfter: null, currency: 'EUR', timeZone: ZONE, locale: 'en', defaultLocale: 'en' }
const CH = [
  { _key: 'k1', value: 'dine-in', label: { en: 'Dine-in', it: 'Al tavolo' } },
  { _key: 'k2', value: 'takeaway', label: { en: 'Takeaway' } },
]
const doc = (id: string, offers: unknown[] | undefined, extra: Record<string, unknown> = {}): Doc => ({ _id: id, name: { en: id }, itemProfile: 'product', visibility: 'public', publishedAt: '2026-01-01T00:00:00Z', offers: offers as Doc['offers'], ...extra })

/** R1: the AFTER document is the BEFORE document read through the dual-read. */
const r1 = (docs: Doc[], project = NO_CHANNELS) => compareCommerce(docs.map((d) => ({ before: d, after: d })), project)
/** D2 rehearsal: AFTER = the migrated document + migrated config. */
const migrated = (docs: Doc[], channels: typeof CH) => {
  const keys = channels.map((c) => c.value)
  const pairs = docs.map((d) => ({ before: d, after: { ...d, ...(migrateCommerceDoc(d, keys) ?? {}) } as Doc }))
  return compareCommerce(pairs, { ...NO_CHANNELS, channelsBefore: channels, channelsAfter: migrateChannelEntries(channels) })
}

describe('C10-3 mapping', () => {
  it('[] or null → [] (no write: formatsOf synthesises the implicit format)', () => {
    expect(legacyOffersToFormats([])).toEqual([])
    expect(legacyOffersToFormats(null)).toEqual([])
  })
  it('deterministic: same input → byte-identical output, keys and order kept, windows keep their _key', () => {
    const offers = [
      { _key: 'b', _type: 'catalogueOffer', channel: 'takeaway', price: 10, priceNote: { _type: 'localizedString', en: 'from' }, availability: [{ _key: 'w1', _type: 'catalogueAvailability', days: ['fri'], from: '18:00', to: '02:00' }] },
      { _key: 'a', _type: 'catalogueOffer', price: 12 },
    ]
    const once = JSON.stringify(legacyOffersToFormats(offers))
    expect(JSON.stringify(legacyOffersToFormats(structuredClone(offers)))).toBe(once)
    expect(legacyOffersToFormats(offers)).toEqual([
      {
        _key: 'default',
        _type: 'catalogueFormat',
        prices: [
          { _key: 'b', _type: 'cataloguePrice', amount: 10, channel: 'takeaway', note: { _type: 'localizedString', en: 'from' }, windows: [{ _key: 'w1', _type: 'catalogueWeeklyWindow', days: ['fri'], from: '18:00', to: '02:00' }] },
          { _key: 'a', _type: 'cataloguePrice', amount: 12 },
        ],
      },
    ])
  })
  it('D-10: defaults unavailable for every channel; available rows only where the old model sold', () => {
    expect(legacyAvailability(['dine-in', 'takeaway'], [{ id: 'A', offers: [{ _key: 'o', channel: 'takeaway', price: 5 }] }, { id: 'B', offers: [{ _key: 'o', price: 5 }] }, { id: 'C', offers: [] }])).toEqual({
      defaults: { 'dine-in': 'unavailable', takeaway: 'unavailable' },
      itemRules: { A: { takeaway: 'available' }, B: { 'dine-in': 'available', takeaway: 'available' } },
    })
  })
  it('commerceOf: formats win over legacy offers and report the shadowing', () => {
    const c = commerceOf({ formats: [{ _key: 'f', _type: 'catalogueFormat', prices: [{ _key: 'p', amount: 3 }] }], offers: [{ _key: 'o', price: 9 }] })
    expect(c.source).toBe('formats')
    expect(c.issues).toEqual(['legacy.offersShadowed'])
    expect(c.formats[0].prices.map((p) => p.key)).toEqual(['p'])
  })
  it('commerceOf: conflicting duplicate rows → that level unset + availability.conflictingRows (never a winner)', () => {
    const c = commerceOf({ channelAvailability: [{ _key: 'a', channel: 'a', state: 'available' }, { _key: 'a2', channel: 'a', state: 'unavailable' }] })
    expect(c.itemRules.size).toBe(0)
    expect(c.issues).toContain('availability.conflictingRows')
  })
  it('migrateCommerceDoc is idempotent: formats present → skip; no offers → skip', () => {
    expect(migrateCommerceDoc({ formats: [{ _key: 'default' }], offers: [{ _key: 'o', price: 1 }] }, [])).toBeNull()
    expect(migrateCommerceDoc({ offers: [] }, ['dine-in'])).toBeNull()
  })
})

describe('C10-5 synthetic fixtures', () => {
  it('F-E1 no offers, no channels → implicit empty format; E8 empty both sides', () => {
    const rep = r1([doc('e1', undefined)])
    expect(rep.diffs).toEqual([])
    expect(commerceOf({}).formats).toMatchObject([{ key: 'default', implicit: true, prices: [] }])
  })
  it('F-E2 one unscoped offer, no channels → one standard price, key kept', () => {
    const d = doc('e2', [{ _key: 'gmcfddpsji', price: 999 }])
    expect(r1([d])).toMatchObject({ diffs: [], classW: [], pass: true })
    expect(commerceOf(d).formats[0].prices).toMatchObject([{ key: 'gmcfddpsji', scope: null, amount: 999 }])
  })
  it('F-E3 unscoped + takeaway, channels dine-in/takeaway → dine-in standard, takeaway channel price; D-10 rows', () => {
    const d = doc('e3', [{ _key: 's', price: 12 }, { _key: 't', channel: 'takeaway', price: 10 }])
    expect(migrated([d], CH)).toMatchObject({ diffs: [], classW: [], pass: true })
    expect(migrateCommerceDoc(d, ['dine-in', 'takeaway'])!.channelAvailability).toEqual([
      { _key: 'dine-in', _type: 'catalogueChannelRule', channel: 'dine-in', state: 'available' },
      { _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state: 'available' },
    ])
    expect(migrateChannelEntries(CH).map((e) => e.defaultAvailability)).toEqual(['unavailable', 'unavailable'])
    // R1 dual-read before any data step gives the same outcomes.
    expect(r1([d], { ...NO_CHANNELS, channelsBefore: CH, channelsAfter: CH })).toMatchObject({ diffs: [], pass: true })
  })
  it('F-E4 takeaway-only A, unscoped B; a new item C with no rows → unavailable on both (never an additional channel)', () => {
    const A = doc('A', [{ _key: 'a', channel: 'takeaway', price: 7 }])
    const B = doc('B', [{ _key: 'b', price: 8 }])
    expect(migrated([A, B], CH)).toMatchObject({ diffs: [], pass: true })
    const { channels } = readChannels(migrateChannelEntries(CH))
    const C = commerceOf({}, channels)
    for (const c of ['dine-in', 'takeaway']) {
      const x = explainAvailability(availabilityInputsOf(channels), { itemId: 'C', primaryCategory: null, itemRules: C.itemRules, formats: C.formats }, fk('default'), { kind: 'channel', channel: ck(c) }, at('2026-11-02T10:00:00Z'), ZONE)
      expect(x.state).toBe('unavailable')
    }
  })
  it('F-E5 lunch/dinner unscoped windows → class W at 16:00 (the detector works); E6/E7 equal', () => {
    const d = doc('e5', [{ _key: 'l', price: 10, availability: [{ from: '12:00', to: '15:00' }] }, { _key: 'd', price: 14, availability: [{ from: '18:00', to: '23:00' }] }])
    const rep = migrated([d], CH)
    expect(rep.diffs).toEqual([])
    expect(rep.classW.some((w) => w.at === '2026-11-02T15:00:00.000Z' && w.context === 'dine-in')).toBe(true)
    expect(rep.classW.find((w) => w.at === '2026-11-02T15:00:00.000Z')!.newOutcome).toBe('available:noPrice:outsideWindows')
  })
  it('F-E6 overnight Friday window → E2 equal at Sat 01:30', () => {
    const d = doc('e6', [{ _key: 'n', price: 8, availability: [{ days: ['fri'], from: '18:00', to: '02:00' }] }])
    const rep = migrated([d], CH)
    expect(rep.diffs).toEqual([])
    expect(rep.classW.some((w) => w.at === '2026-11-07T00:30:00.000Z')).toBe(false)
  })
  it('F-E7 two overlapping unscoped offers (legacy) → ambiguous on both sides', () => {
    const d = doc('e7', [{ _key: 'a', price: 9 }, { _key: 'b', price: 10 }])
    expect(migrated([d], CH)).toMatchObject({ diffs: [], classW: [] })
    expect(r1([d])).toMatchObject({ diffs: [] })
  })
  it('F-E8 priceNote present → note carried, E6 equal', () => {
    const d = doc('e8', [{ _key: 'p', price: 4.5, priceNote: { _type: 'localizedString', en: 'per 100 g', it: 'all’etto' } }])
    expect(r1([d])).toMatchObject({ diffs: [], pass: true })
    expect(legacyOffersToFormats(d.offers)[0].prices[0].note).toEqual({ _type: 'localizedString', en: 'per 100 g', it: 'all’etto' })
  })
  it('F-E9 an offer on an unknown channel → pre-flight refuses (C10-6 step P)', () => {
    const d = doc('e9', [{ _key: 'x', channel: 'ghost', price: 3 }])
    const rep = migrated([d], CH)
    expect(rep.refusals).toEqual([{ id: 'e9', refusal: { kind: 'unknownChannel', key: 'x', channel: 'ghost' } }])
    expect(rep.pass).toBe(false)
  })
  it('F-E10 an offer with currency USD → pre-flight refuses (REVIEW X-14)', () => {
    expect(legacyOfferRefusals([{ _key: 'x', price: 3, currency: 'USD' }], [])).toEqual([{ kind: 'reservedField', key: 'x', field: 'currency' }])
  })
  it('versions.* documents fail the run unless mapped explicitly (REVIEW C-6)', () => {
    const d = doc('versions.r1.e2', [{ _key: 'o', price: 1 }])
    const rep = r1([d])
    expect(rep.counts).toEqual({ published: 0, drafts: 0, versions: 1, total: 1 })
    expect(rep.pass).toBe(false)
  })
})

// ── The production (tmz) shapes, 2026-11-02 ──────────────────────────────────
// 16 catalogueItem documents (10 published, 6 drafts), projectSlug tmz, no channels, currency EUR,
// zone Europe/Rome. 4 carry exactly one unscoped, window-less offer without note/currency/locationKey;
// 6 books carry bookDetails.isbn; the rest carry no offers.
const book = (id: string, extra: Record<string, unknown> = {}): Doc =>
  doc(id, undefined, { itemProfile: 'book', bookDetails: { author: 'Douglas Adams', year: 1979, isbn: '9780330258647' }, description: { en: 'A book.', it: 'Un libro.' }, byline: { en: 'Douglas Adams' }, ...extra })
const TMZ: Doc[] = [
  book('1ebde323', { offers: [{ _key: 'gmcfddpsji', _type: 'catalogueOffer', price: 9.99 }] }),
  book('c2c4fa97', { offers: [{ _key: 'k2', _type: 'catalogueOffer', price: 14 }] }),
  book('drafts.c2c4fa97', { offers: [{ _key: 'k2', _type: 'catalogueOffer', price: 15 }] }),
  book('drafts.ee333af2', { offers: [{ _key: 'k3', _type: 'catalogueOffer', price: 0 }] }),
  ...Array.from({ length: 8 }, (_, i) => book(`pub${i}`)),
  ...Array.from({ length: 4 }, (_, i) => book(`drafts.d${i}`, { bookDetails: { author: 'A' } })),
]

describe('C10-5 production shapes (tmz)', () => {
  it('counts per id class are asserted: 12 published-shaped ids + drafts, 0 versions', () => {
    const rep = r1(TMZ, { ...NO_CHANNELS, locale: 'it', defaultLocale: 'it' })
    expect(rep.counts).toEqual({ published: 10, drafts: 6, versions: 0, total: 16 })
    expect(rep.diffs).toEqual([])
    expect(rep.classW).toEqual([])
    expect(rep.pass).toBe(true)
  })
  it('the D2 rehearsal on the same shapes is also diff-free (no channels → no availability written)', () => {
    const rep = migrated(TMZ, [])
    expect(rep).toMatchObject({ diffs: [], classW: [], pass: true })
    expect(migrateCommerceDoc(TMZ[0], [])).toEqual({ formats: [{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'gmcfddpsji', _type: 'cataloguePrice', amount: 9.99 }] }] })
  })
})

// ── Byte-identical public output through the real website projection ───────

const NOW = '2026-11-02T10:00:00.000Z'
async function run<T>(dataset: Record<string, unknown>[], query: string, params: Record<string, unknown>): Promise<T> {
  const p = { projectSlug: 'tmz', locale: 'it', defaultLocale: 'it', ...params }
  return (await (await evaluate(parse(query, { params: p }), { dataset, params: p, timestamp: new Date(NOW) })).get()) as T
}

describe('R1 website output for legacy data is byte-identical (DTO + JSON-LD)', () => {
  const project = (serviceChannels?: unknown[]) => ({
    _id: 'project-tmz',
    _type: 'project',
    projectSlug: 'tmz',
    moduleInstallations: [{ _key: 'c', moduleId: 'catalogue', enabled: true, config: { currency: 'EUR', publicSegment: 'books', ...(serviceChannels ? { serviceChannels } : {}) } }],
  })
  const item = (id: string, offers: unknown[]) => ({
    _id: id,
    _type: 'catalogueItem',
    projectSlug: 'tmz',
    publicId: `pub-${id}`,
    itemProfile: 'book',
    hasPage: true,
    visibility: 'public',
    publishedAt: '2026-01-01T00:00:00Z',
    slug: { it: { _type: 'slug', current: id } },
    name: { it: `Libro ${id}`, en: `Book ${id}` },
    bookDetails: { author: 'Douglas Adams', year: 1979, isbn: '9780330258647' },
    offers,
  })
  const cases: { name: string; channels?: unknown[]; offers: unknown[] }[] = [
    { name: 'tmz shape: one unscoped, window-less offer', offers: [{ _key: 'gmcfddpsji', _type: 'catalogueOffer', price: 9.99 }] },
    { name: 'free offer', offers: [{ _key: 'z', _type: 'catalogueOffer', price: 0 }] },
    { name: 'no offers', offers: [] },
    { name: 'note + windows + invalid rows dropped the same way', offers: [{ _key: 'a', price: 8, priceNote: { it: 'all’etto', en: 'per 100 g' }, availability: [{ _key: 'w', days: ['fri'], from: '18:00', to: '02:00' }] }, { _key: 'bad', price: -1 }, { price: 3 }, { _key: 'b', price: 12.5 }] },
    { name: 'channel project (unmigrated), scoped + unscoped', channels: CH, offers: [{ _key: 's', price: 12 }, { _key: 't', channel: 'takeaway', price: 10 }] },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const dataset = [project(c.channels), { _id: 'site', _type: 'siteConfig', projectSlug: 'tmz', timeZone: ZONE }, item('x', c.offers)]
      const configRow = await run<RawCatalogueConfigRow>(dataset, catalogueModuleConfigQuery, {})
      const config = resolveCatalogueConfig(configRow, 'it', 'it')!
      const ctx = { locale: 'it', defaultLocale: 'it', config, now: new Date(NOW) }
      const row = await run<RawCatalogueItem>(dataset, catalogueItemBySlugQuery, { slug: 'x' })
      const page = resolveItemPage(row as never, ctx)!
      const oldOffers = legacyOfferDtos(row.offers, ctx)
      // DTO: the pre-R1 fields byte-for-byte.
      const { formats, hasPrices, ...pre } = page
      expect(JSON.stringify(pre.offers)).toBe(JSON.stringify(oldOffers))
      expect(pre.hasOffers).toBe(oldOffers.length > 0)
      expect(hasPrices).toBe(pre.hasOffers)
      expect(formats!.flatMap((f) => f.prices)).toEqual(pre.offers)
      // JSON-LD: identical to what the old offers produce.
      const ldCtx = { url: 'https://tmz.example/books/x', locale: 'it' }
      expect(JSON.stringify(catalogueItemJsonLd(pre, ldCtx))).toBe(JSON.stringify(catalogueItemJsonLd({ ...pre, offers: oldOffers, hasOffers: oldOffers.length > 0 }, ldCtx)))
    })
  }
})
