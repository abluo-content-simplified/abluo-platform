import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildCollectionSchema } from '@/components/JsonLd'
import { newsIndexSitemapEntries, HAS_NEWS_INDEX_PROJECTION } from '../sitemap-news'
import { ogLocale } from '../og-locale'
import type { NewsListingSection as NewsListingSectionType } from '@/lib/sanity/types'

vi.mock('@/lib/tenancy/link-scope.server', () => ({ isHostScopedRequest: async () => true }))
import { NewsListingSection } from '@/components/sections/NewsListingSection'

describe('news index — CollectionPage JSON-LD', () => {
  it('lists the shown articles in order at their canonical URLs', () => {
    const schema = buildCollectionSchema({
      origin: 'https://abluo.app',
      locale: 'it',
      pathSegments: ['news'],
      name: 'Journal',
      items: [
        { pathSegments: ['news', 'primo'], name: 'Primo' },
        { pathSegments: ['news', 'secondo'], name: 'Secondo' },
      ],
    })
    expect(schema).toMatchObject({
      '@type': 'CollectionPage',
      url: 'https://abluo.app/it/news',
      inLanguage: 'it',
      isPartOf: { '@id': 'https://abluo.app#website' },
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, url: 'https://abluo.app/it/news/primo', name: 'Primo' },
          { '@type': 'ListItem', position: 2, url: 'https://abluo.app/it/news/secondo', name: 'Secondo' },
        ],
      },
    })
  })

  it('emits nothing without a canonical origin', () => {
    expect(buildCollectionSchema({ origin: null, locale: 'en', pathSegments: ['news'], items: [] })).toBeNull()
  })
})

describe('news index — sitemap', () => {
  it('one /{locale}/news per site language when the site has a news index', () => {
    const entries = newsIndexSitemapEntries({ hasNewsIndex: true, origin: 'https://abluo.app', locales: ['en', 'it', 'de'], primaryLocale: 'en' })
    expect(entries.map((e) => e.url)).toEqual(['https://abluo.app/en/news', 'https://abluo.app/it/news', 'https://abluo.app/de/news'])
  })

  it('none without the module or a newsPage', () => {
    expect(newsIndexSitemapEntries({ hasNewsIndex: false, origin: 'https://x.y', locales: ['en'], primaryLocale: 'en' })).toEqual([])
    expect(newsIndexSitemapEntries({ hasNewsIndex: undefined, origin: 'https://x.y', locales: ['en'], primaryLocale: 'en' })).toEqual([])
  })

  it('the projection requires an enabled news installation and a published newsPage', () => {
    expect(HAS_NEWS_INDEX_PROJECTION).toContain('moduleId == "news" && enabled != false')
    expect(HAS_NEWS_INDEX_PROJECTION).toContain('_type == "newsPage" && projectSlug == ^.projectSlug')
    expect(HAS_NEWS_INDEX_PROJECTION).toContain('!(_id in path("drafts.**"))')
  })
})

describe('og:locale', () => {
  it('maps URL locales to language_TERRITORY', () => {
    expect(ogLocale('it')).toBe('it_IT')
    expect(ogLocale('de')).toBe('de_DE')
    expect(ogLocale('xx')).toBe('xx')
  })
})

describe('NewsListingSection — heading levels and links', () => {
  const article = (id: string) => ({ _id: id, title: `Title ${id}`, slug: { current: `slug-${id}` } })
  const section = (title?: string) =>
    ({ _type: 'newsListingSection', _key: 'n', title, layout: 'grid', articles: [article('a'), article('b')] }) as unknown as NewsListingSectionType

  const render = async (s: NewsListingSectionType) =>
    renderToStaticMarkup(await NewsListingSection({ section: s, surface: 'transparent' as never, designSystem: null, locale: 'it', tenantId: 'abluo', fromParam: 'news' }))

  it('cards are h2 when the section has no title (h1 → h2, no skip)', async () => {
    const html = await render(section())
    expect(html.match(/<h2/g)).toHaveLength(2)
    expect(html).not.toContain('<h3')
  })

  it('cards are h3 under a section title', async () => {
    const html = await render(section('Journal'))
    expect(html.match(/<h2/g)).toHaveLength(1)
    expect(html.match(/<h3/g)).toHaveLength(2)
  })

  it('card hrefs are canonical: no project segment on the own host, no ?from=', async () => {
    const html = await render(section())
    expect(html).toContain('href="/it/news/slug-a"')
    expect(html).not.toContain('?from=')
    expect(html).not.toContain('/it/abluo/')
  })
})
