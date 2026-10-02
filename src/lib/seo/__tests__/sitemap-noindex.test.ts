import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A page marked `noindex` must not be advertised in the sitemap.
 *
 * The page itself emits `robots: noindex`; listing it in the sitemap told
 * search engines the opposite. The filter lives in GROQ, so the mocked client
 * below honours it the way Sanity would: it drops `noindex: true` pages only
 * when the query actually asks for that. Remove the clause and the staging
 * page reappears in the output, failing this test.
 */

const PROJECTS = [
  { projectSlug: 'abluo', customDomain: 'abluo.app', supportedLocales: ['en', 'it'], defaultLocale: 'en' },
]

const PAGES = [
  { projectSlug: 'abluo', slug: { en: { current: 'pricing' }, it: { current: 'prezzi' } } },
  { projectSlug: 'abluo', slug: { en: { current: 'staging-home' }, it: { current: 'staging-home' } }, noindex: true },
  { projectSlug: 'abluo', slug: { en: { current: 'about' } }, noindex: false },
]

const NOINDEX_CLAUSE = '!(noindex == true)'

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k.toLowerCase() === 'host' ? 'abluo.app' : null) }),
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
      if (query.includes('_type == "page"') && query.includes('pageType == "home"')) return []
      if (query.includes('_type == "page"')) {
        return query.includes(NOINDEX_CLAUSE) ? PAGES.filter((p) => p.noindex !== true) : PAGES
      }
      return []
    },
  },
}))

beforeEach(() => {
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'test'
})

describe('sitemap skips noindex pages', () => {
  it('omits every locale URL of a noindex page', async () => {
    const urls = (await (await import('@/app/sitemap')).default()).map((e) => e.url)
    expect(urls).not.toContain('https://abluo.app/en/staging-home')
    expect(urls).not.toContain('https://abluo.app/it/staging-home')
  })

  it('keeps pages that are indexable, including an explicit noindex: false', async () => {
    const urls = (await (await import('@/app/sitemap')).default()).map((e) => e.url)
    expect(urls).toContain('https://abluo.app/en/pricing')
    expect(urls).toContain('https://abluo.app/it/prezzi')
    expect(urls).toContain('https://abluo.app/en/about')
  })
})
