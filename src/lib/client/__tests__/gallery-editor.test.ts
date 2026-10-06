import { describe, expect, it } from 'vitest'
import {
  appendPhotos,
  applyPhotoSaved,
  itemsPatch,
  photosMissingAlt,
  refreshPhotoFacts,
  usagePages,
  usagePlaces,
  usagePosts,
} from '../gallery-editor'
import type { GalleryPhoto } from '@/lib/api/gallery-drafts'

const photo = (o: Partial<GalleryPhoto> = {}): GalleryPhoto => ({
  key: 'k1',
  assetId: 'a1',
  rev: 'r1',
  url: 'https://cdn/a1.jpg',
  thumbUrl: null,
  name: '',
  alt: { it: 'Sala' },
  title: {},
  caption: {},
  tags: [],
  focal: null,
  titleOverride: null,
  captionOverride: null,
  missing: false,
  ...o,
})

describe('usage', () => {
  const used = [
    { kind: 'post' as const, id: 'p1', title: 'Ansia' },
    { kind: 'page' as const, id: 'pg1', title: 'Home' },
    { kind: 'page' as const, id: 'pg2', title: 'Il nostro studio' },
  ]
  it('pages first, then posts', () => {
    expect(usagePlaces(used)).toBe('Home, Il nostro studio, Ansia')
    expect(usagePlaces([])).toBe('')
    expect(usagePages(used).map((u) => u.id)).toEqual(['pg1', 'pg2'])
    expect(usagePosts(used).map((u) => u.id)).toEqual(['p1'])
  })
})

describe('items', () => {
  it('itemsPatch: order kept, key and photo only (no per-gallery overrides)', () => {
    expect(itemsPatch([photo({ titleOverride: { it: 'Vecchio' } }), photo({ key: 'k2', assetId: 'a2', captionOverride: { it: 'Qui' } })])).toEqual([
      { key: 'k1', assetId: 'a1' },
      { key: 'k2', assetId: 'a2' },
    ])
  })
  it('appendPhotos: new unique keys, appended in order', () => {
    let n = 0
    const out = appendPhotos([photo()], [
      { assetId: 'a2', url: 'u2', thumbUrl: null, alt: {}, focal: null },
      { assetId: 'a3', url: 'u3', thumbUrl: null, alt: {}, focal: { x: 0.5, y: 0.5 } },
    ], () => ((n += 0.37) % 1))
    expect(out.map((i) => i.assetId)).toEqual(['a1', 'a2', 'a3'])
    expect(new Set(out.map((i) => i.key)).size).toBe(3)
    expect(out[2]).toMatchObject({ rev: '', focal: { x: 0.5, y: 0.5 }, titleOverride: null })
  })
  it('photosMissingAlt counts photos without a main-language description (missing assets ignored)', () => {
    expect(photosMissingAlt([photo(), photo({ alt: { de: 'x' } }), photo({ alt: {}, missing: true })], 'it')).toBe(1)
  })
  it('applyPhotoSaved updates every item showing the asset', () => {
    const out = applyPhotoSaved([photo(), photo({ key: 'k2' }), photo({ key: 'k3', assetId: 'a9' })], { assetId: 'a1', rev: 'r2', alt: { it: 'Nuova' } })
    expect(out.map((i) => i.rev)).toEqual(['r2', 'r2', 'r1'])
  })
  it('refreshPhotoFacts keeps order and overrides, adopts server facts', () => {
    const local = [photo({ rev: '', titleOverride: { it: 'Mio' } })]
    const out = refreshPhotoFacts(local, [photo({ rev: 'r5', alt: { it: 'Server' }, titleOverride: null })])
    expect(out[0]).toMatchObject({ rev: 'r5', alt: { it: 'Server' }, titleOverride: { it: 'Mio' } })
  })
})
