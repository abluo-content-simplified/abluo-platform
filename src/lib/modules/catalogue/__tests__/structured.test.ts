import { describe, expect, it } from 'vitest'
import type {
  CatalogueCollectionDTO,
  CatalogueItemDTO,
  CatalogueItemPageDTO,
  CatalogueOfferDTO,
  CatalogueSectionDTO,
} from '../dto'
import { COLLECTION_TYPE, ITEM_PAGE_TYPE, catalogueCollectionJsonLd, catalogueItemJsonLd } from '../structured'
import { safeJsonLd } from '@/lib/seo/safe-json-ld'

/** A JSON-LD node as read in these tests: any property may be a nested node, a list of them, or a value. */
interface Ld {
  [key: string]: Ld
  [index: number]: Ld
}

const offer = (over: Partial<CatalogueOfferDTO> = {}): CatalogueOfferDTO => ({
  key: 'o1', channel: null, channelLabel: null, price: 9.5, effectiveCurrency: 'EUR',
  formattedPrice: '€9.50', isFree: false, priceNote: null, availability: [], state: 'available', ...over,
})

const item = (over: Partial<CatalogueItemDTO> = {}): CatalogueItemDTO => ({
  publicId: 'i1', itemProfile: 'foodOrDrink', name: 'Margherita', byline: null, bookDetails: null, description: 'Tomato, mozzarella', links: [], images: [],
  categories: [], allergenDeclaration: { status: 'noneDeclared', mayContain: [], note: null }, dietary: [], offers: [offer()], hasOffers: true, optionLists: [],
  visibility: 'public', page: null, ...over,
})

const pageItem = (over: Partial<CatalogueItemPageDTO> = {}): CatalogueItemPageDTO => ({
  ...item(), page: { slug: 'margherita', slugs: { en: 'margherita' } }, body: null, ...over,
})

const section = (key: string, items: CatalogueItemDTO[], children: CatalogueSectionDTO[] = []): CatalogueSectionDTO => ({
  key, name: key, parentKey: null, depth: 0, recovered: false, items, children,
})

const collection = (over: Partial<CatalogueCollectionDTO> = {}): CatalogueCollectionDTO => ({
  publicId: 'c1', collectionType: 'menu', name: 'Lunch', description: null, visibility: 'public', page: null,
  currency: 'EUR', sections: [], issues: [], hasOffers: true, ...over,
})

const ctx = { url: 'https://example.com/en/menu/lunch', locale: 'en' }

describe('lookup tables', () => {
  it('maps item and collection types without branching', () => {
    expect(ITEM_PAGE_TYPE).toEqual({ book: 'Book', foodOrDrink: 'Product', product: 'Product', service: 'Service' })
    expect(COLLECTION_TYPE).toEqual({ menu: 'Menu', list: 'ItemList' })
  })
})

describe('AC17 collection shapes', () => {
  it('menu → Menu > MenuSection (nested) > MenuItem > offers', () => {
    const ld = catalogueCollectionJsonLd(
      collection({ sections: [section('Pizza', [item()], [section('Bianche', [item({ name: 'Bianca' })])])] }),
      ctx,
    )!
    expect(ld['@type']).toBe('Menu')
    const s = (ld.hasMenuSection as Ld[])[0]
    expect(s['@type']).toBe('MenuSection')
    expect(s.hasMenuItem[0]['@type']).toBe('MenuItem')
    expect(s.hasMenuItem[0].offers).toMatchObject({ '@type': 'Offer', price: 9.5, priceCurrency: 'EUR' })
    expect(s.hasMenuSection[0].hasMenuItem[0].name).toBe('Bianca')
  })

  it('list with offers → OfferCatalog', () => {
    const ld = catalogueCollectionJsonLd(collection({ collectionType: 'list', sections: [section('a', [item({ itemProfile: 'product' })])] }), ctx)!
    expect(ld['@type']).toBe('OfferCatalog')
    const el = (ld.itemListElement as Ld[])[0]
    expect(el['@type']).toBe('Offer')
    expect(el.itemOffered['@type']).toBe('Product')
  })

  it('list without offers → ItemList with positions', () => {
    const bare = item({ offers: [], hasOffers: false })
    const ld = catalogueCollectionJsonLd(collection({ collectionType: 'list', hasOffers: false, sections: [section('a', [bare, { ...bare, name: 'B' }])] }), ctx)!
    expect(ld['@type']).toBe('ItemList')
    expect((ld.itemListElement as Ld[]).map((e) => e.position)).toEqual([1, 2])
  })

  it('links an item only when itemUrl returns one (C6)', () => {
    const a = item({ name: 'A', publicId: 'a' })
    const b = item({ name: 'B', publicId: 'b' })
    const ld = catalogueCollectionJsonLd(collection({ sections: [section('s', [a, b])] }), {
      ...ctx, itemUrl: (i) => (i.publicId === 'a' ? 'https://example.com/en/menu/a' : null),
    })!
    const items = (ld.hasMenuSection as Ld[])[0].hasMenuItem
    expect(items[0].url).toBe('https://example.com/en/menu/a')
    expect(items[1].url).toBeUndefined()
  })
})

