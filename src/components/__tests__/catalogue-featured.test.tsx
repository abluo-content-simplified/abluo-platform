/** Catalogue Section — featured items first with a label, at most N items, link to the catalogue page. */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/affiliate/visitor-country', () => ({ visitorCountry: async () => null }))

import * as Q from '@/lib/sanity/queries'
import { hydrateSections } from '@/components/sections/SectionRenderer'
import { CatalogueListingSection } from '@/components/sections/CatalogueListingSection'
import type { CatalogueListingSection as Section, PageSection } from '@/lib/sanity/types'
import type { CatalogueCollectionDTO } from '@/lib/modules/catalogue/dto'
import { catalogueLandingHref, listingMaxItems, presentListing } from '@/lib/modules/catalogue/website'

const configRow = { catalogue: { publicSegment: 'books', currency: 'EUR', showPricesByDefault: false }, timeZone: null }
const book = (id: string, extra: Record<string, unknown> = {}) => ({
  publicId: id,
  itemProfile: 'book',
  name: `Book ${id}`,
  hasPage: false,
  offers: [],
  links: [],
  ...extra,
})

async function render(items: unknown[], fields: Partial<Section> = {}) {
  const section = { _type: 'catalogueListingSection', _key: 'k', source: 'all', ...fields } as Section
  const fetchForTenant = (async (query: string) => {
    if (query === Q.catalogueModuleConfigQuery) return configRow
    if (query === Q.catalogueAllItemsQuery) return items
    if (query === Q.affiliateSettingsQuery) return null
    return null
  }) as never
  await hydrateSections([section] as PageSection[], { fetchForTenant, locale: 'en' as never, defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
  return renderToStaticMarkup(<CatalogueListingSection section={section} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug="cyce" />)
}

const order = (html: string) => [...html.matchAll(/data-item="([^"]+)"/g)].map((m) => m[1])

describe('presentListing (pure)', () => {
  const item = (id: string, featured = false) => ({ publicId: id, ...(featured ? { featured: true } : {}) })
  const col = (sections: unknown[]) => ({ sections }) as unknown as CatalogueCollectionDTO
  const sec = (key: string, items: unknown[], children: unknown[] = []) => ({ key, items, children })
  const ids = (c: CatalogueCollectionDTO) => c.sections.flatMap(function walk(s): string[] {
    return [...s.items.map((i) => i.publicId as string), ...s.children.flatMap(walk)]
  })

  it('returns the same object when neither option is set (sections saved before these options)', () => {
    const c = col([sec('a', [item('1'), item('2', true)])])
    expect(presentListing(c, {})).toBe(c)
    expect(presentListing(c, { highlightFeatured: false, maxItems: null })).toBe(c)
  })

  it('moves featured items to the front of their section, keeping the rest in order', () => {
    const c = col([sec('a', [item('1'), item('2'), item('3', true), item('4')])])
    expect(ids(presentListing(c, { highlightFeatured: true }))).toEqual(['3', '1', '2', '4'])
  })

  it('ignores `featured` unless the section highlights it', () => {
    const c = col([sec('a', [item('1'), item('2', true)])])
    expect(ids(presentListing(c, { maxItems: 1 }))).toEqual(['1'])
  })

  it('keeps the first N in reading order, featured first, and drops sections reached after the budget', () => {
    const c = col([sec('a', [item('1'), item('2')], [sec('a1', [item('3', true)])]), sec('b', [item('4')])])
    expect(ids(presentListing(c, { maxItems: 3 }))).toEqual(['1', '2', '3'])
    const out = presentListing(c, { maxItems: 2, highlightFeatured: true })
    expect(ids(out)).toEqual(['1', '2'])
    expect(out.sections.map((s) => s.key)).toEqual(['a'])
    expect(c.sections[0].items.map((i) => i.publicId)).toEqual(['1', '2']) // input untouched
  })

  it('listingMaxItems: whole positive numbers only', () => {
    expect(listingMaxItems(3)).toBe(3)
    expect(listingMaxItems(2.7)).toBe(2)
    for (const v of [0, -1, null, undefined, '3', Number.NaN, Number.POSITIVE_INFINITY]) expect(listingMaxItems(v)).toBeNull()
  })

  it('catalogueLandingHref needs a segment', () => {
    expect(catalogueLandingHref('/en/cyce', 'books')).toBe('/en/cyce/books')
    expect(catalogueLandingHref('/en/cyce', null)).toBeNull()
  })
})

describe('CatalogueListingSection — featured, maxItems, view all', () => {
  const items = [book('1'), book('2'), book('3', { featured: true }), book('4')]

  it('without the options renders every item, no badge, no link (unchanged)', async () => {
    const html = await render(items)
    expect(order(html)).toEqual(['1', '2', '3', '4'])
    expect(html).not.toContain('data-featured')
    expect(html).not.toContain('data-catalogue-view-all')
  })

  it('three items, the featured one first with its label, and a link to the catalogue page', async () => {
    const html = await render(items, { maxItems: 3, highlightFeatured: true, featuredLabel: 'Featured', viewAllLabel: 'See all books' })
    expect(order(html)).toEqual(['3', '1', '2'])
    expect(html.match(/data-featured=""/g)).toHaveLength(1)
    expect(html).toContain('Featured')
    expect(html).toMatch(/<a [^>]*data-catalogue-view-all=""[^>]*href="\/en\/cyce\/books"/)
    expect(html).toContain('See all books')
  })

  it('only featured === true counts (resolveItem)', async () => {
    const html = await render([book('x', { featured: 'yes' }), book('y', { featured: 1 })], { highlightFeatured: true })
    expect(html).not.toContain('data-featured')
  })

  it('a featured item without a label still gets the star', async () => {
    const html = await render(items, { highlightFeatured: true })
    expect(html).toContain('data-featured-badge')
    expect(html).toContain('★')
  })
})
