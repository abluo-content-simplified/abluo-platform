import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entryLinesFor, LLMS_NEWS_QUERY, LLMS_POSTS_QUERY } from '../llms'

// llms.txt listed pages only. Published news articles and blog posts are now
// listed too, per language, with the same visibility rules as the sitemap.

const PROJECT = {
  projectSlug: 'abluo',
  projectName: 'Abluo',
  customDomain: 'abluo.app',
  defaultLocale: 'en',
  supportedLocales: ['en', 'it'],
  siteName: 'Abluo',
}

const NEWS = [
  {
    titles: { en: 'Release 1.0', it: 'Versione 1.0' },
    slugs: { en: { current: 'release-1-0' }, it: { current: 'versione-1-0' } },
    excerpts: { en: 'What is new', it: 'Le novità' },
  },
  // English only — must not appear in the Italian block.
  { titles: { en: 'Build notes' }, slugs: { en: { current: 'build-notes' } } },
]

const POSTS = [
  {
    titles: { en: 'Why calm software' },
    slugs: { en: { current: 'why-calm-software' } },
    descriptions: { en: 'An essay' },
    excerpts: { en: 'ignored when a description exists' },
  },
]

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
      if (query.includes('_type == "project"')) return PROJECT
      if (query.includes('_type == "newsArticle"')) return NEWS
      if (query.includes('_type == "post"')) return POSTS
      if (query.includes('_type == "page"')) {
        return [{ pageType: 'home', titles: { en: 'Home', it: 'Home' } }]
      }
      return []
    },
  },
}))

beforeEach(() => {
  process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'test'
})

describe('entryLinesFor', () => {
  it('builds canonical per-locale URLs under the route prefix', () => {
    expect(entryLinesFor(NEWS, 'https://abluo.app', 'it', 'news')).toEqual([
      '- [Versione 1.0](https://abluo.app/it/news/versione-1-0): Le novità',
    ])
  })

  it('skips an entry with no slug or no title in that language', () => {
    const lines = entryLinesFor(
      [...NEWS, { titles: { it: 'Solo titolo' } }, { slugs: { it: { current: 'senza-titolo' } } }],
      'https://abluo.app',
      'it',
      'news'
    )
    expect(lines).toHaveLength(1)
  })

  it('prefers the SEO description over the excerpt', () => {
    expect(entryLinesFor(POSTS, 'https://abluo.app', 'en', 'blog')).toEqual([
      '- [Why calm software](https://abluo.app/en/blog/why-calm-software): An essay',
    ])
  })
})

describe('the llms queries', () => {
  it('list only published, unexpired, project-scoped items, newest first', () => {
    for (const q of [LLMS_NEWS_QUERY, LLMS_POSTS_QUERY]) {
      expect(q).toMatch(/projectSlug == \$projectSlug/)
      expect(q).toMatch(/defined\(publishedAt\)/)
      expect(q).toMatch(/publishedAt <= now\(\)/)
      expect(q).toMatch(/!defined\(expiresAt\) \|\| expiresAt > now\(\)/)
      expect(q).toMatch(/order\(publishedAt desc\)/)
    }
  })
})

describe('GET /llms.txt lists news and blog', () => {
  it('emits a News and Blog block per language that has entries', async () => {
    const { GET } = await import('@/app/llms.txt/route')
    const text = await (await GET()).text()
    expect(text).toContain('## News\n\n- [Release 1.0](https://abluo.app/en/news/release-1-0): What is new\n- [Build notes](https://abluo.app/en/news/build-notes)')
    expect(text).toContain('## News (it)\n\n- [Versione 1.0](https://abluo.app/it/news/versione-1-0): Le novità')
    expect(text).toContain('## Blog\n\n- [Why calm software](https://abluo.app/en/blog/why-calm-software): An essay')
    // No Italian blog post exists, so no empty Italian blog heading.
    expect(text).not.toContain('## Blog (it)')
    // Machine-readable stays last.
    expect(text.trimEnd().endsWith('- [Sitemap](https://abluo.app/sitemap.xml)')).toBe(true)
  })
})
