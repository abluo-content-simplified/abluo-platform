import { describe, it, expect } from 'vitest'
import { languageSwitchPath } from '@/lib/i18n/language-switch'

/**
 * REGRESSION — the language switcher produced /fr/it and then /nl/fr/it.
 *
 * REPRODUCED on production 2026-10-16: www.nologo.cloud/it, switch to French,
 * land on https://www.nologo.cloud/fr/it — "this page is not available". Each
 * further switch stacked another locale segment.
 *
 * Cause: `pathname` reaches this function WITH its locale prefix still on it,
 * because next-intl's usePathname() strips the prefix by comparing against
 * useLocale(), and the client provider is given no locale, so it compares
 * against the default "en". Every non-English page therefore kept its prefix,
 * and the router then added the target locale on top.
 *
 * The sub-page case never broke, because a page with a localized slug takes the
 * slugMap branch above and never looks at pathname — which is exactly why this
 * only showed up on the home page.
 */
describe('a stray locale prefix cannot stack', () => {
  const base = { slugMap: {}, tenantId: 'nologo', preservePath: true }

  it('drops the prefix on a host-scoped home page', () => {
    // The live failure: '/it' must resolve to the site root, not to '/it'.
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/it' })
    ).toBe('/')
  })

  it('drops the prefix on a host-scoped sub-page', () => {
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/it/partner' })
    ).toBe('/partner')
  })

  it('rescues a visitor already stranded on a stacked URL', () => {
    // '/nl/fr/it' is what two switches produced. Every segment is a locale and
    // none of them is a page, so the only honest destination is the site root.
    expect(
      languageSwitchPath({ ...base, targetLocale: 'de', hostScoped: true, pathname: '/nl/fr/it' })
    ).toBe('/')
  })

  it('drops the prefix on a path-routed project', () => {
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: false, pathname: '/it/nologo' })
    ).toBe('/nologo')
  })

  it('is a no-op on an already locale-less path', () => {
    // Once the provider is given its locale this is the only shape that arrives,
    // so the guard must not touch it.
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/partner' })
    ).toBe('/partner')
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/' })
    ).toBe('/')
  })

  it('leaves a non-locale two-letter segment alone', () => {
    expect(
      languageSwitchPath({ ...base, targetLocale: 'fr', hostScoped: true, pathname: '/qq/page' })
    ).toBe('/qq/page')
  })

  it('still prefers a localized slug over the path', () => {
    const slugMap = { fr: 'systeme-reservation-restaurant' }
    expect(
      languageSwitchPath({
        ...base, slugMap, targetLocale: 'fr', hostScoped: true,
        pathname: '/it/sistema-prenotazioni-ristorante',
      })
    ).toBe('/systeme-reservation-restaurant')
  })
})
