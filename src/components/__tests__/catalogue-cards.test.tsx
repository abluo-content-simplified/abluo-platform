/** Website listing cards: grid for books/products, rows for food, whole card opens the item, one "Buy on …", filter bar. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const country = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/affiliate/visitor-country', () => ({ visitorCountry: async () => country.value }))

import * as Q from '@/lib/sanity/queries'
import { hydrateSections } from '@/components/sections/SectionRenderer'
import { CatalogueListingSection } from '@/components/sections/CatalogueListingSection'
import type { CatalogueListingSection as Section, PageSection } from '@/lib/sanity/types'
import { collectionFilterCategories, itemsUseCards } from '@/lib/modules/catalogue/website'

const configRow = {
  catalogue: {
    publicSegment: 'libri',
    currency: 'EUR',
    showPricesByDefault: true,
    categoryTerms: null,
    categories: [
      { _key: 'a', value: 'literature', label: { en: 'Literature' } },
      { _key: 'b', value: 'science_fiction', label: { en: 'Science fiction' } },
    ],
  },
  tagTerms: [
    { key: 'one', label: { en: 'One' }, order: 1 },
    { key: 'two', label: { en: 'Two' }, order: 2 },
    { key: 'three', label: { en: 'Three' }, order: 3 },
    { key: 'four', label: { en: 'Four' }, order: 4 },
  ],
  timeZone: null,
}
const edEn = { _key: 'e1', url: 'https://www.amazon.it/dp/B08N5WRWNW', kind: 'buy', edition: { language: 'en', original: true } }
const edIt = { _key: 'e2', url: 'https://www.amazon.it/dp/8804668237', kind: 'buy', edition: { language: 'it', original: false } }
const book = {
  publicId: 'b',
  itemProfile: 'book',
  name: 'Il libro',
  hasPage: true,
  slugMap: { en: { current: 'il-libro' } },
  bookDetails: { author: 'Douglas Adams', year: 1979 },
  categories: ['literature'],
  tags: ['one', 'two', 'three', 'four'],
  offers: [],
  links: [edEn, edIt],
}
const other = { publicId: 'o', itemProfile: 'book', name: 'Altro', hasPage: false, categories: ['science_fiction'], offers: [], links: [] }
const dish = { publicId: 'd', itemProfile: 'foodOrDrink', name: 'Margherita', hasPage: false, offers: [{ _key: 'p', price: 8 }], links: [] }

async function render(all: unknown[]) {
  const section = { _type: 'catalogueListingSection', _key: 'k', source: 'all' } as Section
  const fetchForTenant = (async (query: string) => {
    if (query === Q.catalogueModuleConfigQuery) return configRow
    if (query === Q.catalogueAllItemsQuery) return all
    if (query === Q.affiliateSettingsQuery) return { amazonTrackingIds: [] }
    return null
  }) as never
  await hydrateSections([section] as PageSection[], { fetchForTenant, locale: 'en' as never, defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
  return renderToStaticMarkup(<CatalogueListingSection section={section} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug="libri" />)
}
beforeEach(() => {
  country.value = 'IT'
})

describe('itemsUseCards', () => {
  it('books and products are cards; one food item makes the list rows', () => {
    expect(itemsUseCards([{ itemProfile: 'book' }, { itemProfile: 'product' }])).toBe(true)
    expect(itemsUseCards([{ itemProfile: 'book' }, { itemProfile: 'foodOrDrink' }])).toBe(false)
    expect(itemsUseCards([])).toBe(false)
  })
})

describe('collectionFilterCategories', () => {
  const col = (cats: string[][]) => ({ sections: [{ items: cats.map((c) => ({ categories: c.map((v) => ({ value: v, label: v.toUpperCase(), color: null })) })), children: [] }] }) as never
  it('needs at least two categories; first appearance first; unsafe values skipped', () => {
    expect(collectionFilterCategories(col([['a'], ['a']]))).toEqual([])
    expect(collectionFilterCategories(col([['b'], ['a', 'b'], ['x"y']]))).toEqual([
      { value: 'b', label: 'B' },
      { value: 'a', label: 'A' },
    ])
  })
})

describe('book cards on the website', () => {
  it('renders a card grid with a stretched link, author · year, max three tags and one "Buy on Amazon"', async () => {
    const h = await render([book, other])
    expect(h).toContain('data-card-grid')
    expect(h).toContain('data-card-link')
    expect(h).toContain('href="/en/libri/libri/il-libro"')
    expect(h).toContain('Douglas Adams · 1979')
    expect(h).toContain('One')
    expect(h).toContain('Three')
    expect(h).not.toContain('Four')
    expect((h.match(/data-buy-link/g) ?? []).length).toBe(1)
    expect(h).toContain('Buy on Amazon')
    expect(h).toContain('2 editions')
    expect(h).toContain('data-cover-shelf')
    // The page's disclosure covers the cards: no "Affiliate link" note under each button.
    expect(h).not.toContain('data-affiliate-marker')
  })
  it('shows the category filter bar when two categories are used', async () => {
    const h = await render([book, other])
    expect(h).toContain('data-category-filter')
    expect(h).toContain('Literature')
    expect(h).toContain('Science fiction')
    expect(h).toContain('data-cats="literature"')
  })
  it('groups books into reading-status shelves with headings when there is more than one shelf', async () => {
    const read = { ...book, bookDetails: { author: 'Douglas Adams', year: 1979, readingStatus: 'read' } }
    const want = { ...other, publicId: 'w', bookDetails: { author: 'Someone', readingStatus: 'wantToRead' } }
    const h = await render([want, read])
    expect(h).toContain('data-shelf="read"')
    expect(h).toContain('data-shelf="wantToRead"')
    expect(h.indexOf('data-shelf="read"')).toBeLessThan(h.indexOf('data-shelf="wantToRead"'))
    expect(h).toContain('>Want to read<')
    // One shelf only (all read): no shelf heading, one grid as before.
    const one = await render([read])
    expect(one).not.toContain('data-shelf')
  })
  it('a menu (food) keeps rows and no grid', async () => {
    const h = await render([dish])
    expect(h).not.toContain('data-card-grid')
    expect(h).toContain('Margherita')
  })
})
