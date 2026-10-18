// Amazon buy links: server-side validation, per-visitor rewrite, disclosure + Amazon sentence, prices.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatalogueError, cleanLinks, type PatchContext } from '../dashboard-patch'
import { linkFormIssues, linkFormsFromDoc, linksPatch, withBuyLink, type LinkForm } from '../dashboard-form'
import { resolveLinks } from '../resolve'
import {
  cleanMoreAmazonUrls,
  collectionHasAmazon,
  collectionHasAmazonAffiliateLink,
  hasAmazonAffiliateLink,
  itemHasAmazonLink,
  linksHaveAmazon,
  localizeBuyLinks,
  localizeCollection,
  localizeItem,
} from '../amazon-delivery'
import { affiliateDisclosureText, catalogueLinkRel } from '../affiliate'
import { AffiliateDisclosure, BuyLinks, ItemLinks } from '@/components/catalogue/CatalogueItemParts'
import { CatalogueItemRow } from '@/components/catalogue/CatalogueCollectionView'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'
import type { CatalogueCollectionDTO, CatalogueItemDTO, CatalogueItemLinkDTO } from '../dto'

const IT = `https://www.amazon.it/Libro/dp/B08N5WRWNW/ref=sr_1_1?keywords=x&tag=old-21`
const DE = 'https://www.amazon.de/dp/B0DEDEDEDE'
const IDS = [
  { marketplace: 'amazon.it', trackingId: 'tmzit-21' },
  { marketplace: 'amazon.de', trackingId: 'tmzde-21' },
]
const buy = (url: string, extra: Partial<CatalogueItemLinkDTO> = {}): CatalogueItemLinkDTO => ({ key: 'b', label: '', url, kind: 'buy', affiliate: false, ...extra })

let n = 0
const pctx = (): Pick<PatchContext, 'locales' | 'newKey'> => ({ locales: new Set(['it', 'en']), newKey: () => `k${++n}` })
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CatalogueError ? e.code : 'other'
  }
  return 'ok'
}

describe('patch validation (the server parses again)', () => {
  const row = (extra: Record<string, unknown>) => ({ _key: 'a', kind: 'buy', url: IT, ...extra })
  it('stores extra Amazon stores of a buy link; the main url is stored as typed', () => {
    const [l] = cleanLinks([row({ moreUrls: [DE, ` ${DE}`] })], pctx())
    expect(l.url).toBe(IT)
    expect(l.moreUrls).toEqual([DE])
  })
  it('refuses a non-Amazon, javascript: or unreadable extra URL', () => {
    for (const bad of ['https://example.com/x', 'javascript:alert(1)', 'https://www.amazon.de/', 'nope'])
      expect(code(() => cleanLinks([row({ moreUrls: [bad] })], pctx())), bad).toBe('invalid_value')
  })
  it('refuses extras when the main address is not Amazon, or when there are too many / the wrong type', () => {
    expect(code(() => cleanLinks([row({ url: 'https://shop.example.com/b', moreUrls: [DE] })], pctx()))).toBe('invalid_value')
    expect(code(() => cleanLinks([row({ moreUrls: Array(9).fill(DE) })], pctx()))).toBe('invalid_value')
    expect(code(() => cleanLinks([row({ moreUrls: 'x' })], pctx()))).toBe('invalid_value')
  })
  it('drops a second URL for the main store or for the same store twice; blanks are ignored', () => {
    const [l] = cleanLinks([row({ moreUrls: ['', 'https://www.amazon.it/dp/B0ITITITIT', DE, 'https://amazon.de/dp/B0OTHEROTH'] })], pctx())
    expect(l.moreUrls).toEqual([DE])
  })
  it('keeps an app short link as typed; extras never stored on an info link; old links unchanged', () => {
    expect((cleanLinks([row({ moreUrls: ['https://amzn.eu/d/abc'] })], pctx())[0] as { moreUrls: string[] }).moreUrls).toEqual(['https://amzn.eu/d/abc'])
    const info = cleanLinks([{ _key: 'i', label: { it: 'Scheda' }, url: 'https://example.com', moreUrls: [DE] }], pctx())[0]
    expect(info).not.toHaveProperty('moreUrls')
    expect(cleanLinks([{ _key: 'o', label: { it: 'Scheda' }, url: 'https://example.com' }], pctx())[0]).toEqual({ _key: 'o', _type: 'catalogueItemLink', label: { _type: 'localizedString', it: 'Scheda' }, url: 'https://example.com' })
  })
  it('cleanMoreAmazonUrls: nothing → []', () => {
    const fail = (m: string): never => {
      throw new Error(m)
    }
    expect(cleanMoreAmazonUrls(undefined, IT, fail)).toEqual([])
    expect(cleanMoreAmazonUrls([], 'https://example.com', fail)).toEqual([])
  })
})

