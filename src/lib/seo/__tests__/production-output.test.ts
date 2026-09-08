import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The three fixes that NO staging deployment can show you.
 *
 * `canonical`, the sitemap and `/llms.txt` are all gated on `isProduction()`,
 * which is true only for the Vercel *production* deployment — i.e. `main`.
 * Both `dev` and `preview` build as Vercel preview environments, so on both of
 * them the canonical is undefined, the sitemap is empty and llms.txt 404s.
 *
 * That gating is correct and deliberate: a canonical served from
 * `dev.abluo.app` would point at a client's live domain and invite Google to
 * treat staging as a copy of it. But it means a smoke test on dev or preview
 * cannot observe the very output these changes alter — the first place it
 * becomes visible is production.
 *
 * So the environment is stubbed to production here and the output asserted
 * directly. This is the only check on those three that runs before `main`.
 */

const HOST = 'nologo.cloud'

// ── Fixtures: the five projects that exist, as the sitemap query returns them ──
const PROJECTS = [
  { projectSlug: 'nologo', customDomain: 'nologo.cloud', supportedLocales: ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt'], defaultLocale: 'en' },
  { projectSlug: 'livener', customDomain: 'livener.net', supportedLocales: ['en', 'it', 'de'], defaultLocale: 'en' },
  { projectSlug: 'studiomartegani', customDomain: 'studiomartegani.com', supportedLocales: ['it', 'en'], defaultLocale: 'it' },
  { projectSlug: 'hoffmann', customDomain: 'ch-psicoterapeuta.com', supportedLocales: ['en'], defaultLocale: 'en' },
  { projectSlug: 'abluo', customDomain: 'abluo.app', supportedLocales: ['en'], defaultLocale: 'en' },
]

const PAGES = [
  { projectSlug: 'nologo', slug: { en: { current: 'restaurant-booking-system' }, it: { current: 'sistema-prenotazioni-ristorante' } } },
  { projectSlug: 'livener', slug: { en: { current: 'investors' } } },
  { projectSlug: 'studiomartegani', slug: { it: { current: 'la-nostra-storia' } } },
]

let requestHost = HOST

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k.toLowerCase() === 'host' ? requestHost : null) }),
}))

vi.mock('@/lib/deployment', () => ({
  isProduction: () => true,
  isPreview: () => false,
  isDev: () => false,
  deployment: { env: 'production' },
}))

vi.mock('@/lib/sanity/client', () => ({
  sanityClient: {
    fetch: async (query: string) => {
      if (query.includes('_type == "project"')) return PROJECTS
      if (query.includes('_type == "page"')) return PAGES
      return []
    },
  },
}))

beforeEach(() => {
  requestHost = HOST
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'test'
})

describe('sitemap, in production', () => {
  async function sitemapFor(host: string) {
    requestHost = host
    const mod = await import('@/app/sitemap')
    return mod.default()
  }

  const domainsIn = (entries: { url: string }[]) =>
    [...new Set(entries.map((e) => new URL(e.url).host))].sort()

  it('contains exactly one domain — the one it was asked on', async () => {
    expect(domainsIn(await sitemapFor('nologo.cloud'))).toEqual(['nologo.cloud'])
    expect(domainsIn(await sitemapFor('livener.net'))).toEqual(['livener.net'])
    expect(domainsIn(await sitemapFor('studiomartegani.com'))).toEqual(['studiomartegani.com'])
  })

  // The leak, stated as the test that would have caught it: before the fix
  // every one of these returned all five domains.
  it('never discloses another client', async () => {
    const others = ['livener.net', 'studiomartegani.com', 'ch-psicoterapeuta.com', 'abluo.app']
    const entries = await sitemapFor('nologo.cloud')
    for (const entry of entries) {
      for (const other of others) expect(entry.url).not.toContain(other)
    }
  })

  it('emits no project segment in any URL', async () => {
    for (const host of ['nologo.cloud', 'livener.net', 'studiomartegani.com']) {
      for (const entry of await sitemapFor(host)) {
        const path = new URL(entry.url).pathname
        expect(path, entry.url).not.toMatch(/^\/[a-z]{2}\/(nologo|livener|studiomartegani|hoffmann|abluo)(\/|$)/)
      }
    }
  })

  it('gives the No!Logo home page one URL per locale, at the locale root', async () => {
    const urls = (await sitemapFor('nologo.cloud')).map((e) => e.url)
    for (const locale of ['en', 'it', 'de', 'fr', 'es', 'nl', 'pt']) {
      expect(urls).toContain(`https://nologo.cloud/${locale}`)
    }
  })

  it('places a page slug directly below the locale', async () => {
    const urls = (await sitemapFor('nologo.cloud')).map((e) => e.url)
    expect(urls).toContain('https://nologo.cloud/en/restaurant-booking-system')
    expect(urls).toContain('https://nologo.cloud/it/sistema-prenotazioni-ristorante')
  })

  it('returns nothing for a host no project claims, rather than everything', async () => {
    expect(await sitemapFor('some-parked-domain.com')).toEqual([])
    expect(await sitemapFor('abluo-platform-abluo.vercel.app')).toEqual([])
  })
})

describe('llms.txt, in production', () => {
  async function llmsFor(host: string) {
    requestHost = host
    vi.resetModules()
    const mod = await import('@/app/llms.txt/route')
    return mod.GET()
  }

  it('404s on a host no project claims', async () => {
    const res = await llmsFor('some-parked-domain.com')
    expect(res.status).toBe(404)
  })

  it('404s on a staging host even in a production build', async () => {
    // Belt and braces: the environment check and the host check are separate,
    // and an alias pointed at the production deployment would pass the first.
    for (const host of ['dev.abluo.app', 'preview.abluo.app', 'nologo.preview.abluo.app']) {
      expect((await llmsFor(host)).status).toBe(404)
    }
  })
})