describe('AC17 item page', () => {
  it('dish on own page is a Product with Offer; menu emits MenuItem (17a)', () => {
    const dish = item()
    const own = catalogueItemJsonLd(pageItem(), ctx)!
    expect(own['@type']).toBe('Product')
    expect(own.offers).toMatchObject({ '@type': 'Offer', availability: 'https://schema.org/InStock' })
    expect(own).not.toHaveProperty('sku')
    const menu = catalogueCollectionJsonLd(collection({ sections: [section('s', [dish])] }), ctx)!
    expect((menu.hasMenuSection as Ld[])[0].hasMenuItem[0]['@type']).toBe('MenuItem')
  })

  it('F-3: a Product page without an offer emits nothing; Service still emitted; collections unaffected', () => {
    for (const itemProfile of ['foodOrDrink', 'product'] as const) {
      expect(catalogueItemJsonLd(pageItem({ itemProfile, offers: [], hasOffers: false }), ctx)).toBeNull()
    }
    const svc = catalogueItemJsonLd(pageItem({ itemProfile: 'service', offers: [], hasOffers: false }), ctx)!
    expect(svc['@type']).toBe('Service')
    expect(svc).not.toHaveProperty('offers')
    const bare = item({ itemProfile: 'product', offers: [], hasOffers: false })
    const list = catalogueCollectionJsonLd(collection({ collectionType: 'list', hasOffers: false, sections: [section('s', [bare])] }), ctx)!
    expect(list['@type']).toBe('ItemList')
    const menu = catalogueCollectionJsonLd(collection({ sections: [section('s', [bare])] }), ctx)!
    expect((menu.hasMenuSection as Ld[])[0].hasMenuItem[0]['@type']).toBe('MenuItem')
  })

  it('service → Service', () => {
    expect(catalogueItemJsonLd(pageItem({ itemProfile: 'service' }), ctx)!['@type']).toBe('Service')
  })

  it('own page by profile (D-2): foodOrDrink → Product, product → Product, service → Service; in a menu always MenuItem (B1)', () => {
    expect(ITEM_PAGE_TYPE).toEqual({ book: 'Book', foodOrDrink: 'Product', product: 'Product', service: 'Service' })
    for (const itemProfile of ['book', 'foodOrDrink', 'product', 'service'] as const) {
      const menu = catalogueCollectionJsonLd(collection({ collectionType: 'menu', sections: [section('s', [item({ itemProfile })])] }), ctx)!
      expect((menu.hasMenuSection as Array<{ hasMenuItem: Array<Record<string, unknown>> }>)[0].hasMenuItem[0]['@type']).toBe('MenuItem')
    }
  })

  it('currency is the DTO effectiveCurrency; several offers become an array; price is a number', () => {
    const ld = catalogueItemJsonLd(pageItem({ offers: [offer({ effectiveCurrency: 'CHF', price: 0 }), offer({ key: 'o2', effectiveCurrency: 'CHF', price: 12 })] }), ctx)!
    const offers = ld.offers as Ld[]
    expect(offers.map((o) => o.priceCurrency)).toEqual(['CHF', 'CHF'])
    expect(offers.map((o) => o.price)).toEqual([0, 12])
  })

  it('outOfHours and unknown state still emit InStock (stock, not hours)', () => {
    const ld = catalogueItemJsonLd(pageItem({ offers: [offer({ state: 'outOfHours' }), offer({ key: 'x', state: null })] }), ctx)!
    expect((ld.offers as Ld[]).every((o) => String(o.availability) === 'https://schema.org/InStock')).toBe(true)
  })

  it('omits offers when none, includes image/description when present', () => {
    const ld = catalogueItemJsonLd(pageItem({ itemProfile: 'service', offers: [], hasOffers: false, description: null }), ctx)!
    expect(ld).not.toHaveProperty('offers')
    expect(ld).not.toHaveProperty('description')
  })

  it('output survives safeJsonLd', () => {
    const ld = catalogueItemJsonLd(pageItem({ name: '</script><b>' }), ctx)!
    expect(safeJsonLd(ld)).not.toContain('</script>')
  })
})

