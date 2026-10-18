import { describe, expect, it } from 'vitest'
import { buildAffiliateUrl, isAmazonShortLink, looksLikeAmazon, parseAmazonUrl } from '../amazon-links'
import { AMAZON_MARKETPLACES } from '../amazon-marketplaces'

const A = 'B08N5WRWNW'
const ok = (url: string) => {
  const r = parseAmazonUrl(url)
  if (!r.ok) throw new Error(`${url} → ${r.error}`)
  return r
}

describe('parseAmazonUrl: shapes', () => {
  it.each([
    [`https://www.amazon.de/dp/${A}`],
    [`https://www.amazon.de/dp/${A}/`],
    [`https://www.amazon.de/gp/product/${A}`],
    [`https://www.amazon.de/Some-Product-Name/dp/${A}/ref=sr_1_3?keywords=x&qid=1&sr=8-3`],
    [`https://www.amazon.de/exec/obidos/ASIN/${A}/tag-21`],
    [`https://www.amazon.de/exec/obidos/tg/detail/-/${A}/`],
    [`https://www.amazon.de/gp/aw/d/${A}`],
    [`https://www.amazon.de/gp/offer-listing/${A}`],
    [`https://www.amazon.de/product-reviews/dp/${A}`],
    [`https://www.amazon.de/gp/product/handle-buy-box?asin=${A}`],
    [`https://www.amazon.de/something?ASIN=${A}`],
    [`amazon.de/dp/${A}`],
    [`  https://www.amazon.de/dp/${A.toLowerCase()}  `],
  ])('reads %s', (url) => {
    const r = ok(url)
    expect(r.marketplace).toBe('amazon.de')
    expect(r.asin).toBe(A)
  })

  it('knows every marketplace of the shared list, with and without www', () => {
    for (const m of AMAZON_MARKETPLACES) {
      expect(ok(`https://${m.host}/dp/${A}`).marketplace).toBe(m.id)
      expect(ok(`https://${m.host.replace('www.', '')}/dp/${A}`).marketplace).toBe(m.id)
    }
  })

  it('accepts the legacy smile. and mobile m. hosts', () => {
    expect(ok(`https://smile.amazon.com/dp/${A}`).marketplace).toBe('amazon.com')
    expect(ok(`https://m.amazon.it/dp/${A}`).marketplace).toBe('amazon.it')
  })

  it('does not confuse amazon.com.be / amazon.co.uk / amazon.com', () => {
    expect(ok(`https://www.amazon.com.be/dp/${A}`).marketplace).toBe('amazon.com.be')
    expect(ok(`https://www.amazon.co.uk/dp/${A}`).marketplace).toBe('amazon.co.uk')
    expect(ok(`https://www.amazon.com/dp/${A}`).marketplace).toBe('amazon.com')
  })

  it('reports the tag that was pasted, only when it looks like an ID', () => {
    expect(ok(`https://www.amazon.it/dp/${A}?tag=mysite-21&th=1`).tag).toBe('mysite-21')
    expect(ok(`https://www.amazon.it/dp/${A}?tag=%3Cscript%3E`).tag).toBeUndefined()
    expect(ok(`https://www.amazon.it/dp/${A}`).tag).toBeUndefined()
  })
})

