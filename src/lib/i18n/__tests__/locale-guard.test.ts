import { describe, it, expect } from 'vitest'
import { isLocaleEnabledForProject } from '../locale-guard'
import { LOCALE_CODES } from '../locales'
import type { SupportedLocale } from '../locales'

/**
 * Bug L-2 — a tenant served every PLATFORM locale, not just the locales its own
 * project enabled. https://studiomartegani.com/de returned 200 (German chrome,
 * Italian content) although that project's supportedLocales are [it, en].
 *
 * These are the production supportedLocales as queried from Sanity, so the
 * allow/deny matrix below is the exact set of URLs whose behaviour changes.
 */
const PROD = {
  'livener-main':        { defaultLocale: 'en', supportedLocales: ['en', 'it'] },
  'studiomartegani-main': { defaultLocale: 'it', supportedLocales: ['it', 'en'] },
  'abluo':               { defaultLocale: 'en', supportedLocales: ['en', 'it', 'de'] },
  'nologo':              { defaultLocale: 'en', supportedLocales: ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt'] },
} as const satisfies Record<string, { defaultLocale: SupportedLocale; supportedLocales: SupportedLocale[] }>

describe('isLocaleEnabledForProject — allow', () => {
  it('allows every locale a project actually enables', () => {
    for (const cfg of Object.values(PROD)) {
      for (const locale of cfg.supportedLocales) {
        expect(isLocaleEnabledForProject(locale, cfg)).toBe(true)
      }
    }
  })

  it('allows all seven locales for the seven-locale project', () => {
    for (const locale of LOCALE_CODES) {
      expect(isLocaleEnabledForProject(locale, PROD.nologo)).toBe(true)
    }
  })
})

describe('isLocaleEnabledForProject — deny', () => {
  it('denies the locales that are live-but-bogus today', () => {
    // The regression that shipped: /de on Martegani.
    expect(isLocaleEnabledForProject('de', PROD['studiomartegani-main'])).toBe(false)
    for (const locale of ['de', 'fr', 'es', 'pt', 'nl']) {
      expect(isLocaleEnabledForProject(locale, PROD['livener-main'])).toBe(false)
      expect(isLocaleEnabledForProject(locale, PROD['studiomartegani-main'])).toBe(false)
    }
    for (const locale of ['fr', 'es', 'pt', 'nl']) {
      expect(isLocaleEnabledForProject(locale, PROD.abluo)).toBe(false)
    }
  })

  it('denies a locale outside the platform registry too', () => {
    expect(isLocaleEnabledForProject('zz', PROD.abluo)).toBe(false)
  })
})

describe('isLocaleEnabledForProject — missing or partial config', () => {
  it('fails OPEN when there is no siteConfig document at all', () => {
    // A new/unlaunched project, or a degraded Sanity read, must not 404 its
    // whole site. The platform guard still caps the segment to the registry.
    for (const locale of LOCALE_CODES) {
      expect(isLocaleEnabledForProject(locale, null)).toBe(true)
      expect(isLocaleEnabledForProject(locale, undefined)).toBe(true)
    }
  })

  it('falls back to defaultLocale when the document exists but lists no locales', () => {
    expect(isLocaleEnabledForProject('it', { defaultLocale: 'it' })).toBe(true)
    expect(isLocaleEnabledForProject('en', { defaultLocale: 'it' })).toBe(false)
    expect(isLocaleEnabledForProject('it', { defaultLocale: 'it', supportedLocales: [] })).toBe(true)
    expect(isLocaleEnabledForProject('de', { defaultLocale: 'it', supportedLocales: [] })).toBe(false)
  })

  it("falls back to 'en' when neither field is set", () => {
    expect(isLocaleEnabledForProject('en', {})).toBe(true)
    expect(isLocaleEnabledForProject('it', {})).toBe(false)
  })

  it('always allows defaultLocale even if it is missing from supportedLocales', () => {
    // Inconsistent config must never 404 the locale the site redirects to.
    expect(isLocaleEnabledForProject('en', { defaultLocale: 'en', supportedLocales: ['it'] })).toBe(true)
  })

  it('tolerates a non-array supportedLocales without throwing', () => {
    const bad = { defaultLocale: 'it', supportedLocales: 'it,en' } as unknown as {
      defaultLocale: SupportedLocale
      supportedLocales: SupportedLocale[]
    }
    expect(isLocaleEnabledForProject('it', bad)).toBe(true)
    expect(isLocaleEnabledForProject('de', bad)).toBe(false)
  })
})
