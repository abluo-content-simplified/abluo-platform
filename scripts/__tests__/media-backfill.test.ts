/**
 * The Media Library backfill planner (scripts/lib/media-backfill.mjs): which
 * image assets content uses directly, which already have a `mediaAsset` in the
 * SAME project, and the exact document planned for the rest. No network.
 */
import { describe, expect, it } from 'vitest'
import {
  BACKFILL_MARKER,
  backfillDocId,
  backfillMutations,
  collectImageRefs,
  photoNameFromFile as portedPhotoName,
  planMediaBackfill,
} from '../lib/media-backfill.mjs'
import { photoNameFromFile } from '@/lib/media/photo-name'

const IMG_A = 'image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-2560x1707-jpg'
const IMG_B = 'image-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-800x600-png'
const IMG_C = 'image-cccccccccccccccccccccccccccccccccccccccc-100x100-webp'

const img = (ref: string, extra: Record<string, unknown> = {}) => ({ _type: 'image', asset: { _type: 'reference', _ref: ref }, ...extra })

const homePage = {
  _id: 'home-livener',
  _type: 'homePage',
  projectSlug: 'livener',
  title: { en: 'Home' },
  sections: [
    {
      _key: 'hero',
      _type: 'heroSection',
      image: img(IMG_A, { hotspot: { x: 0.3, y: 0.4, width: 1, height: 1 }, crop: { top: 0, bottom: 0, left: 0, right: 0 }, alt: { _type: 'localizedString', en: 'Team at work', it: '' } }),
    },
    { _key: 'body', _type: 'textSection', body: [{ _key: 'b1', _type: 'image', asset: { _ref: IMG_B } }] },
  ],
}
const draftPost = {
  _id: 'drafts.post-1',
  _type: 'post',
  projectSlug: 'livener',
  title: { it: 'Un articolo' },
  coverImage: img(IMG_A, { alt: { it: 'Il team al lavoro' }, hotspot: { x: 0.9, y: 0.9 } }),
}
const siteConfig = { _id: 'site-livener', _type: 'siteConfig', projectSlug: 'livener', logo: img(IMG_C), altText: 'Livener logo' }
const gallery = { _id: 'g1', _type: 'gallery', projectSlug: 'livener', items: [{ _key: 'i1', photo: { _type: 'reference', _ref: 'media-1' } }] }
const otherProject = { _id: 'home-other', _type: 'homePage', projectSlug: 'studiomartegani', hero: img('image-dddddddddddddddddddddddddddddddddddddddd-10x10-jpg') }

describe('collectImageRefs', () => {
  it('finds every image field pointing at an image asset, with path, hotspot and alt', () => {
    const hits = collectImageRefs(homePage, 'en')
    expect(hits).toEqual([
      {
        assetId: IMG_A,
        path: 'sections[_key=="hero"].image',
        hotspot: { x: 0.3, y: 0.4, width: 1, height: 1 },
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
        alt: { en: 'Team at work' },
      },
      { assetId: IMG_B, path: 'sections[_key=="body"].body[_key=="b1"]', alt: {} },
    ])
  })

  it('ignores references to documents (mediaAsset, galleries) and file assets', () => {
    expect(collectImageRefs(gallery)).toEqual([])
    expect(collectImageRefs({ _id: 'x', f: { asset: { _ref: 'file-abc-pdf' } } })).toEqual([])
  })

  it('reads a legacy plain-string alt beside the image into the default language', () => {
    expect(collectImageRefs(siteConfig, 'it')).toEqual([{ assetId: IMG_C, path: 'logo', alt: { it: 'Livener logo' } }])
  })
})