describe('editor form', () => {
  const form = (moreUrls: string[], url = IT): LinkForm => ({ key: 'b', label: {}, url, kind: 'buy', affiliate: false, moreUrls })
  it('round-trips moreUrls; absent on every older link', () => {
    expect(linkFormsFromDoc([{ _key: 'a', url: 'https://e.com', kind: 'buy', moreUrls: [DE] }])[0].moreUrls).toEqual([DE])
    expect(linkFormsFromDoc([{ _key: 'a', url: 'https://e.com', kind: 'buy' }])[0]).not.toHaveProperty('moreUrls')
    expect(linkFormsFromDoc([{ _key: 'a', label: { en: 'x' }, url: 'https://e.com', moreUrls: [DE] }])[0]).not.toHaveProperty('moreUrls')
  })
  it('sends only readable extras, and only with an Amazon main address', () => {
    expect(linksPatch([form([DE, '', 'junk', 'https://amzn.eu/d/x'])], 'en')[0]).toMatchObject({ moreUrls: [DE, 'https://amzn.eu/d/x'] })
    expect(linksPatch([form([DE], 'https://shop.example.com/b')], 'en')[0]).not.toHaveProperty('moreUrls')
    expect(linksPatch([form([''])], 'en')[0]).not.toHaveProperty('moreUrls')
  })
  it('flags a bad extra; blank rows are fine', () => {
    expect(linkFormIssues([form(['junk'])], 'en')).toEqual([{ kind: 'badMore', key: 'b' }])
    expect(linkFormIssues([form(['', DE])], 'en')).toEqual([])
  })
  it('the wizard keeps extras when its buy link changes', () => {
    const next = withBuyLink([form([DE])], { url: DE }, () => 'z')
    expect(next[0].moreUrls).toEqual([DE])
  })
})

describe('resolveLinks (read)', () => {
  const ctx = { locale: 'en', defaultLocale: 'en' } as never
  it('carries moreUrls of a buy link through the http(s) gate', () => {
    const [l] = resolveLinks([{ _key: 'a', url: IT, kind: 'buy', moreUrls: [DE, 'javascript:alert(1)', 5] }], ctx)
    expect(l.moreUrls).toEqual([DE])
  })
  it('old links have no moreUrls key at all', () => {
    expect(resolveLinks([{ _key: 'a', url: 'https://e.com', kind: 'buy' }], ctx)[0]).toEqual({ key: 'a', label: '', url: 'https://e.com', kind: 'buy', affiliate: false })
  })
})

