/**
 * Galleries in the client dashboard. Every refusal happens BEFORE any write;
 * identity comes from the grant; photos must be this project's assets.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  createGallery,
  deleteGallery,
  discardGalleryDraft,
  getGalleryDraft,
  getGallerySite,
  GALLERY_LIMITS,
  listGalleries,
  openGalleryForEdit,
  patchGalleryDraft,
  publishGalleryDraft,
} from '../gallery-drafts'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const G = 'gal-1'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ['gallery.gallery.read', 'gallery.gallery.write', 'gallery.gallery.delete'],
  enabledModuleIds: ['gallery'],
  ...o,
})
const editor = () => grant({ role: 'editor', permissions: ['gallery.gallery.read', 'gallery.gallery.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['gallery.gallery.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const item = (key: string, ref: string, extra: Record<string, unknown> = {}) => ({
  _key: key,
  _type: 'galleryItem',
  mediaAsset: { _type: 'reference', _ref: ref },
  titleOverrideEnabled: false,
  captionOverrideEnabled: false,
  ...extra,
})
const baseDocs = (): Docs => ({
  [G]: { _id: G, _type: 'gallery', _rev: 'p1', projectSlug: 'hoffmann', internalName: 'Studio', title: { it: 'Lo studio' }, items: [item('a', 'm1')] },
  [`drafts.${G}`]: {
    _id: `drafts.${G}`,
    _type: 'gallery',
    _rev: 'd1',
    projectSlug: 'hoffmann',
    internalName: 'Studio',
    title: { _type: 'localizedString', it: 'Lo studio nuovo' },
    items: [item('a', 'm1'), item('b', 'm2', { titleOverrideEnabled: true, titleOverride: { it: 'Solo qui' } })],
  },
  other: { _id: 'other', _type: 'gallery', _rev: 'o1', projectSlug: 'livener', items: [] },
})
const ASSETS: Record<string, { projectSlug: string; altText?: unknown; url?: string }> = {
  m1: { projectSlug: 'hoffmann', altText: { it: 'Sala' }, url: 'https://cdn.sanity.io/images/x/y/m1.jpg' },
  m2: { projectSlug: 'hoffmann', altText: { de: 'nur deutsch' }, url: 'https://cdn.sanity.io/images/x/y/m2.jpg' },
  m3: { projectSlug: 'hoffmann', altText: 'legacy', url: 'https://cdn.sanity.io/images/x/y/m3.jpg' },
  foreign: { projectSlug: 'livener', altText: { en: 'x' } },
}

function fake(opts: { docs?: Docs; usage?: Array<{ _id: string; _type: string; title?: unknown; refs: string[] }>; projectCount?: number; commitError?: unknown; slugs?: string[] } = {}) {
  const docs = opts.docs ?? baseDocs()
  const writes: Array<[string, unknown]> = []
  const patchOps: Array<[string, unknown]> = []
  const txOps: Array<[string, unknown]> = []
  const patch = vi.fn((id: string) => {
    const p = {
      ifRevisionId: (r: string) => (patchOps.push(['ifRevisionId', r]), p),
      setIfMissing: (v: unknown) => (patchOps.push(['setIfMissing', v]), p),
      set: (v: unknown) => (patchOps.push(['set', v]), p),
      unset: (v: unknown) => (patchOps.push(['unset', v]), p),
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(['patch', id])
        return { _rev: 'd2' }
      }),
    }
    return p
  })
  const transaction = vi.fn(() => {
    const tx = {
      patch: (id: string, v: unknown) => (txOps.push(['patch', [id, v]]), tx),
      create: (d: unknown) => (txOps.push(['create', d]), tx),
      createOrReplace: (d: unknown) => (txOps.push(['createOrReplace', d]), tx),
      delete: (id: string) => (txOps.push(['delete', id]), tx),
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(['transaction', txOps.length])
        return {}
      }),
    }
    return tx
  })
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return opts.projectCount ?? 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
    if (q.includes('references($ids)')) {
      const ids = p.ids as string[]
      return (opts.usage ?? []).filter((u) => u.refs.some((r) => ids.includes(r)))
    }
    if (q.includes('slug.current`') || q.trim().endsWith('.slug.current')) return opts.slugs ?? ['lo-studio', 'nuova-galleria']
    if (q.includes('_type == "gallery"')) {
      return Object.values(docs).filter((d) => d._type === 'gallery' && d.projectSlug === p.projectSlug).map((d) => ({
        _id: d._id,
        title: d.title,
        internalName: d.internalName,
        _createdAt: d._createdAt,
        count: (d.items as unknown[]).length,
        refs: (d.items as Array<{ mediaAsset: { _ref: string } }>).slice(0, 5).map((i) => i.mediaAsset._ref),
        // GROQ: select(mainImage._ref in items[].mediaAsset._ref => mainImage._ref)
        main: (() => {
          const ref = (d.mainImage as { _ref?: string } | undefined)?._ref
          return ref && (d.items as Array<{ mediaAsset: { _ref: string } }>).some((i) => i.mediaAsset._ref === ref) ? ref : null
        })(),
      }))
    }
    if (q.includes('_type == "mediaAsset"')) {
      const ids = (p.ids as string[]) ?? []
      const hits = ids.filter((id) => ASSETS[id]?.projectSlug === p.projectSlug)
      if (q.trim().endsWith('._id')) return hits
      return hits.map((id) => ({ _id: id, _rev: `r-${id}`, url: ASSETS[id].url, altText: ASSETS[id].altText, hotspot: id === 'm1' ? { x: 0.2, y: 0.3 } : null, tags: ['studio'] }))
    }
    throw new Error(`unexpected query ${q}`)
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>) => (writes.push(['create', d._id]), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  return { client, writes, patchOps, txOps, deps: { client: client as never, uuid: () => 'new-uuid-1', now: () => new Date('2026-10-05T10:00:00Z') } }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates — refused before any I/O', () => {
  const calls = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>, pid = 'project-a') => [
    () => openGalleryForEdit(c, pid, G, f.deps),
    () => createGallery(c, pid, { title: 'x' }, f.deps),
    () => patchGalleryDraft(c, pid, { id: G, rev: 'd1', set: { 'title.it': 'x' } }, f.deps),
    () => publishGalleryDraft(c, pid, { id: G, rev: 'd1' }, f.deps),
    () => discardGalleryDraft(c, pid, { id: G, rev: 'd1' }, f.deps),
    () => deleteGallery(c, pid, { id: G }, f.deps),
    () => getGallerySite(c, pid, f.deps),
  ]
  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without Gallery', ctx(grant({ enabledModuleIds: ['blog'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of calls(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it("another tenant's project is refused for reads and writes", async () => {
    const f = fake()
    for (const call of calls(ctx(grant()), f, 'project-b')) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    await expect(listGalleries(ctx(grant()), 'project-b', f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(getGalleryDraft(ctx(grant()), 'project-b', G, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
  })

  it('a viewer can read', async () => {
    const f = fake()
    await expect(listGalleries(ctx(viewer()), 'project-a', f.deps)).resolves.toHaveLength(1)
    await expect(getGalleryDraft(ctx(viewer()), 'project-a', G, f.deps)).resolves.toMatchObject({ id: G })
  })

  it("another project's gallery and unsafe ids are not_found", async () => {
    const f = fake()
    for (const id of ['other', 'drafts.x', '../x', 'a/b']) {
      await expect(getGalleryDraft(ctx(grant()), 'project-a', id, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(openGalleryForEdit(ctx(grant()), 'project-a', id, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(f.writes).toEqual([])
  })

  it('refuses every write when the project slug is shared by two Sanity projects', async () => {
    const f = fake({ projectCount: 2 })
    await expect(patchGalleryDraft(ctx(grant()), 'project-a', { id: G, rev: 'd1', set: { 'title.it': 'x' } }, f.deps)).rejects.toThrow(
      TenantAuthorizationError
    )
    expect(f.writes).toEqual([])
  })
})

// ── List / read ───────────────────────────────────────────────────────────────

describe('getGallerySite (new-gallery wizard)', () => {
  it('returns the site languages, main language first', async () => {
    const f = fake()
    await expect(getGallerySite(ctx(editor()), 'project-a', f.deps)).resolves.toEqual({ defaultLocale: 'it', locales: ['it', 'de'] })
    expect(f.writes).toEqual([])
  })
})

describe('listGalleries', () => {
  it('one row per gallery, the draft state, with cover, count and usage', async () => {
    const f = fake({ usage: [{ _id: 'page-1', _type: 'page', title: { it: 'Lo studio', en: 'Studio' }, refs: [G] }] })
    const [g] = await listGalleries(ctx(grant()), 'project-a', f.deps)
    expect(g).toMatchObject({
      id: G,
      title: 'Lo studio nuovo',
      internalName: 'Studio',
      count: 2,
      hasDraft: true,
      isPublished: true,
      usedIn: [{ kind: 'page', id: 'page-1', title: 'Lo studio' }],
    })
    expect(g.coverThumb).toContain('crop=focalpoint')
    expect(g.coverThumb).toContain('fp-x=0.200')
    // No main image: the first photo leads the strip, then the others in order.
    expect(g.mainImage).toBeNull()
    expect(g.thumbs).toHaveLength(2)
    expect(g.thumbs[0]).toContain('/m1.jpg?w=384&h=384')
    expect(g.thumbs[1]).toContain('/m2.jpg?w=160&h=160')
  })

  it('the main image leads the strip and the cover; created is the earliest of the pair', async () => {
    const docs = baseDocs()
    docs[G]._createdAt = '2026-01-01T09:00:00Z'
    docs[`drafts.${G}`]._createdAt = '2026-10-01T09:00:00Z'
    docs[`drafts.${G}`].mainImage = { _type: 'reference', _ref: 'm2', _weak: true }
    const [g] = await listGalleries(ctx(grant()), 'project-a', fake({ docs }).deps)
    expect(g.mainImage).toBe('m2')
    expect(g.thumbs[0]).toContain('/m2.jpg?w=384')
    expect(g.thumbs[1]).toContain('/m1.jpg?w=160')
    expect(g.coverThumb).toContain('/m2.jpg')
    expect(g.createdAt).toBe('2026-01-01T09:00:00Z')
  })

  it('ignores a main image that is not one of the photos', async () => {
    const docs = baseDocs()
    docs[`drafts.${G}`].mainImage = { _type: 'reference', _ref: 'm3' }
    const [g] = await listGalleries(ctx(grant()), 'project-a', fake({ docs }).deps)
    expect(g.mainImage).toBeNull()
    expect(g.thumbs[0]).toContain('/m1.jpg')
  })
})

describe('galleryStrip', () => {
  it('lead first (main when it is a photo), then the rest in order, capped', async () => {
    const { galleryStrip } = await import('../gallery-drafts')
    expect(galleryStrip(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(galleryStrip(['a', 'b', 'c'], 'x')).toEqual(['a', 'b', 'c'])
    expect(galleryStrip(['a', 'b', 'c', 'd', 'e', 'f'], null)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(galleryStrip([], 'a')).toEqual([])
  })
})

describe('getGalleryDraft', () => {
  it('returns the draft with photo facts and overrides', async () => {
    const f = fake()
    const s = await getGalleryDraft(ctx(grant()), 'project-a', G, f.deps)
    expect(s).toMatchObject({ id: G, rev: 'd1', hasDraft: true, title: { it: 'Lo studio nuovo' }, live: { rev: 'p1' } })
    expect(s.items.map((i) => [i.key, i.assetId])).toEqual([['a', 'm1'], ['b', 'm2']])
    expect(s.items[0]).toMatchObject({ alt: { it: 'Sala' }, focal: { x: 0.2, y: 0.3 }, tags: ['studio'], titleOverride: null, rev: 'r-m1' })
    expect(s.items[1].titleOverride).toEqual({ it: 'Solo qui' })
    expect(s.site).toEqual({ defaultLocale: 'it', locales: ['it', 'de'] })
  })

  it('returns the main image only when it is one of the photos', async () => {
    const docs = baseDocs()
    docs[`drafts.${G}`].mainImage = { _type: 'reference', _ref: 'm2', _weak: true }
    expect((await getGalleryDraft(ctx(grant()), 'project-a', G, fake({ docs }).deps)).mainImage).toBe('m2')
    docs[`drafts.${G}`].mainImage = { _type: 'reference', _ref: 'm3' }
    expect((await getGalleryDraft(ctx(grant()), 'project-a', G, fake({ docs }).deps)).mainImage).toBeNull()
    expect((await getGalleryDraft(ctx(grant()), 'project-a', G, fake().deps)).mainImage).toBeNull()
  })

  it('falls back to the published version when there is no draft', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${G}`]
    const s = await getGalleryDraft(ctx(grant()), 'project-a', G, fake({ docs }).deps)
    expect(s).toMatchObject({ rev: '', hasDraft: false, title: { it: 'Lo studio' } })
  })
})

// ── Open / create ─────────────────────────────────────────────────────────────

describe('openGalleryForEdit / createGallery', () => {
  it('copies the published gallery into drafts.<id> once', async () => {
    const docs = baseDocs()
    delete docs[`drafts.${G}`]
    const f = fake({ docs })
    expect(await openGalleryForEdit(ctx(editor()), 'project-a', G, f.deps)).toEqual({ id: G, created: true })
    const copy = f.client.create.mock.calls[0][0] as Record<string, unknown>
    expect(copy).toMatchObject({ _id: `drafts.${G}`, _type: 'gallery', projectSlug: 'hoffmann', internalName: 'Studio' })
    expect(copy._rev).toBeUndefined()
    const again = fake()
    expect(await openGalleryForEdit(ctx(editor()), 'project-a', G, again.deps)).toEqual({ id: G, created: false })
    expect(again.writes).toEqual([])
  })

  it('creates a draft with a unique slug and internalName from the title', async () => {
    const f = fake()
    expect(await createGallery(ctx(editor()), 'project-a', { title: '  Lo   studio ' }, f.deps)).toEqual({ id: 'new-uuid-1', rev: 'c1' })
    expect(f.client.create.mock.calls[0][0]).toEqual({
      _id: 'drafts.new-uuid-1',
      _type: 'gallery',
      projectSlug: 'hoffmann',
      internalName: 'Lo studio',
      title: { _type: 'localizedString', it: 'Lo studio' },
      slug: { _type: 'slug', current: 'lo-studio-2' },
      items: [],
    })
  })

  it('refuses an over-long title', async () => {
    const f = fake()
    await expect(createGallery(ctx(editor()), 'project-a', { title: 'x'.repeat(GALLERY_LIMITS.title + 1) }, f.deps)).rejects.toMatchObject({
      code: 'invalid_value',
    })
    expect(f.writes).toEqual([])
  })
})

// ── Patch ─────────────────────────────────────────────────────────────────────

describe('patchGalleryDraft', () => {
  const patch = (f: ReturnType<typeof fake>, set: Record<string, unknown>, rev = 'd1') =>
    patchGalleryDraft(ctx(editor()), 'project-a', { id: G, rev, set }, f.deps)

  it('saves title/description per language with ifRevisionId', async () => {
    const f = fake()
    expect(await patch(f, { 'title.it': ' Nuovo ', 'description.de': '' })).toEqual({ rev: 'd2' })
    expect(f.patchOps).toEqual([
      ['ifRevisionId', 'd1'],
      ['setIfMissing', { title: { _type: 'localizedString' }, description: { _type: 'localizedString' } }],
      ['set', { 'title.it': 'Nuovo' }],
      ['unset', ['description.de']],
    ])
  })

  it.each([
    ['projectSlug', { projectSlug: 'livener' }],
    ['internalName', { internalName: 'x' }],
    ['slug', { slug: 'x' }],
    ['nested', { 'title.it.x': 'x' }],
    ['no locale', { title: 'x' }],
  ])('refuses the field %s before reading', async (_l, set) => {
    const f = fake()
    await expect(patch(f, set)).rejects.toMatchObject({ code: 'invalid_field' })
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('sets the main image to one of its own photos (weak reference) and clears it', async () => {
    const f = fake()
    expect(await patch(f, { mainImage: 'm2' })).toEqual({ rev: 'd2' })
    expect(f.patchOps).toEqual([
      ['ifRevisionId', 'd1'],
      ['set', { mainImage: { _type: 'reference', _ref: 'm2', _weak: true } }],
    ])
    const g = fake()
    await patch(g, { mainImage: null })
    expect(g.patchOps).toEqual([
      ['ifRevisionId', 'd1'],
      ['unset', ['mainImage']],
    ])
  })

  it.each([
    ['a photo of this project that is not in the gallery', 'm3'],
    ["another project's photo", 'foreign'],
    ['an unsafe id', '../x'],
    ['not text', 42],
    ['an object', { _ref: 'm1' }],
  ])('refuses as main image %s, without writing', async (_l, value) => {
    const f = fake()
    await expect(patch(f, { mainImage: value })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('checks the main image against the new photos when both change together', async () => {
    const ok = fake()
    await patch(ok, { items: [{ key: 'a', assetId: 'm1' }, { key: 'c', assetId: 'm3' }], mainImage: 'm3' })
    expect(ok.patchOps.find(([op]) => op === 'set')?.[1]).toMatchObject({ mainImage: { _ref: 'm3' } })
    const bad = fake()
    await expect(patch(bad, { items: [{ key: 'a', assetId: 'm1' }], mainImage: 'm2' })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(bad.writes).toEqual([])
  })

  it('a photo taken out of the gallery stops being its main image', async () => {
    const docs = baseDocs()
    docs[`drafts.${G}`].mainImage = { _type: 'reference', _ref: 'm2', _weak: true }
    const f = fake({ docs })
    await patch(f, { items: [{ key: 'a', assetId: 'm1' }] })
    expect(f.patchOps).toContainEqual(['unset', ['mainImage']])
    const kept = fake({ docs })
    await patch(kept, { items: [{ key: 'b', assetId: 'm2' }] })
    expect(kept.patchOps.some(([op]) => op === 'unset')).toBe(false)
  })

  it('refuses a language the site does not have, and over-long text', async () => {
    const f = fake()
    await expect(patch(f, { 'title.fr': 'x' })).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(patch(f, { 'title.it': 'x'.repeat(GALLERY_LIMITS.title + 1) })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('rebuilds items: keeps keys, regenerates duplicates, validates overrides', async () => {
    const f = fake()
    const r = await patch(f, {
      items: [
        { key: 'b', assetId: 'm2', titleOverride: { it: ' Solo qui ' }, captionOverride: { it: '' }, extra: 'dropped' },
        { key: 'a', assetId: 'm1' },
        { key: 'a', assetId: 'm3', captionOverride: null },
        { assetId: 'm1' },
      ],
    })
    expect(r.rev).toBe('d2')
    expect(r.keys?.slice(0, 2)).toEqual(['b', 'a'])
    expect(new Set(r.keys).size).toBe(4)
    const items = (f.patchOps.find(([op]) => op === 'set')![1] as { items: Array<Record<string, unknown>> }).items
    expect(items[0]).toEqual({
      _key: 'b',
      _type: 'galleryItem',
      mediaAsset: { _type: 'reference', _ref: 'm2' },
      titleOverrideEnabled: true,
      titleOverride: { _type: 'localizedString', it: 'Solo qui' },
      captionOverrideEnabled: false,
    })
    expect(items[1]).toEqual({ _key: 'a', _type: 'galleryItem', mediaAsset: { _type: 'reference', _ref: 'm1' }, titleOverrideEnabled: false, captionOverrideEnabled: false })
  })

  it("refuses another project's photo, a missing photo and a bad id without writing", async () => {
    for (const assetId of ['foreign', 'nope', '../x']) {
      const f = fake()
      await expect(patch(f, { items: [{ assetId }] })).rejects.toMatchObject({ code: assetId === '../x' ? 'invalid_value' : 'not_found' })
      expect(f.writes).toEqual([])
    }
  })

  it('refuses bad overrides and too many photos', async () => {
    const f = fake()
    await expect(patch(f, { items: [{ assetId: 'm1', titleOverride: { fr: 'x' } }] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(patch(f, { items: [{ assetId: 'm1', captionOverride: { it: 'x'.repeat(GALLERY_LIMITS.override + 1) } }] })).rejects.toMatchObject({
      code: 'invalid_value',
    })
    await expect(patch(f, { items: Array.from({ length: GALLERY_LIMITS.items + 1 }, () => ({ assetId: 'm1' })) })).rejects.toMatchObject({
      code: 'invalid_value',
    })
    expect(f.writes).toEqual([])
  })

  it('stale rev → conflict; a 409 → conflict; no draft → not_found', async () => {
    await expect(patch(fake(), { 'title.it': 'x' }, 'old')).rejects.toMatchObject({ code: 'conflict' })
    await expect(patch(fake({ commitError: Object.assign(new Error(), { statusCode: 409 }) }), { 'title.it': 'x' })).rejects.toMatchObject({
      code: 'conflict',
    })
    const docs = baseDocs()
    delete docs[`drafts.${G}`]
    await expect(patch(fake({ docs }), { 'title.it': 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

// ── Publish / discard / delete ────────────────────────────────────────────────

describe('publishGalleryDraft', () => {
  const okDocs = () => {
    const docs = baseDocs()
    ;(docs[`drafts.${G}`] as { items: unknown[] }).items = [item('a', 'm1'), item('c', 'm3')]
    return docs
  }

  it('publishes over the live gallery in one guarded transaction', async () => {
    const f = fake({ docs: okDocs() })
    expect(await publishGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, f.deps)).toEqual({ id: G })
    expect(f.txOps.map(([op]) => op)).toEqual(['patch', 'patch', 'createOrReplace', 'delete'])
    const doc = f.txOps[2][1] as Record<string, unknown>
    expect(doc).toMatchObject({ _id: G, _type: 'gallery', projectSlug: 'hoffmann', title: { _type: 'localizedString', it: 'Lo studio nuovo' } })
    expect(doc._rev).toBeUndefined()
    expect(f.txOps[3][1]).toBe(`drafts.${G}`)
  })

  it('creates (never replaces) a first publish', async () => {
    const docs = okDocs()
    delete docs[G]
    const f = fake({ docs })
    await publishGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, f.deps)
    expect(f.txOps.map(([op]) => op)).toEqual(['patch', 'create', 'delete'])
  })

  it('publishes photos without a description (describe later)', async () => {
    const f = fake()
    expect(await publishGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, f.deps)).toEqual({ id: G })
    expect(f.txOps.map(([op]) => op)).toContain('createOrReplace')
  })

  it('refuses an empty gallery, a stale rev and a missing draft', async () => {
    const docs = baseDocs()
    ;(docs[`drafts.${G}`] as { items: unknown[] }).items = []
    await expect(publishGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'empty' })
    await expect(publishGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'old' }, fake({ docs: okDocs() }).deps)).rejects.toMatchObject({
      code: 'conflict',
    })
    const noDraft = baseDocs()
    delete noDraft[`drafts.${G}`]
    await expect(publishGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, fake({ docs: noDraft }).deps)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('discardGalleryDraft', () => {
  it('deletes only the draft, revision-guarded', async () => {
    const f = fake()
    await discardGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, f.deps)
    expect(f.txOps).toEqual([
      ['patch', [`drafts.${G}`, { ifRevisionID: 'd1', unset: ['_lifecycleGuard'] }]],
      ['delete', `drafts.${G}`],
    ])
  })

  it('refuses a never-published gallery and a stale rev', async () => {
    const docs = baseDocs()
    delete docs[G]
    await expect(discardGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1' }, fake({ docs }).deps)).rejects.toMatchObject({
      code: 'invalid_value',
    })
    await expect(discardGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'x' }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('deleteGallery', () => {
  it('owners only', async () => {
    const f = fake()
    await expect(deleteGallery(ctx(editor()), 'project-a', { id: G }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('refuses while a page or post shows it, and says where', async () => {
    const f = fake({ usage: [{ _id: 'post-1', _type: 'post', title: { it: 'Un articolo' }, refs: [G] }] })
    await expect(deleteGallery(ctx(grant()), 'project-a', { id: G }, f.deps)).rejects.toMatchObject({
      code: 'in_use',
      detail: { usedIn: [{ kind: 'post', id: 'post-1', title: 'Un articolo' }] },
    })
    expect(f.writes).toEqual([])
  })

  it('deletes published and draft together, guarded', async () => {
    const f = fake()
    await deleteGallery(ctx(grant()), 'project-a', { id: G, rev: 'd1' }, f.deps)
    expect(f.txOps.map(([op]) => op)).toEqual(['patch', 'patch', 'delete', 'delete'])
  })
})

describe('launch hardening', () => {
  it('createGallery refuses (too_large) once the project holds GALLERY_LIMITS.galleries galleries', async () => {
    const f = fake({ slugs: Array.from({ length: GALLERY_LIMITS.galleries }, (_, i) => `g-${i}`) })
    await expect(createGallery(ctx(editor()), 'project-a', { title: 'Nuova' }, f.deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(f.writes).toEqual([])
  })

  it("patchGalleryDraft: a published doc of another project under the draft's id → not_found, nothing written", async () => {
    const docs = baseDocs()
    docs[G] = { ...(docs[G] as Record<string, unknown>), projectSlug: 'livener' } as never
    const f = fake({ docs })
    await expect(
      patchGalleryDraft(ctx(editor()), 'project-a', { id: G, rev: 'd1', set: { 'title.it': 'x' } }, f.deps)
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(f.writes).toEqual([])
  })
})
