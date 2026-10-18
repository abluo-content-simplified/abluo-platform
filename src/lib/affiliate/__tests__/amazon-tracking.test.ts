import { describe, expect, it } from 'vitest'
import { AMAZON_MARKETPLACES } from '../amazon-marketplaces'
import { chooseAmazonUrl, describeAmazonLink, marketplaceForCountry, trackingIdFor } from '../amazon-tracking'

const A = 'B08N5WRWNW'
const IDS = [
  { marketplace: 'amazon.de', trackingId: 'tmz-21' },
  { marketplace: 'amazon.it', trackingId: 'tmzit-21' },
  null,
  { marketplace: 'amazon.fr', trackingId: '' },
  { marketplace: 'amazon.es', trackingId: 'bad id!' },
]

describe('trackingIdFor', () => {
  it('finds the ID of one marketplace and ignores junk rows', () => {
    expect(trackingIdFor(IDS, 'amazon.de')).toBe('tmz-21')
    expect(trackingIdFor(IDS, 'amazon.fr')).toBeNull()
    expect(trackingIdFor(IDS, 'amazon.es')).toBeNull()
    expect(trackingIdFor(IDS, 'amazon.com')).toBeNull()
    expect(trackingIdFor(undefined, 'amazon.de')).toBeNull()
    expect(trackingIdFor(null, 'amazon.de')).toBeNull()
  })
})

describe('marketplaceForCountry (by country, never language)', () => {
  it.each([['IT', 'amazon.it'], ['it', 'amazon.it'], ['DE', 'amazon.de'], ['AT', 'amazon.de'], ['FR', 'amazon.fr'], ['GB', 'amazon.co.uk'], ['IE', 'amazon.co.uk'], ['US', 'amazon.com'], ['BE', 'amazon.com.be'], ['LU', 'amazon.fr']])('%s → %s', (c, m) => {
    expect(marketplaceForCountry(c)).toBe(m)
  })
  it('unknown, empty or missing country → null', () => {
    expect(marketplaceForCountry('ZZ')).toBeNull()
    expect(marketplaceForCountry('CH')).toBeNull()
    expect(marketplaceForCountry('')).toBeNull()
    expect(marketplaceForCountry(null)).toBeNull()
    expect(marketplaceForCountry(undefined)).toBeNull()
  })
  it('every country belongs to one marketplace only', () => {
    const seen = new Map<string, string>()
    for (const m of AMAZON_MARKETPLACES) for (const c of m.countries) {
      expect(seen.get(c), c).toBeUndefined()
      seen.set(c, m.id)
    }
  })
})

describe('chooseAmazonUrl', () => {
  const it_ = `https://www.amazon.it/dp/${A}`
  const de = `https://www.amazon.de/dp/B0DEDEDEDE`
  it('uses the item URL for the visitor country marketplace', () => {
    const c = chooseAmazonUrl(it_, [de], { country: 'DE', trackingIds: IDS })!
    expect(c.marketplace).toBe('amazon.de')
    expect(c.href).toBe('https://www.amazon.de/dp/B0DEDEDEDE?tag=tmz-21')
    expect(c.ownId).toBe(true)
  })
  it('falls back to the primary when there is no URL for that country, or no/unknown country', () => {
    expect(chooseAmazonUrl(it_, [de], { country: 'FR', trackingIds: IDS })!.href).toBe(`https://www.amazon.it/dp/${A}?tag=tmzit-21`)
    expect(chooseAmazonUrl(it_, [de], { country: null, trackingIds: IDS })!.href).toBe(`https://www.amazon.it/dp/${A}?tag=tmzit-21`)
    expect(chooseAmazonUrl(it_, undefined, { country: 'DE', trackingIds: IDS })!.marketplace).toBe('amazon.it')
  })
  it('primary used as is when the visitor country matches its own marketplace', () => {
    expect(chooseAmazonUrl(it_, [de], { country: 'IT', trackingIds: IDS })!.marketplace).toBe('amazon.it')
  })
  it('ignores unreadable extras', () => {
    expect(chooseAmazonUrl(it_, ['https://example.com', 'https://amzn.eu/d/x'], { country: 'DE', trackingIds: IDS })!.marketplace).toBe('amazon.it')
  })
  it('no ID for the marketplace: keeps the pasted tag, else no tag', () => {
    expect(chooseAmazonUrl(`https://www.amazon.fr/dp/${A}?tag=pasted-21`, [], { country: 'FR', trackingIds: IDS })).toMatchObject({ href: `https://www.amazon.fr/dp/${A}?tag=pasted-21`, tagged: true, ownId: false })
    expect(chooseAmazonUrl(`https://www.amazon.fr/dp/${A}`, [], { country: 'FR', trackingIds: IDS })).toMatchObject({ href: `https://www.amazon.fr/dp/${A}`, tagged: false })
  })
  it('null when the primary is not a readable Amazon product', () => {
    expect(chooseAmazonUrl('https://example.com/x', [], { country: 'IT', trackingIds: IDS })).toBeNull()
    expect(chooseAmazonUrl('https://amzn.eu/d/x', [], { country: 'IT', trackingIds: IDS })).toBeNull()
  })
})

describe('describeAmazonLink (the editor)', () => {
  it('none for anything that is not Amazon', () => {
    expect(describeAmazonLink('', IDS)).toEqual({ state: 'none' })
    expect(describeAmazonLink('https://shop.example.com/b', IDS)).toEqual({ state: 'none' })
  })
  it('short, unreadable and ok with the source of the ID', () => {
    expect(describeAmazonLink('https://amzn.eu/d/x', IDS)).toEqual({ state: 'short' })
    expect(describeAmazonLink('https://www.amazon.de/', IDS)).toEqual({ state: 'unreadable' })
    expect(describeAmazonLink(`https://www.amazon.de/dp/${A}?x=1`, IDS)).toEqual({ state: 'ok', marketplace: 'amazon.de', href: `https://www.amazon.de/dp/${A}?tag=tmz-21`, idSource: 'settings' })
    expect(describeAmazonLink(`https://www.amazon.fr/dp/${A}?tag=mine-21`, IDS)).toMatchObject({ idSource: 'pasted', href: `https://www.amazon.fr/dp/${A}?tag=mine-21` })
    expect(describeAmazonLink(`https://www.amazon.fr/dp/${A}`, IDS)).toMatchObject({ idSource: 'none', href: `https://www.amazon.fr/dp/${A}` })
  })
})
