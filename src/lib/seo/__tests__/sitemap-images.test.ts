import { describe, it, expect } from 'vitest'
import { withImages } from '../sitemap-images'

describe('withImages', () => {
  it('adds nothing when a page has no gallery', () => {
    expect(withImages(null)).toEqual({})
    expect(withImages([])).toEqual({})
  })
  it('keeps absolute https URLs, each once', () => {
    expect(withImages(['https://cdn/a.jpg', 'https://cdn/a.jpg', null, 'http://x/b.jpg', '/rel.jpg'])).toEqual({
      images: ['https://cdn/a.jpg'],
    })
  })
})