describe('parseAmazonUrl: junk', () => {
  it.each([
    ['', 'invalid'],
    ['   ', 'invalid'],
    ['not a url at all', 'invalid'],
    ['javascript:alert(1)', 'invalid'],
    ['mailto:a@b.it', 'invalid'],
    ['https://example.com/dp/B08N5WRWNW', 'not_amazon'],
    ['https://amazon.de.evil.com/dp/B08N5WRWNW', 'not_amazon'],
    ['https://evilamazon.de/dp/B08N5WRWNW', 'not_amazon'],
    ['https://evil.com/?u=https://www.amazon.de/dp/B08N5WRWNW', 'not_amazon'],
    ['https://www.amazon.xx/dp/B08N5WRWNW', 'not_amazon'],
    ['https://aws.amazon.de/dp/B08N5WRWNW', 'not_amazon'],
    ['https://www.amazon.de/', 'no_product'],
    ['https://www.amazon.de/dp/SHORT', 'no_product'],
    ['https://www.amazon.de/dp/B08N5WRWNW1', 'no_product'],
    ['https://www.amazon.de/dp/B08N5WRW-W', 'no_product'],
    ['https://www.amazon.de/s?k=books', 'no_product'],
    ['https://www.amazon.de/gp/cart/view.html?asin=bad', 'no_product'],
    ['https://amzn.eu/d/abc123', 'short_link'],
  ])('%j → %s', (url, error) => {
    expect(parseAmazonUrl(url)).toEqual({ ok: false, error })
  })

  it('never throws on non-strings', () => {
    expect(parseAmazonUrl(undefined as never)).toEqual({ ok: false, error: 'invalid' })
    expect(parseAmazonUrl(42 as never)).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('isAmazonShortLink', () => {
  it.each(['https://amzn.to/3abc', 'https://amzn.eu/d/0abc', 'https://a.co/d/abc', 'https://amzn.asia/d/abc', 'https://www.amzn.to/x', 'amzn.eu/d/abc', 'https://amzn.com/d/abc'])('%s is short', (u) => {
    expect(isAmazonShortLink(u)).toBe(true)
  })
  it.each(['https://www.amazon.de/dp/B08N5WRWNW', 'https://example.com/d/x', 'https://amzn.evil.com/d/x', 'https://notamzn.to/x', 'https://amzn.com/B08N5WRWNW', '', 'ftp://amzn.to/x'])('%s is not', (u) => {
    expect(isAmazonShortLink(u)).toBe(false)
  })
  it('looksLikeAmazon covers marketplace hosts and short links only', () => {
    expect(looksLikeAmazon('https://www.amazon.it/anything')).toBe(true)
    expect(looksLikeAmazon('https://amzn.eu/d/x')).toBe(true)
    expect(looksLikeAmazon('https://example.com')).toBe(false)
    expect(looksLikeAmazon('')).toBe(false)
  })
})

describe('buildAffiliateUrl', () => {
  it('builds the clean link and drops every other parameter', () => {
    const p = ok(`https://www.amazon.de/Name/dp/${A}/ref=sr_1_3?keywords=x&qid=1&th=1&psc=1&linkCode=ll1&tag=someone-else-21`)
    expect(buildAffiliateUrl(p, 'mine-21')).toBe(`https://www.amazon.de/dp/${A}?tag=mine-21`)
  })
  it("replaces the pasted tag with the tenant's ID for that marketplace", () => {
    expect(buildAffiliateUrl(ok(`https://www.amazon.it/dp/${A}?tag=old-21`), 'new-21')).toBe(`https://www.amazon.it/dp/${A}?tag=new-21`)
  })
  it('no ID configured: keeps the pasted tag (probably theirs)', () => {
    expect(buildAffiliateUrl(ok(`https://www.amazon.it/dp/${A}?tag=theirs-21&x=1`))).toBe(`https://www.amazon.it/dp/${A}?tag=theirs-21`)
    expect(buildAffiliateUrl(ok(`https://www.amazon.it/dp/${A}?tag=theirs-21`), null)).toBe(`https://www.amazon.it/dp/${A}?tag=theirs-21`)
    expect(buildAffiliateUrl(ok(`https://www.amazon.it/dp/${A}?tag=theirs-21`), '  ')).toBe(`https://www.amazon.it/dp/${A}?tag=theirs-21`)
  })
  it('no ID and no pasted tag: no tag, never an Abluo ID', () => {
    const u = buildAffiliateUrl(ok(`https://amazon.fr/gp/product/${A}?ref=x`))
    expect(u).toBe(`https://www.amazon.fr/dp/${A}`)
    expect(u).not.toContain('tag')
  })
  it('uses the marketplace host, normalising smile. and the missing www.', () => {
    expect(buildAffiliateUrl(ok(`https://smile.amazon.com/dp/${A}`))).toBe(`https://www.amazon.com/dp/${A}`)
    expect(buildAffiliateUrl(ok(`https://amazon.co.uk/dp/${A}`), 'x-21')).toBe(`https://www.amazon.co.uk/dp/${A}?tag=x-21`)
  })
})
