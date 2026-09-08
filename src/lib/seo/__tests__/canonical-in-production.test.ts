import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Metadata } from 'next'

/**
 * `generateMetadata`, run with the environment stubbed to production.
 *
 * The canonical is emitted only when `isProduction()` — true for the `main`
 * deployment alone — so neither the dev nor the preview alias can show it. This
 * calls the real route functions and asserts the tag they produce.
 *
 * The assertion that matters is the negative one: the canonical must NOT
 * contain the project segment. `nologo.cloud/en`, not `nologo.cloud/en/nologo`.
 *
 * Importing a route module pulls in the whole section renderer and takes a few
 * seconds. Both routes are therefore imported ONCE in `beforeAll` with an
 * explicit timeout, and every test reuses the result — importing per test made
 * the first one exceed vitest's 5s default under full-suite parallel load,
 * which is a test that fails for a reason unrelated to what it asserts.
 */

vi.mock('@/lib/deployment', () => ({
  isProduction: () => true,
  isPreview: () => false,
  isDev: () => false,
  deployment: { env: 'production' },
}))

const SITE_CONFIG = {
  customDomain: 'nologo.cloud',
  siteName: 'No!Logo',
  supportedLocales: ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt'],
  seoDefaultTitle: 'No!Logo — White-Label Reservation Engine for Hospitality Platforms',
  seoDefaultDescription:
    'Launch your own branded table reservation system without building the technology.',
  socialLinks: [{ url: 'https://www.linkedin.com/company/nologo-reservation-platform' }],
  // A real asset id shape: the URL builder parses it and rejects anything else.
  openGraphImage: { asset: { _ref: 'image-d198f93e2836a690f5a8642bdd3a36e55a720ae3-1200x630-png' } },
}

const HOME_PAGE = { _id: 'page-nologo-home', pageType: 'home', title: 'Home' }

const RESTAURANT_PAGE = {
  _id: 'page-nologo-restaurant',
  pageType: 'landing',
  title: 'Restaurant Booking System',
  slugMap: {
    en: { current: 'restaurant-booking-system' },
    it: { current: 'sistema-prenotazioni-ristorante' },
    de: { current: 'reservierungssystem-restaurant' },
  },
  seoDescription: 'A modern booking system for restaurants.',
}

vi.mock('@/lib/sanity/client', async () => ({
  tenantClient: () => ({
    fetchForTenant: async (query: string) => {
      if (query.includes('defaultLocale') && query.includes('supportedLocales') && query.length < 300) {
        return { defaultLocale: 'en', supportedLocales: SITE_CONFIG.supportedLocales }
      }
      if (query.includes('_type == "siteConfig"')) return SITE_CONFIG
      if (query.includes('pageType == "home"')) return HOME_PAGE
      if (query.includes('slug[$locale].current == $slug')) return RESTAURANT_PAGE
      return null
    },
  }),
  fetchDesignSystemById: async () => null,
  sanityClient: { fetch: async () => [] },
}))

const PROJECT_SEGMENT = /\/(?:en|it|de|fr|es|nl|pt)\/nologo(?:\/|$)/

type MetadataFn = (args: { params: Promise<Record<string, unknown>> }) => Promise<Metadata>

let homeMetadata: MetadataFn
let slugMetadata: MetadataFn

beforeAll(async () => {
  homeMetadata = (await import('@/app/[locale]/(website)/[tenant]/page')).generateMetadata as MetadataFn
  slugMetadata = (await import('@/app/[locale]/(website)/[tenant]/[...slug]/page')).generateMetadata as MetadataFn
}, 60_000)

const homeMeta = () => homeMetadata({ params: Promise.resolve({ tenant: 'nologo', locale: 'en' }) })

describe('the home page canonical', () => {
  it('is the locale root, with no project segment', async () => {
    const meta = await homeMeta()

    expect(meta.alternates?.canonical).toBe('https://nologo.cloud/en')
    expect(String(meta.alternates?.canonical)).not.toMatch(PROJECT_SEGMENT)
  })

  it('declares all seven languages plus x-default', async () => {
    const meta = await homeMeta()
    const languages = meta.alternates?.languages as Record<string, string>

    expect(Object.keys(languages).sort()).toEqual(
      ['de', 'en', 'es', 'fr', 'it', 'nl', 'pt', 'x-default'].sort()
    )
    expect(languages['x-default']).toBe('https://nologo.cloud/en')
    expect(languages.it).toBe('https://nologo.cloud/it')
    for (const url of Object.values(languages)) expect(url).not.toMatch(PROJECT_SEGMENT)
  })

  it('carries a description and an og:url that agree with the canonical', async () => {
    const meta = await homeMeta()

    expect(meta.description).toBe(SITE_CONFIG.seoDefaultDescription)
    expect(meta.openGraph?.url).toBe(meta.alternates?.canonical)
  })
})

describe('a landing page canonical', () => {
  const params = (locale: string) =>
    Promise.resolve({ tenant: 'nologo', locale, slug: [locale === 'it' ? 'sistema-prenotazioni-ristorante' : 'restaurant-booking-system'] })

  it('puts the slug directly below the locale', async () => {
    const meta = await slugMetadata({ params: params('en') })

    expect(meta.alternates?.canonical).toBe('https://nologo.cloud/en/restaurant-booking-system')
    expect(String(meta.alternates?.canonical)).not.toMatch(PROJECT_SEGMENT)
  })

  // The gap that made this page unmarketable: the slug route emitted a title
  // and no description at all, in any language.
  it('emits a description — the whole point of the page-level SEO fields', async () => {
    const meta = await slugMetadata({ params: params('en') })

    expect(meta.description).toBe('A modern booking system for restaurants.')
    expect(meta.openGraph?.description).toBe('A modern booking system for restaurants.')
  })

  // Next replaces the parent's openGraph object wholesale rather than merging
  // `images` into it, so a child that declares openGraph without images erases
  // the tenant-wide og:image from the layout. The home page kept its image and
  // every other page silently lost one.
  it('falls back to the site Open Graph image instead of erasing it', async () => {
    const meta = await slugMetadata({ params: params('en') })
    const images = meta.openGraph?.images as { url: string }[] | undefined
    expect(images, 'the slug route must re-emit the site OG image').toBeDefined()
    // The CDN URL drops the `image-` prefix and joins the extension with a dot,
    // so match on the asset hash rather than the _ref spelling.
    expect(images![0].url).toContain('d198f93e2836a690f5a8642bdd3a36e55a720ae3-1200x630')
    expect(images![0].url).toMatch(/^https:\/\/cdn\.sanity\.io\//)
  })

  it('uses each language’s own slug in hreflang, and omits the languages that have none', async () => {
    const meta = await slugMetadata({ params: params('en') })
    const languages = meta.alternates?.languages as Record<string, string>

    expect(languages.it).toBe('https://nologo.cloud/it/sistema-prenotazioni-ristorante')
    expect(languages.de).toBe('https://nologo.cloud/de/reservierungssystem-restaurant')
    // Only three locales have a slug in the fixture; the other four are absent
    // rather than pointing at a page that does not exist.
    expect(Object.keys(languages).sort()).toEqual(['de', 'en', 'it', 'x-default'])
  })
})
