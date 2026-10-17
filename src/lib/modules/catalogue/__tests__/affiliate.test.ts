// ADR-033 Amendment K — buy / affiliate links: rel, disclosure decision and text, wizard/editor equivalence.
import { describe, expect, it } from 'vitest'
import { affiliateDisclosureText, buyLabel, catalogueLinkRel, collectionHasAffiliateLink, hasAffiliateLink, isAffiliateLink } from '../affiliate'
import { buyLinkOf, itemStateFromDoc, linkFormIssues, linksPatch, withBuyLink, type LinkForm } from '../dashboard-form'
import { bookPublisherLine } from '../list-model'
import { catalogueItemJsonLd } from '../structured'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'
import type { CatalogueCollectionDTO, CatalogueItemDTO, CatalogueItemLinkDTO } from '../dto'

const link = (kind: 'info' | 'buy', affiliate = false): CatalogueItemLinkDTO => ({ key: `${kind}${affiliate}`, label: 'L', url: 'https://e.com', kind, affiliate })

describe('affiliate: what counts', () => {
  it('only a buy link flagged affiliate is an affiliate link', () => {
    expect(isAffiliateLink(link('buy', true))).toBe(true)
    expect(isAffiliateLink(link('buy', false))).toBe(false)
    expect(isAffiliateLink(link('info', true))).toBe(false)
    expect(hasAffiliateLink([link('info'), link('buy')])).toBe(false)
    expect(hasAffiliateLink([link('info'), link('buy', true)])).toBe(true)
    expect(hasAffiliateLink([])).toBe(false)
    expect(hasAffiliateLink(null)).toBe(false)
  })

  it('a collection counts affiliate links in nested sections too', () => {
    const item = (links: CatalogueItemLinkDTO[]) => ({ links }) as CatalogueItemDTO
    const section = (items: CatalogueItemDTO[], children: never[] = []) => ({ items, children }) as never
    const c = (sections: never[]) => ({ sections }) as unknown as CatalogueCollectionDTO
    expect(collectionHasAffiliateLink(c([section([item([link('buy')])])]))).toBe(false)
    expect(collectionHasAffiliateLink(c([section([item([])], [section([item([link('buy', true)])])] as never[])]))).toBe(true)
  })
})

describe('affiliate: rel attributes', () => {
  it('affiliate: sponsored nofollow noopener noreferrer, in a new tab or not', () => {
    expect(catalogueLinkRel(link('buy', true), true)).toBe('sponsored nofollow noopener noreferrer')
    expect(catalogueLinkRel(link('buy', true), false)).toBe('sponsored nofollow noopener noreferrer')
  })
  it('everything else keeps the platform rule', () => {
    expect(catalogueLinkRel(link('info'), true)).toBe('noopener noreferrer')
    expect(catalogueLinkRel(link('buy'), true)).toBe('noopener noreferrer')
    expect(catalogueLinkRel(link('info'), false)).toBeUndefined()
    expect(catalogueLinkRel(link('info', true), true)).toBe('noopener noreferrer')
  })
})

describe('affiliate: disclosure decision and text', () => {
  const m = (l: string) => getCatalogueWebsiteMessages(l)
  it('none for a page without affiliate links, whatever is configured', () => {
    expect(affiliateDisclosureText(hasAffiliateLink([link('info'), link('buy')]), 'Custom', m('en').affiliateDisclosureDefault)).toBeNull()
    expect(affiliateDisclosureText(hasAffiliateLink([]), null, m('en').affiliateDisclosureDefault)).toBeNull()
  })
  it('one affiliate link: the configured sentence, else the default for the language', () => {
    expect(affiliateDisclosureText(true, '  Il nostro testo. ', m('it').affiliateDisclosureDefault)).toBe('Il nostro testo.')
    expect(affiliateDisclosureText(true, null, m('it').affiliateDisclosureDefault)).toMatch(/link di affiliazione/)
    expect(affiliateDisclosureText(true, '   ', m('de').affiliateDisclosureDefault)).toMatch(/Affiliate-Links/)
    expect(affiliateDisclosureText(true, '', m('en').affiliateDisclosureDefault)).toMatch(/^Some links on this page are affiliate links/)
  })
  it('an unsupported language falls back to the English default', () => {
    expect(m('fr').affiliateDisclosureDefault).toBe(m('en').affiliateDisclosureDefault)
  })
})

describe('affiliate: buy button label', () => {
  it('the link’s own label, else the localized "Buy"', () => {
    expect(buyLabel('Acquista su X', 'Acquista')).toBe('Acquista su X')
    expect(buyLabel('', 'Acquista')).toBe('Acquista')
    expect(buyLabel(null, 'Kaufen')).toBe('Kaufen')
    expect(getCatalogueWebsiteMessages('de').buyDefault).toBe('Kaufen')
    expect(getCatalogueWebsiteMessages('it').affiliateMarker).toBeTruthy()
  })
})

