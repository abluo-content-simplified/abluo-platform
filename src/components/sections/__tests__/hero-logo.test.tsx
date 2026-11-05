import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeroSection } from '@/components/sections/HeroSection'
import { PAGE_SECTIONS_PROJECTION } from '@/lib/sanity/queries'
import type { HeroSection as HeroSectionType, DesignSystem } from '@/lib/sanity/types'

/** heroSection.showLogo — the site's logo, large, above the headline (Freeriders holding page). */

const ds = {} as DesignSystem
const logo = { asset: { _ref: 'image-abc123-383x60-svg', _type: 'reference' }, alt: 'Freeriders' }
const hero = (extra: Partial<HeroSectionType> = {}) =>
  ({ _type: 'heroSection', _key: 'h', headline: 'We connect Riders and Stores - Easy', contentAlignment: 'center', ...extra }) as unknown as HeroSectionType
const render = (s: HeroSectionType) => renderToStaticMarkup(<HeroSection section={s} surface={'transparent' as never} designSystem={ds} />)

describe('hero site logo', () => {
  it('off by default, and when the site has no logo — nothing changes', () => {
    const def = render(hero())
    expect(def).not.toContain('<img')
    expect(render(hero({ showLogo: false, siteLogo: logo as never }))).toBe(def)
    expect(render(hero({ showLogo: true, siteLogo: null }))).toBe(def)
  })

  it('on: the logo comes first, before the headline, with its alt text', () => {
    const html = render(hero({ showLogo: true, siteLogo: logo as never }))
    const img = html.indexOf('<img')
    expect(img).toBeGreaterThan(-1)
    expect(img).toBeLessThan(html.indexOf('We connect Riders'))
    expect(html).toContain('alt="Freeriders"')
    expect(html).toContain('cdn.sanity.io/images/')
  })

  it('the page projection reads the logo from Website Settings, only when asked', () => {
    expect(PAGE_SECTIONS_PROJECTION).toContain('showLogo,')
    expect(PAGE_SECTIONS_PROJECTION).toMatch(/"siteLogo": select\(showLogo == true => \*\[_type == "siteConfig" && projectSlug == \$projectSlug/)
  })
})
