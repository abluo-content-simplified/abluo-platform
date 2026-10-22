import { describe, expect, it } from 'vitest'
import { collectionHasShop, deliverBuyLinks, deliverItem, linksHaveShop, sortByShopOrder } from '../shop-delivery'
import { localizeBuyLinks } from '../amazon-delivery'
import type { CatalogueItemLinkDTO } from '../dto'

const IBS = 'https://www.ibs.it/buenos-presagios-libro-neil-gaiman/e/9788498381498'
const FEL = 'https://www.lafeltrinelli.it/libro/x/e/9788498381498'
const AMZ = 'https://www.amazon.it/Libro/dp/B08N5WRWNW'
const link = (url: string, extra: Partial<CatalogueItemLinkDTO> = {}): CatalogueItemLinkDTO => ({ key: url, label: '', url, kind: 'buy', affiliate: false, ...extra })
const SETTINGS = { amazonTrackingIds: [{ marketplace: 'amazon.it', trackingId: 'tmzit-21' }], awinPublisherId: '3131251', affiliateShops: [{ shop: 'ibs' }] }
const ctx = { country: 'IT', settings: SETTINGS }

describe('deliverBuyLinks', () => {
  it('approved shop with an ID: the tenant deep link, shop set, affiliate', () => {
    const [l] = deliverBuyLinks([link(IBS)], ctx)
    expect(l.url).toBe('https://www.awin1.com/cread.php?awinmid=9777&awinaffid=3131251&ued=' + encodeURIComponent(IBS))
    expect(l.shop).toBe('ibs')
    expect(l.affiliate).toBe(true)
  })
  it('shop not approved: plain link, not affiliate, shop still recognised', () => {
    const [l] = deliverBuyLinks([link(FEL)], ctx)
    expect(l.url).toBe(FEL)
    expect(l.affiliate).toBe(false)
    expect(l.shop).toBe('lafeltrinelli')
  })
  it('a manually flagged affiliate stays flagged', () => {
    expect(deliverBuyLinks([link(FEL, { affiliate: true })], ctx)[0].affiliate).toBe(true)
  })
  it('no publisher ID: plain link', () => {
    const [l] = deliverBuyLinks([link(IBS)], { country: null, settings: { affiliateShops: [{ shop: 'ibs' }] } })
    expect(l.url).toBe(IBS)
    expect(l.affiliate).toBe(false)
  })
  it('unknown host and info links are untouched, same array', () => {
    const links = [link('https://shop.example.com/b'), link(IBS, { kind: 'info' })]
    expect(deliverBuyLinks(links, ctx)).toBe(links)
  })
  it('Amazon: identical localisation to before, plus shop amazon', () => {
    const links = [link(AMZ)]
    const before = localizeBuyLinks(links, { country: 'IT', trackingIds: SETTINGS.amazonTrackingIds })[0]
    const [l] = deliverBuyLinks(links, ctx)
    expect(l).toEqual({ ...before, shop: 'amazon' })
    expect(l.url).toBe('https://www.amazon.it/dp/B08N5WRWNW?tag=tmzit-21')
  })
  it('deliverItem keeps the item when nothing changes', () => {
    const item = { links: [link('https://x.example.com/')] }
    expect(deliverItem(item, ctx)).toBe(item)
  })
})

describe('pre-checks and ordering', () => {
  it('detect Amazon or Awin shops only', () => {
    expect(linksHaveShop([link(IBS)])).toBe(true)
    expect(linksHaveShop([link(AMZ)])).toBe(true)
    expect(linksHaveShop([link('https://www.awin1.com/cread.php?awinmid=9777&awinaffid=1111111&ued=' + encodeURIComponent(IBS))])).toBe(true)
    expect(linksHaveShop([link('https://shop.example.com/b')])).toBe(false)
    expect(linksHaveShop([link(IBS, { kind: 'info' })])).toBe(false)
    expect(collectionHasShop({ sections: [{ items: [{ links: [link(IBS)] }], children: [] }] as never })).toBe(true)
  })
  it('sortByShopOrder: known shops by order, unknown after in stored order', () => {
    type R = { id: string; shop?: 'amazon' | 'ibs' }
    const a: R = { id: 'a' }, b: R = { id: 'b', shop: 'ibs' }, c: R = { id: 'c', shop: 'amazon' }, d: R = { id: 'd' }
    expect(sortByShopOrder([a, b, c, d], ['amazon', 'ibs']).map((x) => x.id)).toEqual(['c', 'b', 'a', 'd'])
  })
})
