import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildArticleSchema } from '../JsonLd'

// News articles reuse the blog's Article JSON-LD builder. These pin the two
// differences (type, organisation as author) and that nothing unauthored is
// asserted, plus a structural check that the news route still emits it.

const base = { origin: 'https://abluo.app', locale: 'de', pathSegments: ['news', 'release-1-0'] }

describe('buildArticleSchema for news articles', () => {
  it('emits an Article at the canonical news URL, in the request language', () => {
    const s = buildArticleSchema({
      ...base,
      schemaType: 'Article',
      headline: 'Version 1.0',
      description: 'Was neu ist',
      imageUrl: 'https://cdn.sanity.io/x.jpg',
      datePublished: '2026-09-30T08:00:00Z',
      dateModified: '2026-10-01T09:00:00Z',
      authorIsPublisher: true,
    })!
    expect(s['@type']).toBe('Article')
    expect(s.url).toBe('https://abluo.app/de/news/release-1-0')
    expect(s.mainEntityOfPage).toBe('https://abluo.app/de/news/release-1-0')
    expect(s.inLanguage).toBe('de')
    expect(s.headline).toBe('Version 1.0')
    expect(s.description).toBe('Was neu ist')
    expect(s.image).toBe('https://cdn.sanity.io/x.jpg')
    expect(s.datePublished).toBe('2026-09-30T08:00:00Z')
    expect(s.dateModified).toBe('2026-10-01T09:00:00Z')
    expect(s.author).toEqual({ '@id': 'https://abluo.app#organization' })
    expect(s.publisher).toEqual({ '@id': 'https://abluo.app#organization' })
  })

  it('asserts nothing unauthored', () => {
    const s = buildArticleSchema({ ...base, schemaType: 'Article', headline: 'Version 1.0' })!
    for (const k of ['description', 'image', 'datePublished', 'dateModified', 'author']) {
      expect(s).not.toHaveProperty(k)
    }
  })

  it('does not claim a modification date for an unpublished item', () => {
    const s = buildArticleSchema({ ...base, headline: 'x', dateModified: '2026-10-01T09:00:00Z' })!
    expect(s).not.toHaveProperty('dateModified')
  })

  it('names no organisation author when the origin is unknown', () => {
    const s = buildArticleSchema({ ...base, origin: null, headline: 'x', authorIsPublisher: true })!
    expect(s).not.toHaveProperty('author')
    expect(s).not.toHaveProperty('publisher')
  })

  it('prefers an authored person over the organisation', () => {
    const s = buildArticleSchema({ ...base, headline: 'x', authorName: 'Tom', authorIsPublisher: true })!
    expect(s.author).toEqual({ '@type': 'Person', name: 'Tom' })
  })

  it('keeps BlogPosting as the default for blog posts', () => {
    expect(buildArticleSchema({ ...base, headline: 'x' })!['@type']).toBe('BlogPosting')
  })
})

describe('the news article route emits the Article JSON-LD', () => {
  const ROOT = join(__dirname, '..', '..', '..')
  const src = readFileSync(join(ROOT, 'src/app/[locale]/(website)/[tenant]/news/[slug]/page.tsx'), 'utf8')

  it('renders ArticleJsonLd with the news path and Article type', () => {
    expect(src).toMatch(/<ArticleJsonLd/)
    expect(src).toMatch(/schemaType="Article"/)
    expect(src).toMatch(/pathSegments=\{\['news',/)
  })

  it('reads the canonical origin from the project domain', () => {
    expect(src).toMatch(/origin=\{canonicalOrigin\(customDomain\)\}/)
  })
})
