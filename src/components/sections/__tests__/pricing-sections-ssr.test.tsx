import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PricingCardsSection, pricingGridClass } from '@/components/sections/PricingCardsSection'
import { ComparisonTableSection } from '@/components/sections/ComparisonTableSection'
import { SectionRenderer } from '@/components/sections/SectionRenderer'
import type { PricingCardsSection as PCS, ComparisonTableSection as CTS, PageSection } from '@/lib/sanity/types'
import { PAGE_SECTIONS_PROJECTION } from '@/lib/sanity/queries'
import { PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'
import { SECTION_CATALOGUE } from '@/lib/sanity/sections/catalogue'
import { pricingSchemaTypes } from '@/lib/sanity/schema-pricing'

const n = (s: string) => s.replace(/[  ]/g, ' ')

// Tom's design canvas "Abluo Pricing Page" (2026-11-07) — the first use.
const plans = (extra: Partial<PCS> = {}): PCS => ({
  _type: 'pricingCardsSection',
  _key: 'plans',
  title: 'Your website. Your tools.',
  cardLayout: 'plans',
  currency: 'EUR',
  priceDecimals: 'auto',
  yearlyPaidMonths: 10,
  showBillingSwitch: true,
  periodNoteMonthly: 'Pay monthly and cancel any time.',
  periodNoteYearly: 'Prices below show the monthly equivalent.',
  pricingCards: [
    { _key: 'core', name: 'Core', priceMonthly: 29, tagline: 'A complete website.', features: ['Forms', 'Gallery'] },
    { _key: 'flex', name: 'Flex', priceMonthly: 49, highlighted: true, badge: 'You choose 3 modules', features: ['Everything in Core'] },
    { _key: 'complete', name: 'Complete', priceMonthly: 69 },
  ],
  includedTitle: 'Every plan includes',
  included: ['Hosting', 'Security', null],
  footnote: 'Draft prices',
  ...extra,
})

const html = (s: PCS, locale = 'en') => n(renderToStaticMarkup(<PricingCardsSection section={s} surface={'usePagePattern' as never} designSystem={null} locale={locale} />))

describe('pricingCardsSection — plans with the switch', () => {
  const out = html(plans())
  it('renders the switch as a radio group with the computed badge', () => {
    expect(out).toContain('<legend class="sr-only">Billing period</legend>')
    expect(out.match(/type="radio"/g)?.length).toBe(2)
    expect(out).toContain('data-billing-switch=""')
    expect(out).toMatch(/checked="" value="month"/)
    expect(out).toContain('>Save 17%<')
  })
  it('renders both variants of every price, monthly and yearly', () => {
    for (const p of ['€29', '€49', '€69', '€24', '€41', '€58']) expect(out).toContain(`>${p}<`)
    expect(out).toContain('Billed monthly, cancel any time')
    expect(out).toContain('€290 a year instead of €348. You save €58 every year.')
    expect(out.match(/data-billing-show="month"/g)!.length).toBe(4) // 3 prices + period note
    expect(out.match(/data-billing-show="year"/g)!.length).toBe(4)
    expect(out).toContain('<span class="sr-only">per month</span>')
  })
  it('renders badge, bullets, chips and footnote; drops empty chips', () => {
    expect(out).toContain('>You choose 3 modules<')
    expect(out).toContain('>Everything in Core<')
    expect(out).toContain('data-highlighted=""')
    expect(out).toContain('Every plan includes</h3>')
    expect(out.match(/<li class="rounded-full/g)?.length).toBe(2)
    expect(out).toContain('Draft prices')
  })
  it('no switch when no card has a yearly price', () => {
    const o = html(plans({ yearlyPaidMonths: null }))
    expect(o).not.toContain('type="radio"')
    expect(o).not.toContain('data-billing-show')
  })
  it('a section without its own switch still renders both variants (it follows the page switch)', () => {
    const o = html(plans({ showBillingSwitch: false, cardLayout: 'compact', yearlyDisplay: 'yearlyTotal' }))
    expect(o).not.toContain('type="radio"')
    expect(o).toContain('€290 / year (save €58)')
  })
  it('the title can be the page heading', () => {
    expect(html(plans())).toContain('Your tools.</h2>')
    expect(html(plans({ titleIsPageHeading: true }))).toContain('Your tools.</h1>')
  })
  it('Italian', () => {
    const o = html(plans(), 'it')
    expect(o).toContain('>Annuale<')
    expect(o).toContain('Risparmi il 17%')
    expect(o).toContain('29 €')
  })
  it('renders nothing when empty', () => {
    expect(html({ _type: 'pricingCardsSection', _key: 'x' })).toBe('')
  })
  it('grid never has more columns than cards', () => {
    expect(pricingGridClass(1, 'plans')).toBe('grid-cols-1')
    expect(pricingGridClass(3, 'plans')).toContain('lg:grid-cols-3')
  })
})

const table = (extra: Partial<CTS> = {}): CTS => ({
  _type: 'comparisonTableSection',
  _key: 'compare',
  title: 'Compare the plans',
  firstColumnLabel: 'Feature',
  currency: 'EUR',
  yearlyPaidMonths: 10,
  compareColumns: [
    { _key: 'c', label: 'Core', priceMonthly: 29 },
    { _key: 'f', label: 'Flex', priceMonthly: 49, highlighted: true },
    { _key: 'x', label: 'Complete', priceMonthly: 69 },
  ],
  compareGroups: [
    {
      _key: 'g1',
      title: 'Platform',
      compareRows: [
        { _key: 'r1', label: 'Hosting', note: 'Always up to date', cells: [{ kind: 'included' }, { kind: 'included' }, { kind: 'included' }] },
        { _key: 'r2', label: 'FAQ', cells: [{ kind: 'notIncluded' }, { kind: 'text', text: 'Choose 3' }] },
      ],
    },
  ],
  ...extra,
})

const tableHtml = (s: CTS, locale = 'en') => n(renderToStaticMarkup(<ComparisonTableSection section={s} surface={'usePagePattern' as never} designSystem={null} locale={locale} />))

describe('comparisonTableSection', () => {
  const out = tableHtml(table())
  it('is a real table with column, group and row headers', () => {
    expect(out).toContain('<table')
    expect(out.match(/scope="col"/g)?.length).toBe(4)
    expect(out).toContain('scope="colgroup"')
    expect(out.match(/scope="row"/g)?.length).toBe(2)
    expect(out).toContain('>Platform<')
    expect(out).toContain('Always up to date')
  })
  it('cells: ✓ spoken "Included", — spoken "Not included", text; a missing cell is —', () => {
    expect(out.match(/<span class="sr-only">Included<\/span>/g)?.length).toBe(3)
    expect(out.match(/<span class="sr-only">Not included<\/span>/g)?.length).toBe(2)
    expect(out).toContain('>Choose 3<')
  })
  it('header prices follow the switch', () => {
    expect(out).toContain('€29<span aria-hidden="true">/mo</span>')
    expect(out).toContain('€24<span aria-hidden="true">/mo</span>')
    expect(out.match(/data-billing-show="year"/g)?.length).toBe(3)
  })
  it('an empty column does not shift the cells of the next one', () => {
    const o = tableHtml(table({ compareColumns: [{ _key: 'c', label: '' }, { _key: 'f', label: 'Flex' }] }))
    expect(o.match(/scope="col"/g)?.length).toBe(2)
    // row 2's second cell is "Choose 3"
    expect(o).toContain('>Choose 3<')
  })
})

describe('pricing sections — wiring', () => {
  it('are in the page sections array, the picker catalogue and the schema', () => {
    const of = PAGE_SECTIONS_OF.map((m) => (m as { type: string }).type)
    for (const t of ['pricingCardsSection', 'comparisonTableSection']) {
      expect(of).toContain(t)
      expect(SECTION_CATALOGUE[t]).toBeTruthy()
      expect(pricingSchemaTypes.map((x) => x.name)).toContain(t)
    }
  })
  it('the flat projection reads every new key', () => {
    for (const k of ['pricingCards[]', 'yearlyPaidMonths', 'showBillingSwitch', 'cardLayout', 'yearlyDisplay', '"included"', 'compareColumns[]', 'compareGroups[]', 'compareRows[]']) {
      expect(PAGE_SECTIONS_PROJECTION).toContain(k)
    }
  })
  it('SectionRenderer dispatches both types', () => {
    const r = (section: PageSection) =>
      n(renderToStaticMarkup(
        <SectionRenderer section={section} siteConfig={null} designSystem={null} backgroundPattern={undefined} sectionIndex={1} locale="en" tenantSlug={'abluo' as never} enabledModuleIds={[]} />,
      ))
    expect(r(plans() as PageSection)).toContain('>Save 17%<')
    expect(r(table() as PageSection)).toContain('<table')
  })
})
