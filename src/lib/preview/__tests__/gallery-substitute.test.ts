import { describe, expect, it } from 'vitest'
import { standaloneGallerySection, substituteGallery } from '../gallery-substitute'

const draft = { _id: 'drafts.g1', title: 'Lo studio', items: [{ _key: 'new' }] }

describe('substituteGallery', () => {
  it('swaps the gallery (single and composed) for the draft, keeping the published id', () => {
    const out = substituteGallery(
      [
        { _type: 'photoGallerySection', gallery: { _id: 'g1', items: [] } },
        { _type: 'photoGallerySection', galleries: [{ _id: 'g2' }, { _id: 'g1' }, null] },
        { _type: 'heroSection' },
      ],
      'g1',
      draft
    )
    expect(out[0].gallery).toEqual({ ...draft, _id: 'g1' })
    expect(out[1].galleries).toEqual([{ _id: 'g2' }, { ...draft, _id: 'g1' }, null])
    expect(out[2]).toEqual({ _type: 'heroSection' })
  })

  it('leaves other galleries alone; empty input → []', () => {
    expect(substituteGallery([{ gallery: { _id: 'g9' } }], 'g1', draft)[0].gallery).toEqual({ _id: 'g9' })
    expect(substituteGallery(null, 'g1', draft)).toEqual([])
  })

  it('standalone section: the default Photo Gallery layout with the draft', () => {
    const s = standaloneGallerySection(draft, 'g1')
    expect(s).toMatchObject({ _type: 'photoGallerySection', headline: 'Lo studio', layout: 'grid', columns: 3, lightbox: true })
    expect(s.gallery._id).toBe('g1')
  })
})
