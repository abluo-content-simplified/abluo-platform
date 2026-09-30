import { describe, it, expect } from 'vitest'
import {
  formatPrice,
  priceSummary,
  resolveEventLink,
  validPriceOptions,
  visibleHosts,
} from '@/lib/modules/events/engagement'
import * as Q from '@/lib/sanity/queries'

// Normalise Intl's non-breaking spaces so assertions stay readable.
const n = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')

describe('formatPrice', () => {
  it('drops decimals for whole amounts', () => {
    expect(n(formatPrice(30, 'EUR', 'en'))).toBe('€30')
    expect(n(formatPrice(30, 'EUR', 'it'))).toBe('30 €')
  })
  it('keeps two decimals for fractional amounts', () => {
    expect(n(formatPrice(12.5, 'EUR', 'en'))).toBe('€12.50')
  })
  it('defaults to EUR and uppercases the code', () => {
    expect(n(formatPrice(10, undefined, 'en'))).toBe('€10')
    expect(n(formatPrice(10, 'chf', 'de'))).toBe('10 CHF')
  })
  it('never throws on an invalid currency code', () => {
    expect(formatPrice(10, 'EURO', 'en')).toBe('10 EURO')
  })
})

describe('validPriceOptions', () => {
  it('drops options without a finite numeric amount', () => {
    const out = validPriceOptions([
      { label: 'a', amount: 10 },
      { label: 'b' },
      { label: 'c', amount: Number.NaN },
      { label: 'd', amount: 0 },
    ])
    expect(out.map((o) => o.label)).toEqual(['a', 'd'])
  })
  it('handles null/undefined', () => {
    expect(validPriceOptions(undefined)).toEqual([])
    expect(validPriceOptions(null)).toEqual([])
  })
})

describe('priceSummary', () => {
  const from = 'from {price}'
  it('returns null when there is nothing to show', () => {
    expect(priceSummary(undefined, 'en', from)).toBeNull()
    expect(priceSummary([{ label: 'x' }], 'en', from)).toBeNull()
  })
  it('shows the single price as-is', () => {
    expect(n(priceSummary([{ amount: 45, currency: 'EUR' }], 'en', from))).toBe('€45')
  })
  it('shows "from" the lowest price when several share a currency', () => {
    expect(n(priceSummary([{ amount: 45 }, { amount: 30 }, { amount: 60 }], 'en', from))).toBe('from €30')
    expect(n(priceSummary([{ amount: 45 }, { amount: 30 }], 'fr', 'à partir de {price}'))).toBe('à partir de 30 €')
  })
  it('drops "from" when every price is equal', () => {
    expect(n(priceSummary([{ amount: 30 }, { amount: 30, currency: 'EUR' }], 'en', from))).toBe('€30')
  })
  it('falls back to the first option for mixed currencies', () => {
    expect(n(priceSummary([{ amount: 50, currency: 'CHF' }, { amount: 30, currency: 'EUR' }], 'en', from))).toBe('CHF 50')
  })
})

describe('resolveEventLink', () => {
  it('passes absolute URLs through and flags them external', () => {
    expect(resolveEventLink('https://example.com/register', 'fr', 'cyce')).toEqual({
      href: 'https://example.com/register',
      external: true,
    })
  })
  it('prefixes site-relative paths and keeps the anchor', () => {
    expect(resolveEventLink('/teachers#florian-parra', 'fr', 'cyce')).toEqual({
      href: '/fr/cyce/teachers#florian-parra',
      external: false,
    })
  })
  it('leaves bare anchors and mailto alone, not external', () => {
    expect(resolveEventLink('#prices', 'en', 'cyce')).toEqual({ href: '#prices', external: false })
    expect(resolveEventLink('mailto:a@b.c', 'en', 'cyce')).toEqual({ href: 'mailto:a@b.c', external: false })
  })
  it('returns null for empty input', () => {
    expect(resolveEventLink(undefined, 'en', 'cyce')).toBeNull()
    expect(resolveEventLink('   ', 'en', 'cyce')).toBeNull()
  })
})

describe('visibleHosts', () => {
  it('keeps only hosts with a name', () => {
    expect(visibleHosts([{ name: 'Anna' }, { name: '  ' }, {}, { name: 'Marco', url: '/t#m' }]).map((h) => h.name)).toEqual([
      'Anna',
      'Marco',
    ])
  })
})

// Every query that projects events must carry the new fields (CLAUDE.md:
// a projection added to one event query and not another is a silent gap).
describe('event queries project registration / prices / hosts', () => {
  const eventQueries: Record<string, string> = {
    eventsQuery: Q.eventsQuery,
    eventBySlugQuery: Q.eventBySlugQuery,
    pastEventsQuery: Q.pastEventsQuery,
    additionalLiveEventsQuery: Q.additionalLiveEventsQuery,
    currentLiveEventQuery: Q.currentLiveEventQuery,
    homepageFeaturedEventQuery: Q.homepageFeaturedEventQuery,
    eventsListingEventsNewestQuery: Q.eventsListingEventsNewestQuery,
    eventsListingEventsOldestQuery: Q.eventsListingEventsOldestQuery,
    eventsListingManualEventsQuery: Q.eventsListingManualEventsQuery,
    postBySlugQuery: Q.postBySlugQuery,
  }
  for (const [name, q] of Object.entries(eventQueries)) {
    it(name, () => {
      expect(q).toContain('registrationUrl')
      expect(q).toContain('"registrationLabel"')
      expect(q).toContain('priceOptions[]')
      expect(q).toContain('hosts[]')
    })
  }

  it('team members project website and anchorId in the shared section projection', () => {
    for (const q of [Q.PAGE_SECTIONS_PROJECTION, Q.homePageQuery]) {
      const at = q.indexOf('members[]')
      expect(at).toBeGreaterThan(-1)
      const block = q.slice(at, q.indexOf('},', q.indexOf('"bio"', at)))
      expect(block).toContain('website')
      expect(block).toContain('anchorId')
    }
  })
})
