/** Several shops per edition on the item page: grouped rows, tenant order, Awin deep links, rel, disclosure inputs. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BuyLinks } from '@/components/catalogue/CatalogueItemParts'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'
import { deliverBuyLinks } from '@/lib/modules/catalogue/shop-delivery'
import { shopOrder } from '@/lib/affiliate/affiliate-settings'
import type { CatalogueItemLinkDTO } from '@/lib/modules/catalogue/dto'

const IBS = 'https://www.ibs.it/libro/e/9788498381498'
const FEL = 'https://www.lafeltrinelli.it/libro/e/9788498381498'
const itEd = { language: 'it', original: false }
const enEd = { language: 'en', original: true }
const link = (key: string, url: string, edition: CatalogueItemLinkDTO['edition']): CatalogueItemLinkDTO => ({ key, label: '', url, kind: 'buy', affiliate: false, edition })
const LINKS = [
  link('a', 'https://www.amazon.it/Libro/dp/B08N5WRWNW', itEd),
  link('b', IBS, itEd),
  link('c', FEL, itEd),
  link('d', 'https://www.amazon.co.uk/dp/B0ENENENEN', enEd),
]
const render = (settings: Parameters<typeof shopOrder>[0] & object, locale = 'it') => {
  const m = getCatalogueWebsiteMessages(locale)
  const links = deliverBuyLinks(LINKS, { country: 'IT', settings })
  return renderToStaticMarkup(<BuyLinks links={links} m={m} shopOrder={shopOrder(settings)} />)
}
const S = { amazonTrackingIds: [{ marketplace: 'amazon.it', trackingId: 'tmzit-21' }], awinPublisherId: '3131251', affiliateShops: [{ shop: 'ibs' }] }

describe('BuyLinks with several shops', () => {
  it('one row per edition, shops in the tenant order, names not translated', () => {
    const h = render({ ...S, affiliateShops: [{ shop: 'ibs' }, { shop: 'amazon' }] })
    expect((h.match(/data-buy-group=""/g) ?? []).length).toBe(2)
    expect(h.indexOf('>IBS<')).toBeLessThan(h.indexOf('>Amazon<'))
    expect(h.indexOf('>Amazon<')).toBeLessThan(h.indexOf('>laFeltrinelli<'))
    expect(h.indexOf('Italiano')).toBeLessThan(h.indexOf('English'))
  })
  it('Amazon first when the tenant did not place it; IBS carries the tenant ID', () => {
    const h = render(S)
    expect(h.indexOf('>Amazon<')).toBeLessThan(h.indexOf('>IBS<'))
    expect(h).toContain('awinmid=9777&amp;awinaffid=3131251')
  })
  it('unapproved shop is a plain link without sponsored rel', () => {
    const h = render(S)
    const fel = h.slice(h.indexOf('<a href="' + FEL))
    expect(fel.slice(0, fel.indexOf('</a>'))).not.toContain('sponsored')
    const ibs = h.slice(h.indexOf('<a href="https://www.awin1.com'))
    expect(ibs.slice(0, ibs.indexOf('</a>'))).toContain('sponsored nofollow noopener noreferrer')
  })
  it('every group with one link renders as before (no group rows)', () => {
    const m = getCatalogueWebsiteMessages('en')
    const h = renderToStaticMarkup(<BuyLinks links={[LINKS[0], LINKS[3]]} m={m} />)
    expect(h).not.toContain('data-buy-group')
  })
  it('legacy buy links without editions keep their labels and the old markup', () => {
    const m = getCatalogueWebsiteMessages('en')
    const legacy: CatalogueItemLinkDTO[] = [
      { key: 'x', label: 'Hardcover', url: 'https://shop.example.com/a', kind: 'buy', affiliate: false },
      { key: 'y', label: 'Kindle', url: 'https://shop.example.com/b', kind: 'buy', affiliate: false },
    ]
    const h = renderToStaticMarkup(<BuyLinks links={legacy} m={m} shopOrder={shopOrder(S)} />)
    expect(h).not.toContain('data-buy-group')
    expect(h).toContain('>Hardcover</a>')
    expect(h).toContain('>Kindle</a>')
    expect(h.startsWith('<ul class="flex flex-wrap items-start gap-x-6 gap-y-4" data-buy-links="">')).toBe(true)
  })
  it('groups by language: Original when any link is; Amazon (original) + IBS (not) is one row', () => {
    const m = getCatalogueWebsiteMessages('en')
    const links = deliverBuyLinks(
      [
        link('a', 'https://www.amazon.it/Libro/dp/B08N5WRWNW', { language: 'it', original: true }),
        link('b', IBS, { language: 'it', original: false }),
      ],
      { country: 'IT', settings: S },
    )
    const h = renderToStaticMarkup(<BuyLinks links={links} m={m} shopOrder={shopOrder(S)} />)
    expect((h.match(/data-buy-group=""/g) ?? []).length).toBe(1)
    expect(h).toContain(`Italiano · ${m.editionOriginal}`)
    expect(h.indexOf('>Amazon<')).toBeLessThan(h.indexOf('>IBS<'))
  })
  it('a pasted Awin wrapper link gets the tenant ID when approved', () => {
    const wrapper = 'https://www.awin1.com/cread.php?awinmid=9777&awinaffid=1111111&ued=' + encodeURIComponent(IBS)
    const [l] = deliverBuyLinks([link('w', wrapper, undefined)], { country: null, settings: S })
    expect(l.url).toContain('awinaffid=3131251')
    expect(l.shop).toBe('ibs')
  })
})
