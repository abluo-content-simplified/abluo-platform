import { describe, it, expect } from 'vitest'
import { toViewItem, resolveItemText } from '../view'
import type { GalleryItem } from '@/lib/sanity/types'

const base = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  _key: 'k1',
  mediaAsset: {
    _id: 'asset-1',
    mediaType: 'image',
    altText: 'Room 1 with the orange armchair',
    title: 'Room 1',
    caption: 'Where sessions happen',
    image: {
      asset: { _ref: 'image-abc123-2560x1920-jpg', _type: 'reference' },
      hotspot: { x: 0.5, y: 0.25, width: 0.3, height: 0.3 },
      dimensions: { width: 2560, height: 1920, aspectRatio: 4 / 3 },
      lqip: 'data:image/jpeg;base64,AAA',
    },
  },
  ...over,
})

describe('toViewItem', () => {
  it('carries alt text, focal point and natural shape', () => {
    const v = toViewItem(base())
    expect(v.alt).toBe('Room 1 with the orange armchair')
    expect(v.objectPosition).toBe('50% 25%')
    expect(v.aspect).toBeCloseTo(4 / 3)
    expect(v.src).toContain('w=800')
    expect(v.fullSrc).toContain('w=1600')
    expect(v.isVideo).toBe(false)
  })

  it('falls back to the name, then to an empty (decorative) alt, when a photo has no description', () => {
    const item = base()
    item.mediaAsset!.altText = undefined
    item.mediaAsset!.name = 'Room 1 armchair'
    expect(toViewItem(item).alt).toBe('Room 1 armchair')
    item.mediaAsset!.name = undefined
    expect(toViewItem(item).alt).toBe('')
  })

  it('lets a per-gallery override win over the Media Library text', () => {
    const text = resolveItemText(
      base({ titleOverrideEnabled: true, titleOverride: 'Studio', captionOverrideEnabled: true, captionOverride: 'Our studio' })
    )
    expect(text).toEqual({ title: 'Studio', caption: 'Our studio' })
  })

  it('ignores an override that is switched off', () => {
    expect(resolveItemText(base({ titleOverrideEnabled: false, titleOverride: 'X' })).title).toBe('Room 1')
  })
})