describe('localizeBuyLinks (per visitor)', () => {
  it('country picks the store, the tenant ID for that store is added, every other param is gone', () => {
    const [l] = localizeBuyLinks([buy(IT, { moreUrls: [DE] })], { country: 'DE', trackingIds: IDS })
    expect(l).toMatchObject({ url: 'https://www.amazon.de/dp/B0DEDEDEDE?tag=tmzde-21', affiliate: true, amazon: true })
    expect(l).not.toHaveProperty('moreUrls')
  })
  it('falls back to the primary: other country, unknown country, no header', () => {
    for (const country of ['FR', 'ZZ', null, undefined])
      expect(localizeBuyLinks([buy(IT, { moreUrls: [DE] })], { country, trackingIds: IDS })[0].url).toBe('https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21')
  })
  it('the same input gives different results for two visitors (nothing is shared)', () => {
    const links = [buy(IT, { moreUrls: [DE] })]
    expect(localizeBuyLinks(links, { country: 'DE', trackingIds: IDS })[0].url).toContain('amazon.de')
    expect(localizeBuyLinks(links, { country: 'IT', trackingIds: IDS })[0].url).toContain('amazon.it')
    expect(links[0].url).toBe(IT)
  })
  it('no tenant ID: keeps the pasted tag (affiliate), else no tag (not affiliate)', () => {
    expect(localizeBuyLinks([buy(IT)], { country: 'IT', trackingIds: [] })[0]).toMatchObject({ url: 'https://www.amazon.it/dp/B08N5WRWNW?tag=old-21', affiliate: true })
    expect(localizeBuyLinks([buy('https://www.amazon.it/dp/B08N5WRWNW')], { country: 'IT', trackingIds: undefined })[0]).toMatchObject({ url: 'https://www.amazon.it/dp/B08N5WRWNW', affiliate: false, amazon: true })
  })
  it('an explicit affiliate flag is kept even without a tag', () => {
    expect(localizeBuyLinks([buy('https://www.amazon.it/dp/B08N5WRWNW', { affiliate: true })], { country: 'IT', trackingIds: [] })[0].affiliate).toBe(true)
  })
  it('never injects a tag from another marketplace', () => {
    expect(localizeBuyLinks([buy('https://www.amazon.fr/dp/B08N5WRWNW')], { country: 'FR', trackingIds: IDS })[0].url).toBe('https://www.amazon.fr/dp/B08N5WRWNW')
  })
  it('old and foreign links come back as the SAME objects', () => {
    const links = [buy('https://shop.example.com/b', { affiliate: true }), { ...buy('https://www.amazon.it/dp/B08N5WRWNW'), kind: 'info' as const }, buy('https://amzn.eu/d/abc')]
    expect(localizeBuyLinks(links, { country: 'IT', trackingIds: IDS })).toBe(links)
  })
  it('an info link to Amazon is left alone', () => {
    const info = { ...buy(IT), kind: 'info' as const }
    expect(localizeBuyLinks([info], { country: 'IT', trackingIds: IDS })[0]).toBe(info)
  })
})

const item = (links: CatalogueItemLinkDTO[], extra: Partial<CatalogueItemDTO> = {}): CatalogueItemDTO =>
  ({ publicId: 'p', name: 'Book', links, offers: [{ key: 'o', label: null, price: 12, formattedPrice: '€12.00' }], optionLists: [], images: [], tags: [], categories: [], dietary: [], page: null, byline: null, bookDetails: null, description: null, allergenDeclaration: null, hasOffers: true, visibility: 'public', itemProfile: 'book', ...extra }) as never
const collection = (items: CatalogueItemDTO[]): CatalogueCollectionDTO =>
  ({ sections: [{ key: 's', name: 'S', parentKey: null, depth: 0, recovered: false, items: [], children: [{ key: 'c', name: 'C', parentKey: 's', depth: 1, recovered: false, items, children: [] }] }] }) as never

describe('collections and items', () => {
  it('finds Amazon buy links in nested sections and localizes them there', () => {
    const c = collection([item([buy(IT, { moreUrls: [DE] })])])
    expect(collectionHasAmazon(c)).toBe(true)
    expect(collectionHasAmazonAffiliateLink(c)).toBe(false) // not localized yet
    const l = localizeCollection(c, { country: 'DE', trackingIds: IDS })
    expect(l.sections[0].children[0].items[0].links[0].url).toContain('amazon.de/dp/B0DEDEDEDE?tag=tmzde-21')
    expect(collectionHasAmazonAffiliateLink(l)).toBe(true)
  })
  it('a collection without Amazon links is returned untouched', () => {
    const c = collection([item([buy('https://shop.example.com/b')])])
    expect(collectionHasAmazon(c)).toBe(false)
    expect(localizeCollection(c, { country: 'DE', trackingIds: IDS })).toBe(c)
    const i = item([])
    expect(localizeItem(i, { country: 'DE', trackingIds: IDS })).toBe(i)
    expect(linksHaveAmazon(i.links)).toBe(false)
  })
})

