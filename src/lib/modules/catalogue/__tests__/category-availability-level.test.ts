// Catalogue V2 R1 integration — the C1 category level is live in the C5
// resolver for projects that have a catalogue-taxonomy document, through the
// real website projection (groq-js), while projects without one resolve
// exactly as before (no category level, C10-5).
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { catalogueItemBySlugQuery, catalogueModuleConfigQuery } from '@/lib/sanity/queries'
import { resolveCatalogueConfig, resolveItemPage, type RawCatalogueConfigRow, type RawCatalogueItem } from '../resolve'

const NOW = '2026-11-02T10:00:00.000Z'
async function run<T>(dataset: Record<string, unknown>[], query: string, params: Record<string, unknown> = {}): Promise<T> {
  const p = { projectSlug: 'tmz', locale: 'it', defaultLocale: 'it', ...params }
  return (await (await evaluate(parse(query, { params: p }), { dataset, params: p, timestamp: new Date(NOW) })).get()) as T
}

const CHANNELS = [
  { _key: 'k1', value: 'dine-in', label: { it: 'Al tavolo' }, active: true, defaultAvailability: 'available' },
  { _key: 'k2', value: 'delivery', label: { it: 'Consegna' }, active: true, defaultAvailability: 'available' },
]
const project = {
  _id: 'project-tmz',
  _type: 'project',
  projectSlug: 'tmz',
  moduleInstallations: [{ _key: 'c', moduleId: 'catalogue', enabled: true, config: { currency: 'EUR', publicSegment: 'menu', serviceChannels: CHANNELS } }],
}
const site = { _id: 'site', _type: 'siteConfig', projectSlug: 'tmz', timeZone: 'Europe/Rome' }
const taxonomy = {
  _id: 'catalogue-taxonomy.tmz',
  _type: 'catalogueTaxonomy',
  projectSlug: 'tmz',
  categories: [
    { _key: 'a', key: 'food', label: { it: 'Cibo' }, parentKey: null, order: 1000, channelRules: [{ _key: 'delivery', _type: 'catalogueChannelRule', channel: 'delivery', state: 'unavailable' }] },
    { _key: 'b', key: 'pizza', label: { it: 'Pizza' }, parentKey: 'food', order: 1000 },
    { _key: 'c', key: 'drinks', label: { it: 'Bevande' }, parentKey: null, order: 2000 },
  ],
}
const item = (categories: Record<string, unknown>) => ({
  _id: 'x',
  _type: 'catalogueItem',
  projectSlug: 'tmz',
  publicId: 'pub-x',
  itemProfile: 'service',
  hasPage: true,
  visibility: 'public',
  publishedAt: '2026-01-01T00:00:00Z',
  slug: { it: { _type: 'slug', current: 'x' } },
  name: { it: 'Margherita' },
  offers: [{ _key: 'p', _type: 'catalogueOffer', price: 8 }],
  ...categories,
})

async function page(dataset: Record<string, unknown>[]) {
  const config = resolveCatalogueConfig(await run<RawCatalogueConfigRow>(dataset, catalogueModuleConfigQuery), 'it', 'it')!
  const row = await run<RawCatalogueItem>(dataset, catalogueItemBySlugQuery, { slug: 'x' })
  return { config, page: resolveItemPage(row as never, { locale: 'it', defaultLocale: 'it', config, now: new Date(NOW) })! }
}
const deliveryOf = (p: Awaited<ReturnType<typeof page>>['page']) => p.formats![0].availability.find((a) => a.context === 'delivery')

describe('C1 → C5 category level (integration)', () => {
  it('no taxonomy document: no category nodes in the config and no category level (legacy, unchanged)', async () => {
    const { config, page: p } = await page([project, site, item({ categories: ['pizza'] })])
    expect(config.categoryNodes).toBeUndefined()
    expect(deliveryOf(p)?.availableSometime).toBe(true)
  })

  it('legacy item categories: the first existing category is the primary; the ancestor rule applies (D-15, D-6.1)', async () => {
    const { config, page: p } = await page([project, site, taxonomy, item({ categories: ['pizza'] })])
    expect(config.categoryNodes?.map((n) => n.key)).toEqual(['food', 'pizza', 'drinks'])
    expect(deliveryOf(p)?.availableSometime).toBe(false)
    expect(p.formats![0].availability.find((a) => a.context === 'dine-in')?.availableSometime).toBe(true)
  })

  it('stored primaryCategory wins; additional categories never participate (K-3 rule 5)', async () => {
    const drinks = await page([project, site, taxonomy, item({ categories: ['pizza'], primaryCategory: 'drinks', additionalCategories: ['pizza'] })])
    expect(deliveryOf(drinks.page)?.availableSometime).toBe(true)
    const pizza = await page([project, site, taxonomy, item({ primaryCategory: 'pizza' })])
    expect(deliveryOf(pizza.page)?.availableSometime).toBe(false)
  })
})
