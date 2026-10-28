import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HeroSection } from '@/components/sections/HeroSection'
import { HEADLINE_ACCENT_STYLE } from '@/lib/headline-accent'
import type { HeroSection as HeroSectionType, DesignSystem } from '@/lib/sanity/types'

/** heroSection.taglineAccent — opt-in accent colour for the tagline (CYCE "Enjoy your practice!"). */

const ds = {} as DesignSystem
const hero = (extra: Partial<HeroSectionType> = {}) =>
  ({
    _type: 'heroSection',
    _key: 'h',
    headline: 'Hi',
    subheadline: 'Sub',
    tagline: 'Enjoy your practice!',
    ctaLabel: 'Sign Up',
    ctaHref: '/x',
    ...extra,
  }) as unknown as HeroSectionType

const render = (s: HeroSectionType) =>
  renderToStaticMarkup(<HeroSection section={s} surface={'transparent' as never} designSystem={ds} />)

function taglineTag(html: string): string {
  const m = html.match(/<p[^>]*>Enjoy your practice!<\/p>/)
  return m ? m[0] : ''
}

describe('hero tagline accent', () => {
  it('uses the same colour source as the headline accent', () => {
    expect(HEADLINE_ACCENT_STYLE.color).toBe('var(--color-primary)')
  })

  it('off by default — tagline keeps the headline colour, not the accent', () => {
    const tag = taglineTag(render(hero()))
    expect(tag).not.toBe('')
    expect(tag).not.toContain('var(--color-primary)')
  })

  it('null / false are identical to unset', () => {
    const def = render(hero())
    expect(render(hero({ taglineAccent: null }))).toBe(def)
    expect(render(hero({ taglineAccent: false }))).toBe(def)
  })

  it('on — tagline is painted in the accent colour, everything else unchanged', () => {
    const on = render(hero({ taglineAccent: true }))
    expect(taglineTag(on)).toContain('color:var(--color-primary)')
    const off = render(hero())
    expect(on.replace(taglineTag(on), '')).toBe(off.replace(taglineTag(off), ''))
  })

  it('the tagline still sits after the subheadline and before the CTA', () => {
    const html = render(hero({ taglineAccent: true }))
    expect(html.indexOf('Sub')).toBeLessThan(html.indexOf('Enjoy your practice!'))
    expect(html.indexOf('Enjoy your practice!')).toBeLessThan(html.indexOf('Sign Up'))
  })

  it('no tagline → the accent flag renders nothing', () => {
    expect(render(hero({ tagline: undefined, taglineAccent: true }))).toBe(render(hero({ tagline: undefined })))
  })
})

describe('GROQ projection carries the new fields', () => {
  const src = readFileSync(resolve(__dirname, '../../../lib/sanity/queries.ts'), 'utf8')
  const start = src.indexOf('export const PAGE_SECTIONS_PROJECTION')
  const pageSections = src.slice(start, src.indexOf('export const', start + 10))

  it('PAGE_SECTIONS_PROJECTION projects taglineAccent', () => {
    expect(pageSections).toMatch(/^\s*taglineAccent,$/m)
  })
})
