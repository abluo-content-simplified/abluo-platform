import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeroSection, resolveHeroVariant, statementPunchIndex } from '@/components/sections/HeroSection'
import type { HeroSection as HeroSectionType, DesignSystem } from '@/lib/sanity/types'

/** heroSection.variant 'statement' — claim, big punchline, closing line (Freeriders holding page). */

const ds = {} as DesignSystem
const hero = (extra: Partial<HeroSectionType> = {}) =>
  ({ _type: 'heroSection', _key: 'h', headline: 'We connect Riders and Stores\nEasy.\nDelivery made Simple.', contentAlignment: 'center', ...extra }) as unknown as HeroSectionType
const render = (s: HeroSectionType) => renderToStaticMarkup(<HeroSection section={s} surface={'transparent' as never} designSystem={ds} />)

describe('statement treatment', () => {
  it('is a recognised treatment; anything else still falls back to standard', () => {
    expect(resolveHeroVariant('statement')).toBe('statement')
    expect(resolveHeroVariant('Statement')).toBe('standard')
  })

  it('picks the punchline: the second line of three, the last of two, the only one of one', () => {
    expect(statementPunchIndex(['Claim', 'Easy.', 'Closing'])).toBe(1)
    expect(statementPunchIndex(['Claim', 'Easy.'])).toBe(1)
    expect(statementPunchIndex(['Easy.'])).toBe(0)
    expect(statementPunchIndex(['', 'Claim', '', 'Easy.', 'Closing'])).toBe(3)
    expect(statementPunchIndex(['', ' '])).toBe(-1)
  })

  it('punchline in the brand colour at full size; the other lines at two thirds, no short rule', () => {
    const html = render(hero({ variant: 'statement' }))
    expect(html).toMatch(/<span class="block" style="color:var\(--color-primary\);margin-block:0.08em">Easy\.<\/span>/)
    const smaller = html.match(/font-size:min\(calc\(var\(--font-size-h1, var\(--fs-h1\)\) \* 0\.6666666666666666\), var\(--statement-cap\)\)/g) ?? []
    expect(smaller).toHaveLength(2)
    expect(html).not.toContain('w-16')
    // The h1 still reads as one sentence for crawlers and screen readers.
    expect(html).toContain('We connect Riders and Stores</span> <span')
  })

  it('a standard hero is untouched', () => {
    expect(render(hero())).not.toContain('--statement-cap')
    expect(render(hero())).toContain('w-16')
  })
})

describe('hero CTA appearance and position', () => {
  const withCta = (extra: Partial<HeroSectionType> = {}) => hero({ ctaLabel: 'Interested?', ctaHref: '#form', ...extra })

  it('unset: the usual button right under the copy', () => {
    const html = render(withCta())
    expect(html).toContain('h-12')
    expect(html).toContain('→')
    expect(html).not.toContain('aria-hidden="true" class="flex-1"')
  })

  it("'text': a quiet link in the brand colour at the h4 size, no arrow", () => {
    const html = render(withCta({ ctaAppearance: 'text' }))
    expect(html).toMatch(/class="inline-flex items-center gap-2 font-semibold underline[^"]*" style="color:var\(--color-primary\);font-family:var\(--font-heading\);font-size:var\(--font-size-h4, 1.5rem\)">Interested\?<\/a>/)
    expect(html).not.toContain('→')
  })

  it("'bottom': two spacers centre the copy above a CTA row kept clear of it", () => {
    const html = render(withCta({ ctaPosition: 'bottom' }))
    expect(html.match(/<div class="flex-1" aria-hidden="true"><\/div>/g)).toHaveLength(2)
    expect(html).toContain('mt-16')
  })
})

describe('hero left accent line', () => {
  const line = 'absolute left-0 top-0 h-full w-[3px]'
  it('shown by default, hidden when the hero asks', () => {
    expect(render(hero())).toContain(line)
    expect(render(hero({ hideAccentLine: true }))).not.toContain(line)
  })
})
