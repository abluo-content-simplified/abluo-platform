import { describe, it, expect } from 'vitest'
import { buildImageGallerySchema, structuredImageUrl } from '../jsonld'
import type { GalleryViewItem } from '../view'

const photo = (over: Partial<GalleryViewItem> = {}): GalleryViewItem => ({
  key: 'k',
  assetId: 'a',
  isVideo: false,
  alt: 'The studio',
  objectPosition: '50% 50%',
  aspect: 1.5,
  url: 'https://cdn.sanity.io/images/p/d/x-10x10.avif',
  width: 2560,
  height: 1920,
  ...over,
})

describe('buildImageGallerySchema', () => {
  it('emits one ImageObject per photo as a JPEG rendition', () => {
    const s = buildImageGallerySchema({ name: 'Studio', locale: 'it', items: [photo({ caption: 'Room 1' })] })
    expect(s?.['@type']).toBe('ImageGallery')
    const img = (s?.image as Record<string, unknown>[])[0]
    expect(img.contentUrl).toContain('fm=jpg')
    expect(img.caption).toBe('Room 1')
    expect(img.description).toBe('The studio')
  })
  it('skips videos and photos without a URL, and emits nothing when none remain', () => {
    expect(buildImageGallerySchema({ locale: 'en', items: [photo({ isVideo: true }), photo({ url: null })] })).toBeNull()
  })
  it('asserts no caption or name that was not authored', () => {
    const s = buildImageGallerySchema({ locale: 'en', items: [photo({ alt: '' })] })
    expect(s).not.toHaveProperty('name')
    const img = (s?.image as Record<string, unknown>[])[0]
    expect(img).not.toHaveProperty('caption')
    expect(img).not.toHaveProperty('description')
  })
  it('appends to an existing query string', () => {
    expect(structuredImageUrl('https://x/y.jpg?a=1')).toBe('https://x/y.jpg?a=1&w=1600&fm=jpg&q=85')
    expect(structuredImageUrl(null)).toBeNull()
  })
})
