import { describe, it, expect } from 'vitest'
import { resolveNavLink, resolveNavLinks } from '../nav-links'
import type { SupportedLocale } from '../types'

/**
 * Locale-prefix detection in the legacy-href branch of resolveNavLink().
 *
 * The branch used to test `['en','it','de'].includes(...)` and
 * `['livener'].includes(...)`, so a tenant serving fr/es/nl/pt had `/fr/x`
 * re-prefixed into `/fr/nologo/fr/x`, and the tenant check could only ever
 * match one client. Both lists are gone: locales come from the project's
 * supportedLocales (defaulting to the platform registry) and the tenant
 * segment is compared to the `tenantId` argument.
 */

// A seven-locale project.
const SEVEN: readonly string[] = ['en', 'it', 'de', 'fr', 'es', 'pt', 'nl']
// A two-locale project — the shape live tenants have today.
const TWO: readonly string[] = ['en', 'it']

const nav = (href: string, locale: string, tenantId: string, locales?: readonly string[]) =>
  resolveNavLink({ label: 'x', href }, locale as SupportedLocale, tenantId, locales).href

describe('resolveNavLink — seven-locale project', () => {
  const T = 'acme'

  it('recognises a non-en/it/de locale prefix instead of double-prefixing it', () => {
    expect(nav('/fr/x', 'fr', T, SEVEN)).toBe('/fr/acme/x')
    expect(nav('/pt/x', 'pt', T, SEVEN)).toBe('/pt/acme/x')
    expect(nav('/es/a/b', 'es', T, SEVEN)).toBe('/es/acme/a/b')
    expect(nav('/nl/x', 'nl', T, SEVEN)).toBe('/nl/acme/x')
  })

  it('prefixes a bare path with the current locale and tenant', () => {
    expect(nav('/x', 'fr', T, SEVEN)).toBe('/fr/acme/x')
    expect(nav('/x', 'pt', T, SEVEN)).toBe('/pt/acme/x')
  })

  it('leaves a path that already carries locale + tenant untouched', () => {
    expect(nav('/en/acme/x', 'en', T, SEVEN)).toBe('/en/acme/x')
    expect(nav('/fr/acme/x', 'fr', T, SEVEN)).toBe('/fr/acme/x')
  })

  it('compares the tenant segment to tenantId, not a literal', () => {
    // 'livener' is just another path segment for a different tenant.
    expect(nav('/en/livener/x', 'en', T, SEVEN)).toBe('/en/acme/livener/x')
    // ...and is recognised as the tenant segment when it IS the tenant.
    expect(nav('/en/livener/x', 'en', 'livener', SEVEN)).toBe('/en/livener/x')
  })

  it('passes mailto: and #anchor hrefs through verbatim', () => {
    expect(nav('mailto:hi@acme.test', 'fr', T, SEVEN)).toBe('mailto:hi@acme.test')
    expect(nav('#anchor', 'fr', T, SEVEN)).toBe('#anchor')
    expect(
      resolveNavLink({ label: 'x', linkType: 'anchor', anchorId: 'anchor' }, 'fr' as SupportedLocale, T, SEVEN).href
    ).toBe('#anchor')
  })

  it('threads supportedLocales into children', () => {
    const resolved = resolveNavLink(
      { label: 'p', href: '/fr/x', children: [{ label: 'c', href: '/pt/y' }] },
      'fr' as SupportedLocale,
      T,
      SEVEN
    )
    expect(resolved.children?.[0].href).toBe('/pt/acme/y')
  })
})

describe('resolveNavLink — two-locale project behaves exactly as today', () => {
  const T = 'livener'

  it('matches the pre-change output for every en/it/de path', () => {
    expect(nav('/live', 'en', T, TWO)).toBe('/en/livener/live')
    expect(nav('/en/live', 'en', T, TWO)).toBe('/en/livener/live')
    expect(nav('/it/live', 'it', T, TWO)).toBe('/it/livener/live')
    expect(nav('/en/livener/live', 'en', T, TWO)).toBe('/en/livener/live')
    expect(nav('/pricing#tiers', 'en', T, TWO)).toBe('/en/livener/pricing#tiers')
    expect(nav('https://example.com/x', 'en', T, TWO)).toBe('https://example.com/x')
  })

  it('does not treat an unsupported language segment as a locale', () => {
    expect(nav('/fr/x', 'en', T, TWO)).toBe('/en/livener/fr/x')
  })
})

describe('default supportedLocales — 3-argument callers', () => {
  it('accepts every platform locale without being given a list', () => {
    expect(nav('/fr/x', 'fr', 'acme')).toBe('/fr/acme/x')
    expect(nav('/en/acme/x', 'en', 'acme')).toBe('/en/acme/x')
    expect(nav('/x', 'de', 'acme')).toBe('/de/acme/x')
  })

  it('reproduces the old en/it/de behaviour for live tenants', () => {
    expect(nav('/en/live', 'en', 'livener')).toBe('/en/livener/live')
    expect(nav('/it/live', 'it', 'studiomartegani')).toBe('/it/studiomartegani/live')
    expect(nav('/live', 'it', 'studiomartegani')).toBe('/it/studiomartegani/live')
  })
})

describe('resolveNavLinks', () => {
  it('forwards supportedLocales to every link', () => {
    const out = resolveNavLinks(
      [{ label: 'a', href: '/nl/x' }, { label: 'b', href: '/y' }],
      'nl' as SupportedLocale,
      'acme',
      SEVEN
    )
    expect(out.map((l) => l.href)).toEqual(['/nl/acme/x', '/nl/acme/y'])
  })
})
