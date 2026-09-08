import { describe, expect, it } from 'vitest'
import { canonicalOrigin, canonicalUrl, hreflangAlternates, seoAlternates } from '../canonical'

const LOCALES = ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt']

describe('canonicalOrigin', () => {
  it('builds an https origin from a bare domain', () => {
    expect(canonicalOrigin('nologo.cloud')).toBe('https://nologo.cloud')
  })

  it('is null when the project has no custom domain yet', () => {
    expect(canonicalOrigin(undefined)).toBeNull()
    expect(canonicalOrigin(null)).toBeNull()
    expect(canonicalOrigin('')).toBeNull()
    expect(canonicalOrigin('   ')).toBeNull()
  })

  it('tolerates a trailing slash in the stored value', () => {
    expect(canonicalOrigin('nologo.cloud/')).toBe('https://nologo.cloud')
  })
})

describe('canonicalUrl', () => {
  const origin = 'https://nologo.cloud'

  it('is the locale root for a home page', () => {
    expect(canonicalUrl(origin, 'en')).toBe('https://nologo.cloud/en')
  })

  // The regression this module exists for.
  it('never contains the project segment', () => {
    for (const locale of LOCALES) {
      expect(canonicalUrl(origin, locale)).not.toContain('/nologo/')
      expect(canonicalUrl(origin, locale, 'restaurant-booking-system')).not.toContain('/nologo/')
    }
    expect(canonicalUrl('https://livener.net', 'en')).toBe('https://livener.net/en')
  })

  it('appends page segments below the locale', () => {
    expect(canonicalUrl(origin, 'it', 'sistema-prenotazioni-ristorante'))
      .toBe('https://nologo.cloud/it/sistema-prenotazioni-ristorante')
    expect(canonicalUrl(origin, 'en', 'blog', 'a-post'))
      .toBe('https://nologo.cloud/en/blog/a-post')
  })

  it('supports a nested page slug without doubling separators', () => {
    expect(canonicalUrl(origin, 'it', 'servizi/terapia-individuale'))
      .toBe('https://nologo.cloud/it/servizi/terapia-individuale')
  })

  it('drops empty and nullish segments so callers need not branch', () => {
    expect(canonicalUrl(origin, 'en', undefined, 'blog', null, '')).toBe('https://nologo.cloud/en/blog')
  })

  it('strips stray slashes on a segment', () => {
    expect(canonicalUrl(origin, 'en', '/blog/', '/a-post')).toBe('https://nologo.cloud/en/blog/a-post')
  })

  it('is undefined without an origin, rather than a relative guess', () => {
    expect(canonicalUrl(null, 'en', 'blog')).toBeUndefined()
  })
})

describe('hreflangAlternates', () => {
  const origin = 'https://nologo.cloud'

  it('emits one entry per locale that has a page', () => {
    const langs = hreflangAlternates(origin, { en: [], it: [], de: [] }, 'en')
    expect(langs!).toEqual({
      en: 'https://nologo.cloud/en',
      it: 'https://nologo.cloud/it',
      de: 'https://nologo.cloud/de',
      'x-default': 'https://nologo.cloud/en',
    })
  })

  it('adds x-default pointing at the default locale', () => {
    const langs = hreflangAlternates(origin, Object.fromEntries(LOCALES.map((l) => [l, []])), 'en')
    expect(langs!['x-default']).toBe('https://nologo.cloud/en')
    // Seven languages plus the default.
    expect(Object.keys(langs!)).toHaveLength(8)
  })

  it('honours a non-English default locale', () => {
    const langs = hreflangAlternates('https://studiomartegani.com', { it: [], en: [] }, 'it')
    expect(langs!['x-default']).toBe('https://studiomartegani.com/it')
  })

  it('uses each locale’s own slug', () => {
    const langs = hreflangAlternates(
      origin,
      {
        en: ['restaurant-booking-system'],
        de: ['reservierungssystem-restaurant'],
        it: ['sistema-prenotazioni-ristorante'],
      },
      'en'
    )
    expect(langs!.de).toBe('https://nologo.cloud/de/reservierungssystem-restaurant')
    expect(langs!.it).toBe('https://nologo.cloud/it/sistema-prenotazioni-ristorante')
  })

  it('omits a locale with no page rather than pointing at a 404', () => {
    const langs = hreflangAlternates(origin, { en: ['investors'], de: undefined }, 'en')
    expect(langs!).not.toHaveProperty('de')
    expect(Object.keys(langs!).sort()).toEqual(['en', 'x-default'])
  })

  it('claims no x-default when the default locale itself has no page', () => {
    const langs = hreflangAlternates(origin, { it: ['investitori'] }, 'en')
    expect(langs!).not.toHaveProperty('x-default')
  })

  it('is undefined without an origin, and when nothing resolved', () => {
    expect(hreflangAlternates(null, { en: [] }, 'en')).toBeUndefined()
    expect(hreflangAlternates('https://x.test', {}, 'en')).toBeUndefined()
  })
})

describe('seoAlternates', () => {
  const canonical = 'https://nologo.cloud/en'
  const languages = { en: canonical, 'x-default': canonical }

  it('emits the canonical only in production', () => {
    expect(seoAlternates('o', canonical, languages, { isProduction: true, isDev: false }).canonical).toBe(canonical)
    expect(seoAlternates('o', canonical, languages, { isProduction: false, isDev: false }).canonical).toBeUndefined()
  })

  it('suppresses hreflang in local development', () => {
    expect(seoAlternates('o', canonical, languages, { isProduction: true, isDev: true }).languages).toBeUndefined()
  })

  it('omits an empty languages map rather than emitting an empty object', () => {
    expect(seoAlternates('o', canonical, {}, { isProduction: true, isDev: false }).languages).toBeUndefined()
    expect(seoAlternates('o', canonical, undefined, { isProduction: true, isDev: false }).languages).toBeUndefined()
  })
})
