/**
 * PostArticle is the ONE article renderer behind both the live post page and
 * the private draft preview. Server-render it with a full post and check that
 * every part the live page shows is there.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }))

import { PostArticle } from '@/components/blog/PostArticle'
import type { Post } from '@/lib/sanity/types'

const post = {
  _id: 'p1',
  title: 'Il silenzio che cura',
  excerpt: 'Una breve introduzione.',
  publishedAt: '2026-10-01T09:00:00Z',
  readingTimeMinutes: 4,
  categories: [{ key: 'cura', title: 'Cura', color: null }],
  coverImage: {
    asset: { _ref: 'image-abc-1600x900-jpg', _type: 'reference' },
    hotspot: { x: 0.25, y: 0.7, width: 0.3, height: 0.3 },
    alt: 'Una stanza luminosa',
    caption: 'Lo studio',
  },
  body: [{ _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's1', text: 'Testo del corpo.', marks: [] }] }],
  author: { name: 'Claudia', role: 'Psicoterapeuta' },
} as unknown as Post

const related = [
  { _id: 'r1', title: 'Un altro articolo', slug: { current: 'altro' }, excerpt: 'x', categories: [] },
] as unknown as Post[]

const html = renderToStaticMarkup(
  <PostArticle
    post={post}
    relatedPosts={related}
    designSystem={null}
    locale="it"
    siteBase="/it/hoffmann"
    backLabel="Back to Home"
    backUrl="/it/hoffmann"
    showGallery
  />
)

describe('PostArticle', () => {
  it('renders the title, categories, author line, excerpt and body', () => {
    expect(html).toContain('Il silenzio che cura</h1>')
    expect(html).toContain('Cura')
    expect(html).toContain('Claudia')
    expect(html).toContain('4 min read')
    expect(html).toContain('Una breve introduzione.')
    expect(html).toContain('Testo del corpo.')
  })

  it('renders the cover cropped around its focal point, with alt and caption', () => {
    expect(html).toMatch(/<img[^>]+alt="Una stanza luminosa"[^>]+object-position:25% 70%/)
    expect(html).toContain('Lo studio</figcaption>')
  })

  it('renders related posts and the bottom navigation with the site links', () => {
    expect(html).toContain('Related Articles')
    expect(html).toContain('href="/it/hoffmann/blog/altro"')
    expect(html).toContain('href="/it/hoffmann/blog"')
  })
})
