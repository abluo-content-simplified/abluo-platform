import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const localeLayout = readFileSync(
  join(process.cwd(), 'src/app/[locale]/layout.tsx'),
  'utf8'
)
const rootDocument = readFileSync(
  join(process.cwd(), 'src/components/RootDocument.tsx'),
  'utf8'
)

/**
 * Worttrennung — long words must break instead of scrolling the page sideways.
 *
 * MEASURED on production 2026-10-13 across 144 URLs on 7 domains at 320px and
 * 390px: 23 pages scrolled horizontally. Every one of the seven languages
 * failed at least once; German and Dutch failed worst ("Datenschutzerklärung"
 * 562px wide, "hospitalitybedrijven." 496px, both against a 272px column).
 *
 * These are structural assertions on the stylesheet because the rule is CSS,
 * and jsdom implements neither hyphenation nor layout — a behavioural test here
 * would pass whatever the stylesheet said. The behaviour is verified in a
 * browser by scripts/audit-overflow.mjs, which is the artefact that produced
 * the numbers above.
 */
describe('text has a wrapping policy', () => {
  const TEXT_ELEMENTS = ['h1', 'h2', 'h3', 'p', 'li', 'td']

  it('hyphenates and breaks long words on text elements', () => {
    const rule = css.match(
      /:where\(h1,[^)]*\)\s*\{[^}]*\}/
    )?.[0]
    expect(rule).toBeDefined()
    for (const el of TEXT_ELEMENTS) expect(rule).toContain(el)
    // `anywhere`, NOT `break-word`: only `anywhere` reduces min-content size,
    // which is what lets the flex/grid column shrink so the word has to break
    // at all. Measured: break-word left all 28 overflows byte-identical.
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/)
    expect(rule).toMatch(/hyphens:\s*auto/)
    // Safari needs the prefix; without it the whole fix is Chrome-only.
    expect(rule).toMatch(/-webkit-hyphens:\s*auto/)
  })

  it('does not hyphenate inside the dashboard', () => {
    // A hyphen inside a form submission value or a table cell reads as data
    // corruption, so .abluo-app keeps break-word and opts out of hyphenation.
    const scoped = css.match(/\.abluo-app :where\(h1,[^)]*\)\s*\{[^}]*\}/)?.[0]
    expect(scoped).toBeDefined()
    expect(scoped).toMatch(/hyphens:\s*manual/)
    // and keeps break-word, so table column sizing there is unchanged.
    expect(scoped).toMatch(/overflow-wrap:\s*break-word/)
    expect(scoped).not.toMatch(/hyphens:\s*auto/)
  })

  it('keeps the document language on <html>, which hyphenation depends on', () => {
    // `hyphens: auto` picks its dictionary from the language. Without a correct
    // lang the German rules never load and the fix degrades to break-word.
    // The locale layout passes the URL locale down, and RootDocument is the
    // one place that renders <html>.
    expect(localeLayout).toMatch(/<RootDocument lang=\{locale\}/)
    expect(rootDocument).toMatch(/<html[^>]*lang=\{/)
  })
})