describe('planMediaBackfill', () => {
  const base = {
    projectSlug: 'livener',
    documents: [homePage, draftPost, siteConfig, gallery, otherProject],
    projects: [{ _id: 'sanity-project-livener', clientId: 'client-livener' }],
    imageAssets: { [IMG_A]: { originalFilename: 'team_at-work.jpg' }, [IMG_B]: { originalFilename: 'IMG_1234.png' } },
    defaultLocale: 'en',
  }

  it('plans one mediaAsset per directly-used asset, with the upload field set', () => {
    const plan = planMediaBackfill(base)
    expect(plan.blocked).toBeNull()
    expect(plan.items.map((i: { assetId: string; status: string }) => [i.assetId, i.status])).toEqual([
      [IMG_A, 'create'],
      [IMG_B, 'create'],
      [IMG_C, 'create'],
    ])
    const a = plan.items[0]
    expect(a.filename).toBe('team_at-work.jpg')
    expect(a.usages).toEqual([
      { docId: 'home-livener', type: 'homePage', title: 'Home', path: 'sections[_key=="hero"].image', draft: false },
      { docId: 'drafts.post-1', type: 'post', title: 'Un articolo', path: 'coverImage', draft: true },
    ])
    expect(a.doc).toEqual({
      _id: `mediaAsset-backfill-livener-${IMG_A}`,
      _type: 'mediaAsset',
      // the PUBLISHED usage's focal point wins over the draft's
      image: {
        _type: 'image',
        asset: { _type: 'reference', _ref: IMG_A },
        hotspot: { x: 0.3, y: 0.4, width: 1, height: 1 },
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
      },
      tenant: { _type: 'reference', _ref: 'client-livener' },
      project: { _type: 'reference', _ref: 'sanity-project-livener' },
      projectSlug: 'livener',
      name: 'team at work',
      tags: [],
      // alt merged across usages, per language, first found wins
      altText: { _type: 'localizedString', en: 'Team at work', it: 'Il team al lavoro' },
      uploadedByName: BACKFILL_MARKER,
    })
    // camera file names give no name; no alt anywhere → no altText field
    expect(plan.items[1].doc).not.toHaveProperty('name')
    expect(plan.items[1].doc).not.toHaveProperty('altText')
    expect(plan.items[1].doc).not.toHaveProperty('uploadedBy')
    expect(plan.toCreate).toHaveLength(3)
  })

  it("never looks at another project's documents", () => {
    const plan = planMediaBackfill(base)
    expect(plan.items.some((i: { assetId: string }) => i.assetId.startsWith('image-dddd'))).toBe(false)
  })

  it('skips assets this project already files; another project\'s mediaAsset does not count', () => {
    const plan = planMediaBackfill({
      ...base,
      mediaAssets: [
        { _id: 'media-a', projectSlug: 'livener', image: { asset: { _ref: IMG_A } } },
        { _id: 'media-b-other', projectSlug: 'studiomartegani', ref: IMG_B },
      ],
    })
    expect(plan.items.find((i: { assetId: string }) => i.assetId === IMG_A)).toMatchObject({ status: 'exists', existingMediaAssetIds: ['media-a'] })
    expect(plan.items.find((i: { assetId: string }) => i.assetId === IMG_B)).toMatchObject({ status: 'create' })
    expect(plan.toCreate.map((d: { _id: string }) => d._id)).toEqual([backfillDocId('livener', IMG_B), backfillDocId('livener', IMG_C)])
  })

  it('can leave out images found only in excluded types (settings artwork)', () => {
    const plan = planMediaBackfill({ ...base, excludeTypes: ['siteConfig', 'designSystem'] })
    expect(plan.items.map((i: { assetId: string }) => i.assetId)).toEqual([IMG_A, IMG_B])
  })

  it('is idempotent: re-planning after the backfill creates nothing', () => {
    const first = planMediaBackfill(base)
    const second = planMediaBackfill({ ...base, mediaAssets: first.toCreate })
    expect(second.toCreate).toEqual([])
    expect(second.items.every((i: { status: string }) => i.status === 'exists')).toBe(true)
  })

  it('blocks (plans nothing) without exactly one project carrying a tenant', () => {
    for (const projects of [[], [{ _id: 'a', clientId: 'c' }, { _id: 'b', clientId: 'c' }], [{ _id: 'a', clientId: null }]]) {
      const plan = planMediaBackfill({ ...base, projects })
      expect(plan.blocked).toBeTruthy()
      expect(plan.toCreate).toEqual([])
      expect(plan.items.every((i: { status: string }) => i.status === 'blocked')).toBe(true)
    }
  })
})

describe('backfillDocId / backfillMutations', () => {
  it('is deterministic and a valid Sanity id', () => {
    expect(backfillDocId('livener', IMG_A)).toBe(backfillDocId('livener', IMG_A))
    expect(backfillDocId('livener', IMG_A)).not.toBe(backfillDocId('studiomartegani', IMG_A))
    const long = backfillDocId('x'.repeat(100), IMG_A)
    expect(long).toMatch(/^mediaAsset-backfill-[0-9a-f]{40}$/)
  })

  it('only ever sends createIfNotExists of backfill mediaAssets', () => {
    const plan = planMediaBackfill({ projectSlug: 'livener', documents: [homePage], projects: [{ _id: 'p', clientId: 'c' }] })
    const mutations = backfillMutations(plan)
    expect(mutations).toHaveLength(2)
    expect(mutations.every((m: Record<string, unknown>) => Object.keys(m).join() === 'createIfNotExists')).toBe(true)
    expect(() => backfillMutations({ toCreate: [{ _id: 'home-livener', _type: 'homePage' }] })).toThrow(/refusing/)
  })
})

describe('photoNameFromFile port', () => {
  it('matches src/lib/media/photo-name.ts', () => {
    for (const f of ['team_at-work.jpg', 'IMG_1234.png', 'PXL_20240101_1.jpg', 'Studio Martegani - sala 2.webp', 'a/b/c/hero.jpg', '', null, 'image.jpg', '0f3c2a1b4d5e6f708192a3b4c5d6e7f8.jpg', 'città_di-varese.jpeg']) {
      expect(portedPhotoName(f)).toBe(photoNameFromFile(f))
    }
  })
})
