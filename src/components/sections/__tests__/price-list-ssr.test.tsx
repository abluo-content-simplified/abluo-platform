import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PriceListSection, highlightGridClass } from '@/components/sections/PriceListSection'
import type { PriceListSection as PriceListSectionType } from '@/lib/sanity/types'
import { PAGE_SECTIONS_PROJECTION } from '@/lib/sanity/queries'
import { PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'
import { SECTION_CATALOGUE } from '@/lib/sanity/sections/catalogue'

const n = (s: string) => s.replace(/[  ]/g, ' ')

// Tom's mock-up for the CYCE registration page — the first use.
const MONTHS: Array<[string, number, number]> = [
  ['January', 12, 300],
  ['March', 10, 280],
  ['May', 8, 260],
  ['June', 7, 230],
  ['September', 4, 140],
  ['October', 3, 110],
]

const mockup = (extra: Partial<PriceListSectionType> = {}): PriceListSectionType => ({
  _type: 'priceListSection',
  _key: 'fees',
  title: 'Annual Membership Fees',
  intro: 'Membership fees depend on your joining date. All memberships are valid until December 31 of the current year.',
  currency: 'EUR',
  priceDecimals: 'auto',
  perPeriod: 'month',
  rows: MONTHS.map(([label, quantity, price]) => ({ _key: label, label, quantity, price })),
  highlightsTitle: 'Special Membership Rates',
  highlights: [
    { _key: 't', label: 'Trainees', price: 80, description: 'For the entire traineeship' },
    { _key: 'i', label: 'Temporary staff', price: 100, description: 'Interim staff (intérimaires)' },
  ],
  footnote: 'Monthly amounts are provided for comparison only.\nMembership fees are payable as a single amount.',
  ...extra,
})

const html = (s: PriceListSectionType, locale = 'en') =>
  n(renderToStaticMarkup(<PriceListSection section={s} surface={'usePagePattern' as never} designSystem={null} locale={locale} />))

describe('PriceListSection — SSR of the mock-up', () => {
  const out = html(mockup())

  it('renders the header', () => {
    expect(out).toContain('Annual Membership Fees</h2>')
    expect(out).toContain('Membership fees depend on your joining date.')
  })

  it('renders every row with label, auto sub-label, price and per-month line', () => {
    expect(out.match(/<li /g)?.length).toBe(8) // 6 rows + 2 cards
    for (const [label, q, price] of MONTHS) {
      expect(out).toContain(`>${label}<`)
      expect(out).toContain(`>${q} months<`)
      expect(out).toContain(`>€${price}<`)
    }
    for (const v of ['€25.00/month', '€28.00/month', '€32.50/month', '€32.86/month', '€35.00/month', '€36.67/month']) {
      expect(out).toContain(`<span aria-hidden="true">${v}</span>`)
    }
    expect(out).toContain('<span class="sr-only">€32.86 per month</span>')
  })

  it('uses lists for screen readers', () => {
    expect(out).toContain('<ul role="list" data-price-list-rows=""')
    expect(out).toContain('data-price-list-highlights=""')
  })

  it('renders the highlight cards and their heading', () => {
    expect(out).toContain('Special Membership Rates</h3>')
    expect(out).toContain('>Trainees<')
    expect(out).toContain('>€80<')
    expect(out).toContain('>Temporary staff<')
    expect(out).toContain('>€100<')
    expect(out).toContain('Interim staff (intérimaires)')
    expect(out).toContain('sm:grid-cols-2')
  })

  it('renders the footnote with its line break kept', () => {
    expect(out).toContain('Monthly amounts are provided for comparison only.\nMembership fees')
    const at = out.indexOf('data-price-list-footnote')
    expect(out.slice(out.lastIndexOf('<', at), at)).toContain('whitespace-pre-line')
  })

  it('formats for French visitors', () => {
    const fr = html(mockup(), 'fr')
    expect(fr).toContain('>300 €<')
    expect(fr).toContain('25,00 €/mois')
    expect(fr).toContain('>12 mois<')
  })

  it('per-period off: no per-month lines and no auto sub-labels', () => {
    const off = html(mockup({ perPeriod: 'none' }))
    expect(off).not.toContain('/month')
    expect(off).not.toContain('12 months')
    expect(off).toContain('>€300<')
  })

  it('a row with a priceNote shows the note instead of the calculation', () => {
    const s = mockup({ rows: [{ _key: 'a', label: 'January', price: 300, quantity: 12, priceNote: 'one-off fee' }] })
    const out2 = html(s)
    expect(out2).toContain('>one-off fee<')
    expect(out2).not.toContain('/month')
  })

  it('a highlight card without a price renders without one', () => {
    const s = mockup({ highlights: [{ _key: 'x', label: 'Families', description: 'Ask us' }] })
    const out2 = html(s)
    expect(out2).toContain('>Families<')
    expect(out2).toContain('Ask us')
    expect(highlightGridClass(1)).toBe('grid-cols-1')
  })
})

describe('PriceListSection — empty cases', () => {
  it('renders nothing when there is nothing to show', () => {
    expect(html({ _type: 'priceListSection', _key: 'e' })).toBe('')
    expect(html({ _type: 'priceListSection', _key: 'e', rows: [], highlights: [], footnote: '  ' })).toBe('')
    expect(html({ _type: 'priceListSection', _key: 'e', rows: [{ _key: 'r' }] })).toBe('')
  })

  it('header only: no list markup', () => {
    const out = html({ _type: 'priceListSection', _key: 'e', title: 'Prices' })
    expect(out).toContain('Prices</h2>')
    expect(out).not.toContain('<ul')
  })

  it('rows only, no highlights, no footnote', () => {
    const out = html({ _type: 'priceListSection', _key: 'e', rows: [{ _key: 'r', label: 'Single class', price: 15 }] })
    expect(out).toContain('>€15<')
    expect(out).not.toContain('data-price-list-highlights')
    expect(out).not.toContain('data-price-list-footnote')
  })
})

describe('priceListSection is registered and projected', () => {
  it('is offered on every page and described in the picker', () => {
    expect(PAGE_SECTIONS_OF.map((m) => (m as { type: string }).type)).toContain('priceListSection')
    expect(SECTION_CATALOGUE.priceListSection?.group).toBe('offer')
  })

  it('the page projection fetches every field', () => {
    const q = PAGE_SECTIONS_PROJECTION
    for (const k of ['currency,', 'priceDecimals,', 'perPeriod,', '"highlightsTitle":', '"footnote":', '"intro":', '"title":', '"eyebrow":', 'headlineAccent,', 'anchorId,', 'background,']) {
      expect(q, k).toContain(k)
    }
    const rows = q.slice(q.indexOf('rows[] {'), q.indexOf('}', q.indexOf('rows[] {')))
    for (const k of ['"label":', '"sublabel":', 'price,', 'quantity,', '"priceNote":']) expect(rows, `rows ${k}`).toContain(k)
    // careerTimelineSection still shares the key
    expect(rows).toContain('"period":')
    const hl = q.slice(q.indexOf('highlights[] {'), q.indexOf('}', q.indexOf('highlights[] {')))
    for (const k of ['"label":', 'price,', '"description":']) expect(hl, `highlights ${k}`).toContain(k)
  })
})
