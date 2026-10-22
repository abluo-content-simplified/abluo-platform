/**
 * Amazon buy links in a listing section: hydration rewrites them PER REQUEST from the visitor country
 * (x-vercel-ip-country) and the tenant's tracking IDs; the disclosure shows Amazon's sentence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const country = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/affiliate/visitor-country', () => ({ visitorCountry: async () => country.value }))

import * as Q from '@/lib/sanity/queries'
import { hydrateSections } from '@/components/sections/SectionRenderer'
import { CatalogueListingSection } from '@/components/sections/CatalogueListingSection'
import type { CatalogueListingSection as Section, PageSection } from '@/lib/sanity/types'

const configRow = { catalogue: { publicSegment: 'libri', currency: 'EUR', showPricesByDefault: true }, timeZone: null }
const collectionRow = (links: unknown[]) => ({
  publicId: 'c', collectionType: 'list', name: 'Libri',
  sections: [{ _key: 's', name: 'Tutti', items: [{ publicId: 'b', itemProfile: 'book', name: 'Il libro', hasPage: false, offers: [{ _key: 'o', price: 12 }], links }] }],
})
const amazonLink = { _key: 'l', url: 'https://www.amazon.it/Libro/dp/B08N5WRWNW?psc=1', kind: 'buy', moreUrls: ['https://www.amazon.de/dp/B0DEDEDEDE'] }
const IDS = [{ marketplace: 'amazon.it', trackingId: 'tmzit-21' }, { marketplace: 'amazon.de', trackingId: 'tmzde-21' }]

async function html(links: unknown[], { locale = 'en', ids = IDS }: { locale?: string; ids?: unknown } = {}) {
  const calls: string[] = []
  const fetchForTenant = (async (query: string) => {
    if (query === Q.catalogueModuleConfigQuery) return configRow
    if (query === Q.catalogueCollectionByIdQuery) return collectionRow(links)
    if (query === Q.affiliateSettingsQuery) { calls.push('ids'); return ids ? { amazonTrackingIds: ids } : null }
    return null
  }) as never
  const s: Section = { _type: 'catalogueListingSection', _key: 'k', collectionId: 'c' }
  await hydrateSections([s] as PageSection[], { fetchForTenant, locale: locale as never, defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
  return { html: renderToStaticMarkup(<CatalogueListingSection section={s} surface={'transparent' as never} designSystem={null} locale={locale} tenantSlug="libri" />), calls }
}

beforeEach(() => { country.value = null })

describe('listing section with Amazon links', () => {
  it('visitor in Germany: the German store, the German ID, the sentence, no price', async () => {
    country.value = 'DE'
    const { html: h } = await html([amazonLink])
    expect(h).toContain('href="https://www.amazon.de/dp/B0DEDEDEDE?tag=tmzde-21"')
    expect(h).toContain('sponsored nofollow noopener noreferrer')
    expect(h).toContain('As an Amazon Associate I earn from qualifying purchases.')
    expect(h).not.toContain('€12')
  })
  it('visitor in Italy, or with no country: the primary store with the Italian ID', async () => {
    for (const c of ['IT', 'US', null]) {
      country.value = c
      expect((await html([amazonLink])).html).toContain('href="https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21"')
    }
  })
  it('the sentence follows the page language', async () => {
    country.value = 'IT'
    expect((await html([amazonLink], { locale: 'it' })).html).toContain('In qualità di Affiliato Amazon')
  })
  it('no tracking IDs configured and none pasted: plain link, no sentence, price kept', async () => {
    country.value = 'IT'
    const { html: h } = await html([amazonLink], { ids: null })
    expect(h).toContain('href="https://www.amazon.it/dp/B08N5WRWNW"')
    expect(h).not.toContain('Amazon Associate')
    expect(h).not.toContain('sponsored')
    expect(h).not.toContain('€12')
  })
  it('a listing without Amazon links reads no tracking IDs and shows its price', async () => {
    const { html: h, calls } = await html([{ _key: 'l', url: 'https://shop.example.com/b', kind: 'buy', affiliate: true }])
    expect(calls).toEqual([])
    expect(h).toContain('€12')
    expect(h).not.toContain('Amazon')
    expect(h).toContain('Some links on this page are affiliate links')
  })
})

describe('listing section with several shops per edition', () => {
  const IBS = 'https://www.ibs.it/libro/e/9788498381498'
  const FEL = 'https://www.lafeltrinelli.it/libro/e/9788498381498'
  const AMZ_IT = 'https://www.amazon.it/Libro/dp/B08N5WRWNW'
  const AMZ_EN = 'https://www.amazon.co.uk/dp/B0ENENENEN'
  const bookLinks = [
    { _key: 'a', url: AMZ_IT, kind: 'buy', edition: { language: 'it', original: false } },
    { _key: 'b', url: IBS, kind: 'buy', edition: { language: 'it', original: false } },
    { _key: 'c', url: FEL, kind: 'buy', edition: { language: 'it', original: false } },
    { _key: 'd', url: AMZ_EN, kind: 'buy', edition: { language: 'en', original: true } },
  ]
  async function shops(settings: unknown, locale = 'it') {
    const fetchForTenant = (async (query: string) => {
      if (query === Q.catalogueModuleConfigQuery) return configRow
      if (query === Q.catalogueCollectionByIdQuery) return collectionRow(bookLinks)
      if (query === Q.affiliateSettingsQuery) return settings
      return null
    }) as never
    const s: Section = { _type: 'catalogueListingSection', _key: 'k', collectionId: 'c' }
    const hydrated = await hydrateSections([s] as PageSection[], { fetchForTenant, locale: locale as never, defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
    void hydrated
    return renderToStaticMarkup(<CatalogueListingSection section={s} surface={'transparent' as never} designSystem={null} locale={locale} tenantSlug="libri" />)
  }
  const SETTINGS = { amazonTrackingIds: IDS, awinPublisherId: '3131251', affiliateShops: [{ shop: 'ibs' }] }

  it('card shows one link per book: the first shop of the visitor edition, by the tenant order', async () => {
    country.value = 'IT'
    const h = await shops({ ...SETTINGS, affiliateShops: [{ shop: 'ibs' }, { shop: 'amazon' }] })
    expect(h).toContain('awin1.com/cread.php?awinmid=9777&amp;awinaffid=3131251')
    expect(h).not.toContain('lafeltrinelli')
    expect(h).not.toContain('amazon.co.uk')
    expect(h).toContain('sponsored nofollow noopener noreferrer')
    expect(h).toContain('data-affiliate-disclosure')
  })
  it('Amazon first when the tenant did not place it', async () => {
    country.value = 'IT'
    const h = await shops(SETTINGS)
    expect(h).toContain('amazon.it/dp/B08N5WRWNW?tag=tmzit-21')
    expect(h).not.toContain('awin1.com')
  })
})