describe('buy link: editor and wizard write the same links[] entry (D9)', () => {
  let n = 0
  const newKey = () => `k${++n}`
  const info: LinkForm = { key: 'i', label: { en: 'More' }, url: 'https://e.com/more', kind: 'info', affiliate: false }

  it('the wizard creates a buy link next to an existing info link; the editor reads it back', () => {
    const links = withBuyLink([info], { url: 'https://shop.example/b' }, newKey)
    expect(links).toHaveLength(2)
    const buy = buyLinkOf(links)!
    expect(buy).toMatchObject({ kind: 'buy', url: 'https://shop.example/b', affiliate: false })
    const patch = linksPatch(links, 'en')
    expect(patch[0]).toEqual({ _key: 'i', label: { en: 'More' }, url: 'https://e.com/more' })
    expect(patch[1]).toEqual({ _key: buy.key, label: {}, url: 'https://shop.example/b', kind: 'buy' })
    // The editor, loading the saved document, sees the same row.
    const doc = itemStateFromDoc({ links: patch.map((p) => ({ ...p })) }).links
    expect(buyLinkOf(doc)).toMatchObject({ key: buy.key, kind: 'buy', url: 'https://shop.example/b', affiliate: false })
  })

  it('an edit in the editor shows in the wizard field: label and affiliate round-trip', () => {
    const editorRows: LinkForm[] = [{ key: 'b', label: { en: 'Buy at X' }, url: 'https://x.example', kind: 'buy', affiliate: true }]
    expect(buyLinkOf(editorRows)).toMatchObject({ url: 'https://x.example', label: { en: 'Buy at X' }, affiliate: true })
    const next = withBuyLink(editorRows, { affiliate: false }, newKey)
    expect(next).toHaveLength(1)
    expect(linksPatch(next, 'en')).toEqual([{ _key: 'b', label: { en: 'Buy at X' }, url: 'https://x.example', kind: 'buy' }])
    expect(linksPatch(editorRows, 'en')).toEqual([{ _key: 'b', label: { en: 'Buy at X' }, url: 'https://x.example', kind: 'buy', affiliate: true }])
  })

  it('emptying the wizard field removes the buy link, nothing else; an empty field creates none', () => {
    const links = withBuyLink([info], { url: 'https://s.example' }, newKey)
    expect(withBuyLink(links, { url: '' }, newKey)).toEqual([info])
    expect(withBuyLink([info], { url: '' }, newKey)).toEqual([info])
  })

  it('a buy link needs only an address; a bad address is flagged and not saved', () => {
    const ok: LinkForm = { key: 'b', label: {}, url: 'https://s.example', kind: 'buy', affiliate: false }
    expect(linkFormIssues([ok], 'en')).toEqual([])
    expect(linksPatch([ok], 'en')).toHaveLength(1)
    const bad = { ...ok, url: 'javascript:alert(1)' }
    expect(linkFormIssues([bad], 'en')).toEqual([{ kind: 'badUrl', key: 'b' }])
    expect(linksPatch([bad], 'en')).toEqual([])
    // An info link still needs a label.
    expect(linkFormIssues([{ ...ok, kind: 'info' }], 'en')).toEqual([{ kind: 'incomplete', key: 'b' }])
  })

  it('switching a buy link back to info drops the affiliate flag from the patch', () => {
    const row: LinkForm = { key: 'b', label: { en: 'L' }, url: 'https://s.example', kind: 'info', affiliate: true }
    expect(linksPatch([row], 'en')).toEqual([{ _key: 'b', label: { en: 'L' }, url: 'https://s.example' }])
  })
})

describe('publisher line and JSON-LD', () => {
  it('"Publisher · year", only when a publisher is set', () => {
    expect(bookPublisherLine({ publisher: 'Pan Books', year: 1979 })).toBe('Pan Books · 1979')
    expect(bookPublisherLine({ publisher: ' Pan Books ' })).toBe('Pan Books')
    expect(bookPublisherLine({ publisher: null, year: 1979 })).toBeNull()
    expect(bookPublisherLine({})).toBeNull()
  })

  it('JSON-LD Book carries publisher as an Organization; absent when not set', () => {
    const book = (publisher: string | null) =>
      ({ itemProfile: 'book', name: 'B', description: null, images: [], offers: [], hasOffers: false, visibility: 'public', bookDetails: { author: 'A', publisher, year: 1979, isbn: null } }) as never
    const ld = catalogueItemJsonLd(book('Pan Books'), { url: 'https://x.test/b', locale: 'en' })!
    expect(ld).toMatchObject({ '@type': 'Book', publisher: { '@type': 'Organization', name: 'Pan Books' } })
    expect(catalogueItemJsonLd(book(null), { url: 'https://x.test/b', locale: 'en' })!).not.toHaveProperty('publisher')
  })
})
