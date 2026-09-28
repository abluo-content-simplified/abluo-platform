import { describe, it, expect } from 'vitest'
import { buildArticleSchema } from '../JsonLd'

describe('buildArticleSchema', () => {
  const base = { origin: 'https://studiomartegani.com', locale: 'it', pathSegments: ['blog', 'un-post'] }

  it('emits a BlogPosting linked to the organisation and website entities', () => {
    const s = buildArticleSchema({ ...base, headline: 'Titolo', description: 'Estratto', imageUrl: 'https://cdn/x.jpg', datePublished: '2026-09-17T07:00:00.000Z' })!
    expect(s['@type']).toBe('BlogPosting')
    expect(s.url).toBe('https://studiomartegani.com/it/blog/un-post')
    expect(s.publisher).toEqual({ '@id': 'https://studiomartegani.com#organization' })
    expect(s.isPartOf).toEqual({ '@id': 'https://studiomartegani.com#website' })
    expect(s.datePublished).toBe('2026-09-17T07:00:00.000Z')
    expect(s.inLanguage).toBe('it')
  })

  it('asserts nothing that is not authored', () => {
    const s = buildArticleSchema({ ...base, headline: 'Titolo' })!
    for (const k of ['description', 'image', 'datePublished', 'author']) expect(s).not.toHaveProperty(k)
  })

  it('returns null without a headline', () => {
    expect(buildArticleSchema({ ...base, headline: null })).toBeNull()
  })
})
