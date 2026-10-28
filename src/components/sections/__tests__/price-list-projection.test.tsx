import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionRenderer } from '@/components/sections/SectionRenderer'
import type { PageSection } from '@/lib/sanity/types'
import { PAGE_SECTIONS_PROJECTION } from '@/lib/sanity/queries'
import fixture from './fixtures/price-list-projection.json'

// Regression (2026-10-28): the CYCE registration page showed nothing where the
// Price List should be. Cause: the page was checked on preview.abluo.app while
// the v1.0.79 preview build was still running, so the v1.0.78 build answered
// and its SectionRenderer had no case for priceListSection (default → null).
// The data and the new code were fine. This test pins that: the REAL
// pageBySlugQuery output for fees1 (every key of the flat projection, nulls
// included, careerRow keys inside rows[] too) goes through the real
// SectionRenderer dispatch and must render the full section.

const n = (s: string) => s.replace(/[  ]/g, ' ')
const render = (locale: 'en' | 'fr') =>
  n(
    renderToStaticMarkup(
      <SectionRenderer
        section={fixture[locale] as unknown as PageSection}
        siteConfig={null}
        designSystem={null}
        backgroundPattern={undefined}
        sectionIndex={1}
        locale={locale}
        tenantSlug={'cyce' as never}
        enabledModuleIds={[]}
      />,
    ),
  )

describe('priceListSection — real projection through SectionRenderer', () => {
  it('en: renders title, all rows, per-month lines, cards and footnote', () => {
    const out = render('en')
    expect(out).toContain('id="fees"')
    expect(out).toContain('Annual Membership Fees</h2>')
    for (const label of ['January', 'March', 'May', 'June', 'September', 'October']) expect(out).toContain(`>${label}<`)
    for (const v of ['€25.00/month', '€32.50/month', '€32.86/month', '€36.67/month']) expect(out).toContain(v)
    expect(out).toContain('>12 months<')
    expect(out).toContain('>€300<')
    expect(out).toContain('Special Membership Rates</h3>')
    expect(out).toContain('>Trainees<')
    expect(out).toContain('>€80<')
    expect(out).toContain('>€100<')
    expect(out).toContain('Membership fees are payable as a single amount.')
  })

  it('fr: localized formatting and unit words', () => {
    const out = render('fr')
    expect(out).toContain('Cotisations annuelles</h2>')
    expect(out).toContain('>300 €<')
    expect(out).toContain('36,67 €/mois')
    expect(out).toContain('>12 mois<')
    expect(out).toContain('Tarifs spéciaux</h3>')
  })

  it('rendered even when no module is installed (platform section, never gated)', () => {
    expect(render('en').length).toBeGreaterThan(1000)
  })

  it('every non-null key in the real response is a key the projection names', () => {
    for (const k of Object.keys(fixture.en).filter((k) => (fixture.en as Record<string, unknown>)[k] !== null && !k.startsWith('_'))) {
      expect(PAGE_SECTIONS_PROJECTION, k).toMatch(new RegExp(`(^|[\\s"])${k}("|,|\\[|\\s|\\{)`))
    }
  })
})
