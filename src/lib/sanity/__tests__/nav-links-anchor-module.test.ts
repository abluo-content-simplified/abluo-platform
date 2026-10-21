import { describe, it, expect } from 'vitest'
import { resolveNavLink, resolveNavLinks, moduleNavSegment } from '../nav-links'
import { NAV_LINK_FIELDS } from '../queries'
import type { NavLink, SupportedLocale } from '../types'

const L = 'en' as SupportedLocale
const T = 'tmz'

describe('anchor links point at the home page', () => {
  const anchor: NavLink = { label: 'About', linkType: 'anchor', anchorId: 'about' }

  it('path-based surface: /{locale}/{tenant}#id', () => {
    expect(resolveNavLink(anchor, L, T).href).toBe('/en/tmz#about')
    expect(resolveNavLink(anchor, 'it' as SupportedLocale, T).href).toBe('/it/tmz#about')
  })

  it('site own host: /{locale}#id', () => {
    expect(resolveNavLinks([anchor], L, T, undefined, true)[0].href).toBe('/en#about')
    expect(resolveNavLinks([anchor], L, T, undefined, false)[0].href).toBe('/en/tmz#about')
  })

  it('matches the homepage internal link plus the hash', () => {
    const home = resolveNavLink({ label: 'h', linkType: 'internal', internalPage: 'homepage' }, L, T).href
    expect(resolveNavLink(anchor, L, T).href).toBe(`${home}#about`)
  })

  it('without an anchorId stays inert', () => {
    expect(resolveNavLink({ label: 'x', linkType: 'anchor' }, L, T).href).toBe('#')
  })

  it('applies to children', () => {
    const r = resolveNavLink({ label: 'p', linkType: 'internal', children: [anchor] }, L, T)
    expect(r.children?.[0].href).toBe('/en/tmz#about')
  })
})

describe('module links', () => {
  const link: NavLink = {
    label: 'Books',
    linkType: 'module',
    moduleId: 'catalogue',
    moduleSegments: [{ moduleId: 'gallery', segment: null }, { moduleId: 'catalogue', segment: 'books' }],
  }

  it('resolves to the module public segment', () => {
    expect(moduleNavSegment(link)).toBe('books')
    expect(resolveNavLink(link, L, T).href).toBe('/en/tmz/books')
    expect(resolveNavLinks([link], L, T, undefined, true)[0].href).toBe('/en/books')
  })

  it('is hidden when the module is not installed / has no segment', () => {
    expect(resolveNavLinks([{ ...link, moduleSegments: [] }], L, T)).toEqual([])
    expect(resolveNavLinks([{ ...link, moduleSegments: null }], L, T)).toEqual([])
    expect(resolveNavLinks([{ ...link, moduleId: undefined }], L, T)).toEqual([])
  })

  it('the query projects moduleId and moduleSegments', () => {
    expect(NAV_LINK_FIELDS).toContain('moduleSegments')
    expect(NAV_LINK_FIELDS).toContain('moduleId')
  })
})