describe('hidden content emits nothing (17b, C10)', () => {
  it('unlisted item page → null', () => {
    expect(catalogueItemJsonLd(pageItem({ visibility: 'unlisted' }), ctx)).toBeNull()
  })
  it('unlisted collection → null', () => {
    expect(catalogueCollectionJsonLd(collection({ visibility: 'unlisted' }), ctx)).toBeNull()
  })
  it('websiteOnly is indexable and emitted', () => {
    expect(catalogueItemJsonLd(pageItem({ visibility: 'websiteOnly' }), ctx)).not.toBeNull()
  })
  it('unlisted item is omitted from a collection; emptied section dropped, originally-empty kept', () => {
    const hidden = item({ name: 'Secret', visibility: 'unlisted' })
    const ld = catalogueCollectionJsonLd(
      collection({ sections: [section('Visible', [item()]), section('OnlyHidden', [hidden]), section('Empty', [])] }),
      ctx,
    )!
    const names = (ld.hasMenuSection as Ld[]).map((s) => s.name)
    expect(names).toEqual(['Visible', 'Empty'])
    expect(JSON.stringify(ld)).not.toContain('Secret')
  })
  it('OfferCatalog decision ignores offers of omitted items', () => {
    const hidden = item({ visibility: 'unlisted' })
    const bare = item({ offers: [], hasOffers: false })
    const ld = catalogueCollectionJsonLd(collection({ collectionType: 'list', sections: [section('a', [hidden, bare])] }), ctx)!
    expect(ld['@type']).toBe('ItemList')
  })
})

describe('Book on its own page (Amendment I-3.5)', () => {
  const book = (over: Partial<CatalogueItemPageDTO> = {}): CatalogueItemPageDTO =>
    pageItem({
      itemProfile: 'book', name: 'The Hitchhiker’s Guide to the Galaxy', byline: 'Douglas Adams', allergenDeclaration: null, offers: [], hasOffers: false,
      bookDetails: { author: 'Douglas Adams', year: 1979, isbn: '9780345391803' }, ...over,
    })

  it('emits Book with author as Person, isbn and datePublished — valid without an offer', () => {
    const ld = catalogueItemJsonLd(book(), ctx)!
    expect(ld['@type']).toBe('Book')
    expect(ld['@id']).toBe(`${ctx.url}#book`)
    expect(ld).toMatchObject({ name: 'The Hitchhiker’s Guide to the Galaxy', author: { '@type': 'Person', name: 'Douglas Adams' }, isbn: '9780345391803', datePublished: '1979' })
    expect(ld).not.toHaveProperty('offers')
    expect(ld).not.toHaveProperty('sameAs')
  })

  it('includes the offer when the book has a price', () => {
    const ld = catalogueItemJsonLd(book({ offers: [offer()], hasOffers: true }), ctx)!
    expect(ld.offers).toMatchObject({ '@type': 'Offer' })
  })

  it('omits an ISBN that does not check out (the page still shows it)', () => {
    const ld = catalogueItemJsonLd(book({ bookDetails: { author: 'Douglas Adams', year: 1979, isbn: '9780345391804' } }), ctx)!
    expect(ld).not.toHaveProperty('isbn')
    expect(ld).toMatchObject({ '@type': 'Book', datePublished: '1979' })
  })

  it('emits only what exists: a bare title is still a Book', () => {
    const ld = catalogueItemJsonLd(book({ bookDetails: null }), ctx)!
    expect(ld['@type']).toBe('Book')
    for (const k of ['author', 'isbn', 'datePublished']) expect(ld).not.toHaveProperty(k)
  })

  it('unlisted book emits nothing (B4, C10 unchanged)', () => {
    expect(catalogueItemJsonLd(book({ visibility: 'unlisted' }), ctx)).toBeNull()
  })

  it('B1: inside a menu a book is a MenuItem; inside a list it is a plain entry', () => {
    const menu = catalogueCollectionJsonLd(collection({ collectionType: 'menu', sections: [section('s', [book()])] }), ctx)!
    const mi = (menu.hasMenuSection as Array<{ hasMenuItem: Array<Record<string, unknown>> }>)[0].hasMenuItem[0]
    expect(mi['@type']).toBe('MenuItem')
    expect(mi).not.toHaveProperty('author')
    const list = catalogueCollectionJsonLd(collection({ collectionType: 'list', hasOffers: false, sections: [section('s', [book()])] }), ctx)!
    expect(list['@type']).toBe('ItemList')
  })
})
