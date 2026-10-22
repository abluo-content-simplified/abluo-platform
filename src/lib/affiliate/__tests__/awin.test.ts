import { describe, expect, it } from 'vitest'
import { awinShopForHost } from '../shops'
import { buildAwinUrl, looksLikeAwinPublisherId, parseAwinUrl } from '../awin-links'
import { approvedShops, describeAffiliateLink, resolveShopLink, shopOrder } from '../affiliate-settings'

const IBS = 'https://www.ibs.it/buenos-presagios-libro-neil-gaiman/e/9788498381498?utm_source=x&gclid=1#top'
const SETTINGS = { awinPublisherId: '3131251', affiliateShops: [{ shop: 'ibs' }, { shop: 'amazon' }, { shop: 'lafeltrinelli' }, { shop: 'bogus' }, null] }

describe('shops', () => {
  it('recognises shops by domain and subdomain only', () => {
    expect(awinShopForHost('www.ibs.it')?.id).toBe('ibs')
    expect(awinShopForHost('IBS.IT')?.id).toBe('ibs')
    expect(awinShopForHost('m.lafeltrinelli.it')?.id).toBe('lafeltrinelli')
    expect(awinShopForHost('notibs.it')).toBeNull()
    expect(awinShopForHost('ibs.it.evil.com')).toBeNull()
  })
})

describe('awin links', () => {
  it('publisher IDs are digits', () => {
    expect(looksLikeAwinPublisherId('3131251')).toBe(true)
    expect(looksLikeAwinPublisherId(' 3131251 ')).toBe(true)
    expect(looksLikeAwinPublisherId('31a')).toBe(false)
    expect(looksLikeAwinPublisherId(3131251)).toBe(false)
  })
  it('cleans the product URL', () => {
    expect(parseAwinUrl(IBS)?.productUrl).toBe('https://www.ibs.it/buenos-presagios-libro-neil-gaiman/e/9788498381498')
    expect(parseAwinUrl('https://example.com/x')).toBeNull()
    expect(parseAwinUrl('not a url')).toBeNull()
  })
  it('reads a pasted Awin link back to its product', () => {
    const pasted = buildAwinUrl(9777, '1111111', 'https://www.ibs.it/x/e/1')
    const p = parseAwinUrl(pasted)
    expect(p?.shop.id).toBe('ibs')
    expect(p?.productUrl).toBe('https://www.ibs.it/x/e/1')
    expect(p?.pastedPublisherId).toBe('1111111')
  })
  it('builds the documented deep link with an encoded destination', () => {
    expect(buildAwinUrl(9777, '3131251', 'https://www.ibs.it/x/e/1?a=b')).toBe(
      'https://www.awin1.com/cread.php?awinmid=9777&awinaffid=3131251&ued=https%3A%2F%2Fwww.ibs.it%2Fx%2Fe%2F1%3Fa%3Db',
    )
  })
})

describe('settings → links', () => {
  it('approved shops and order (tenant order, Amazon first when not placed)', () => {
    expect(approvedShops(SETTINGS)).toEqual(['ibs', 'amazon', 'lafeltrinelli'])
    expect(shopOrder(SETTINGS)).toEqual(['ibs', 'amazon', 'lafeltrinelli', 'mondadori'])
    expect(shopOrder({ affiliateShops: [{ shop: 'lafeltrinelli' }] })).toEqual(['amazon', 'lafeltrinelli', 'ibs', 'mondadori'])
    expect(shopOrder(null)).toEqual(['amazon', 'ibs', 'lafeltrinelli', 'mondadori'])
  })
  it('tracked only with own ID + approval', () => {
    const r = resolveShopLink(IBS, SETTINGS)
    expect(r.provider).toBe('awin')
    expect(r.tracked).toBe(true)
    expect(r.href).toContain('awinmid=9777&awinaffid=3131251&ued=')
  })
  it('not approved / no ID → plain clean link, never another ID', () => {
    const notApproved = resolveShopLink(IBS, { awinPublisherId: '3131251', affiliateShops: [] })
    expect(notApproved).toMatchObject({ tracked: false, status: 'not_approved', href: IBS })
    expect(resolveShopLink(IBS, { affiliateShops: [{ shop: 'ibs' }] })).toMatchObject({ tracked: false, status: 'no_publisher_id' })
    expect(resolveShopLink(IBS, null)).toMatchObject({ tracked: false, status: 'no_publisher_id' })
  })
  it('keeps the ID of a pasted Awin link when the tenant has none', () => {
    const pasted = buildAwinUrl(9777, '1111111', 'https://www.ibs.it/x/e/1')
    expect(resolveShopLink(pasted, null)).toMatchObject({ tracked: true, status: 'pasted', href: pasted })
    expect(resolveShopLink(pasted, SETTINGS).href).toContain('awinaffid=3131251')
  })
  it('shop without a verified advertiser ID is never tracked by Abluo', () => {
    const r = resolveShopLink('https://www.mondadoristore.it/libro/123?utm_source=a', { awinPublisherId: '3131251', affiliateShops: [{ shop: 'mondadori' }] })
    expect(r).toMatchObject({ tracked: false, status: 'shop_not_ready', href: 'https://www.mondadoristore.it/libro/123?utm_source=a' })
  })
  it('unknown shops and Amazon are not Awin', () => {
    expect(resolveShopLink('https://example.com/book', SETTINGS)).toEqual({ provider: null, shop: null, href: 'https://example.com/book', tracked: false })
    expect(resolveShopLink('https://www.amazon.it/dp/844500669X', SETTINGS).provider).toBeNull()
    expect(describeAffiliateLink('https://www.amazon.it/dp/844500669X', SETTINGS).provider).toBe('amazon')
    expect(describeAffiliateLink(IBS, SETTINGS)).toMatchObject({ provider: 'awin', status: 'tracked' })
    expect(describeAffiliateLink('', SETTINGS)).toEqual({ provider: null })
  })
})