describe('website rendering', () => {
  const m = getCatalogueWebsiteMessages('en')
  const render = (links: CatalogueItemLinkDTO[]) => renderToStaticMarkup(<BuyLinks links={links} siteHosts={['x.it']} m={m} />)
  it('buy button: rel sponsored, href per country with the tenant ID', () => {
    const links = [buy(IT, { moreUrls: [DE] })]
    const de = render(localizeBuyLinks(links, { country: 'DE', trackingIds: IDS }))
    expect(de).toContain('href="https://www.amazon.de/dp/B0DEDEDEDE?tag=tmzde-21"')
    expect(de).toContain('rel="sponsored nofollow noopener noreferrer"')
    expect(de).toContain('data-affiliate-marker')
    const it_ = render(localizeBuyLinks(links, { country: 'IT', trackingIds: IDS }))
    expect(it_).toContain('href="https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21"')
    const other = render(localizeBuyLinks(links, { country: 'JP', trackingIds: IDS }))
    expect(other).toContain('amazon.it/dp/B08N5WRWNW?tag=tmzit-21')
  })
  it('an Amazon link without any tag is a plain buy link (no sponsored rel)', () => {
    const html = render(localizeBuyLinks([buy('https://www.amazon.it/dp/B08N5WRWNW')], { country: 'IT', trackingIds: [] }))
    expect(html).not.toContain('sponsored')
    expect(catalogueLinkRel(buy('x'), true)).toBe('noopener noreferrer')
  })

  const page = (links: CatalogueItemLinkDTO[], locale = 'en') => {
    const mm = getCatalogueWebsiteMessages(locale)
    const affiliate = links.some((l) => l.kind === 'buy' && l.affiliate)
    const text = affiliateDisclosureText(affiliate, null, mm.affiliateDisclosureDefault)
    return renderToStaticMarkup(<AffiliateDisclosure text={text} amazonStatement={hasAmazonAffiliateLink(links) ? mm.amazonStatement || null : null} />)
  }
  it("Amazon's sentence appears with the disclosure, in the page language, only for an Amazon affiliate link", () => {
    const amazonAff = localizeBuyLinks([buy(IT)], { country: 'IT', trackingIds: IDS })
    expect(page(amazonAff, 'en')).toContain('As an Amazon Associate I earn from qualifying purchases.')
    expect(page(amazonAff, 'it')).toContain('In qualità di Affiliato Amazon, ricevo un guadagno dagli acquisti idonei.')
    expect(page(amazonAff, 'de')).toContain('Als Amazon-Partner verdiene ich an qualifizierten Verkäufen.')
    expect(page(amazonAff, 'en')).toContain('Some links on this page are affiliate links')
    expect(page(amazonAff, 'en').match(/data-affiliate-disclosure/g)).toHaveLength(1)
  })
  it('no sentence for a non-Amazon affiliate link, an untagged Amazon link, or no link', () => {
    expect(page([buy('https://shop.example.com/b', { affiliate: true })])).not.toContain('Amazon')
    expect(page(localizeBuyLinks([buy('https://www.amazon.it/dp/B08N5WRWNW')], { country: 'IT', trackingIds: [] }))).toBe('')
    expect(page([])).toBe('')
  })
  it('an unlocalized stored flag alone does not trigger it', () => {
    expect(hasAmazonAffiliateLink([buy(IT, { affiliate: true })])).toBe(false)
  })

  it('prices: not shown next to an Amazon button (cards and page), still shown otherwise', () => {
    const display = { showPrices: true, allergens: 'compact' as const, siteHosts: [] }
    const row = (i: CatalogueItemDTO) => renderToStaticMarkup(<CatalogueItemRow item={i} display={display} messages={m} href={null} />)
    const amazon = item(localizeBuyLinks([buy(IT)], { country: 'IT', trackingIds: IDS }))
    expect(itemHasAmazonLink(amazon)).toBe(true)
    expect(row(amazon)).not.toContain('12')
    expect(row(item([buy('https://shop.example.com/b')]))).toContain('12')
    expect(row(item([]))).toContain('12')
  })

  it('compact card list still marks the rel of a localized Amazon link', () => {
    const html = renderToStaticMarkup(<ItemLinks links={localizeBuyLinks([buy(IT)], { country: 'IT', trackingIds: IDS })} siteHosts={[]} compact />)
    expect(html).toContain('sponsored nofollow')
  })
})
