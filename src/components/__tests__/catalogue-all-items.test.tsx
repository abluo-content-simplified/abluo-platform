/** Listing with source "all" renders through the collection path: same cards, rel, tag, disclosure. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const country = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/affiliate/visitor-country', () => ({ visitorCountry: async () => country.value }))

import * as Q from '@/lib/sanity/queries'
import { hydrateSections } from '@/components/sections/SectionRenderer'
import { CatalogueListingSection } from '@/components/sections/CatalogueListingSection'
import type { CatalogueListingSection as Section, PageSection } from '@/lib/sanity/types'

const configRow = { catalogue: { publicSegment: 'libri', currency: 'EUR', showPricesByDefault: true }, timeZone: null }
const amazon = { _key: 'l', url: 'https://www.amazon.it/Libro/dp/B08N5WRWNW?psc=1', kind: 'buy' }
const shop = { _key: 'm', url: 'https://shop.example.com/b', kind: 'buy', affiliate: true }
const book = { publicId: 'b', itemProfile: 'book', name: 'Il libro', hasPage: false, offers: [{ _key: 'o', price: 12 }], links: [amazon, shop] }
const linked = { publicId: 'g', itemProfile: 'book', name: 'Con pagina', hasPage: true, slugMap: { en: { current: 'con-pagina' } }, offers: [], links: [] }
const IDS = [{ marketplace: 'amazon.it', trackingId: 'tmzit-21' }]

async function render(section: Section, rows: { all: unknown[]; collection?: unknown }) {
  const fetchForTenant = (async (query: string) => {
    if (query === Q.catalogueModuleConfigQuery) return configRow
    if (query === Q.catalogueAllItemsQuery) return rows.all
    if (query === Q.catalogueCollectionByIdQuery) return rows.collection ?? null
    if (query === Q.amazonTrackingIdsQuery) return IDS
    return null
  }) as never
  await hydrateSections([section] as PageSection[], { fetchForTenant, locale: 'en' as never, defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
  return renderToStaticMarkup(<CatalogueListingSection section={section} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug="libri" />)
}
beforeEach(() => { country.value = 'IT' })

describe('listing source "all"', () => {
  it('renders the same card, affiliate rel, tag, hidden Amazon price and sentence as a collection', async () => {
    const col = { publicId: 'c', collectionType: 'list', name: 'C', sections: [{ _key: 's', name: 'Tutti', items: [book] }] }
    const viaCollection = await render({ _type: 'catalogueListingSection', _key: 'k', collectionId: 'c' }, { all: [], collection: col })
    const viaAll = await render({ _type: 'catalogueListingSection', _key: 'k', source: 'all', collectionId: 'c' }, { all: [book], collection: col })
    for (const h of [viaCollection, viaAll]) {
      expect(h).toContain('href="https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21"')
      expect(h).toContain('sponsored nofollow noopener noreferrer')
      expect(h).toContain('As an Amazon Associate I earn from qualifying purchases.')
      expect(h).toContain('Il libro')
      expect(h).not.toContain('€12')
    }
  })
  it('links items with a page, shows others as plain cards', async () => {
    const h = await render({ _type: 'catalogueListingSection', _key: 'k', source: 'all' }, { all: [linked, book] })
    expect(h).toContain('href="/en/libri/libri/con-pagina"')
    expect(h).toContain('Il libro')
  })
  it('no items → the authored empty state; none authored → nothing', async () => {
    const withText = await render({ _type: 'catalogueListingSection', _key: 'k', source: 'all', emptyStateHeading: 'Coming soon' }, { all: [] })
    expect(withText).toContain('Coming soon')
    expect(await render({ _type: 'catalogueListingSection', _key: 'k', source: 'all' }, { all: [] })).toBe('')
  })
})
