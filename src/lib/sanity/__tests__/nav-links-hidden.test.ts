import { describe, expect, it } from 'vitest'
import { isRenderableNavLink, resolveNavLinks } from '@/lib/sanity/nav-links'
import type { NavLink } from '@/lib/sanity/types'

describe('nav links × unpublished pages and cookie settings (ADR-021)', () => {
  const links: NavLink[] = [
    { label: 'Privacy', linkType: 'internal', hasPageRef: true, pageSlug: 'privacy-policy' },
    { label: 'Cookies (draft page)', linkType: 'internal', hasPageRef: true },
    { label: 'Home', linkType: 'internal', internalPage: 'homepage' },
    { label: 'Cookie settings', linkType: 'cookieSettings' },
  ]
  it('a link to an unpublished page is hidden, not sent to the home page', () => {
    expect(isRenderableNavLink(links[1])).toBe(false)
    const out = resolveNavLinks(links, 'en', 'livener')
    expect(out.map((l) => l.label)).toEqual(['Privacy', 'Home'])
    expect(out[0].href).toBe('/en/livener/privacy-policy')
  })
  it('cookieSettings never becomes an <a>', () => {
    expect(isRenderableNavLink(links[3])).toBe(false)
  })
})
