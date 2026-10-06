/**
 * Cover step — post images. Every refusal happens BEFORE any upload/write,
 * identity comes from the grant, and only this project's assets can be used.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  getPostCover,
  HOTSPOT_SIZE,
  listProjectMedia,
  parseFocal,
  PostMediaError,
  POST_MEDIA_LIMITS,
  setPostCover,
  sniffImageType,
  uploadPostImage,
} from '../post-media'
import { optimizeImage, type OptimizeImageResult } from '@/lib/media/optimize-image'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ID = '11111111-2222-4333-8444-555555555555'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...'ftypheic'.split('').map((c) => c.charCodeAt(0))])

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
  ...o,
})
const ctx = (...grants: ProjectGrant[]): TenantAuthorizationContext => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: grants,
})

type LibraryRow = { _id: string; _createdAt: string; projectSlug: string; url?: string; name?: string; alt?: unknown; tags?: string[]; width?: number; height?: number; hotspot?: Record<string, unknown> }
const LIBRARY: LibraryRow[] = [
  { _id: 'm4', _createdAt: '2026-10-04T10:00:00Z', projectSlug: 'livener', url: 'https://cdn/4.jpg', name: 'Other tenant', tags: ['secret'] },
  { _id: 'm3', _createdAt: '2026-10-03T10:00:00Z', projectSlug: 'hoffmann', url: 'https://cdn/3.jpg', width: 10, height: 10, name: 'Studio', alt: { _type: 'localizedString', it: 'La città di Varese', de: 'Die Praxis' }, tags: ['Studio', 'esterni'], hotspot: { _type: 'sanity.imageHotspot', x: 0.2, y: 0.7, width: 0.3, height: 0.3 } },
  { _id: 'm2', _createdAt: '2026-10-02T10:00:00Z', projectSlug: 'hoffmann', url: 'https://cdn/2.jpg', width: 10, height: 10, alt: 'legacy text', tags: ['studio'] },
  { _id: 'm1', _createdAt: '2026-10-01T10:00:00Z', projectSlug: 'hoffmann', url: 'https://cdn/1.jpg', name: 'Ritratto Claudia', tags: ['ritratti'] },
]

type Assets = Record<
  string,
  { projectSlug: string; _type?: string; ref?: string; url?: string; altText?: unknown; hotspot?: Record<string, unknown>; crop?: Record<string, unknown> }
>

function fakes(
  opts: {
    draft?: Record<string, unknown> | null
    assets?: Assets
    site?: { defaultLocale?: string; supportedLocales?: string[] } | null
    project?: { _id?: string; clientId?: string | null } | null
    /** Extra Sanity `project` documents carrying the same slug (must be none). */
    duplicateProjects?: number
    /** This user's uploads to the project in the rate-limit window. */
    recentUploads?: number | null
    commitError?: unknown
    library?: LibraryRow[]
  } = {}
) {
  const draft =
    opts.draft === undefined ? { _id: `drafts.${ID}`, _type: 'post', _rev: 'r1', projectSlug: 'hoffmann' } : opts.draft
  const assets: Assets = opts.assets ?? {
    'media-a': { projectSlug: 'hoffmann', ref: 'image-abc-800x600-jpg', url: 'https://cdn/a.jpg' },
    'media-b': { projectSlug: 'livener', ref: 'image-def-800x600-jpg', url: 'https://cdn/b.jpg' },
  }
  const patches: Array<{ id: string; ops: Array<[string, unknown]> }> = []
  const patch = vi.fn((id: string) => {
    const entry = { id, ops: [] as Array<[string, unknown]> }
    patches.push(entry)
    const p = {
      ifRevisionId: (r: string) => (entry.ops.push(['ifRevisionId', r]), p),
      setIfMissing: (v: unknown) => (entry.ops.push(['setIfMissing', v]), p),
      set: (v: unknown) => (entry.ops.push(['set', v]), p),
      unset: (v: unknown) => (entry.ops.push(['unset', v]), p),
      commit: vi.fn(async () => {
        if (opts.commitError && id.startsWith('drafts.')) throw opts.commitError
        entry.ops.push(['commit', null])
        return { _rev: 'r2' }
      }),
    }
    return p
  })
  const client = {
    assets: {
      upload: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>(async () => ({ _id: 'image-new-1200x800-jpg', url: 'https://cdn/new.jpg', metadata: { dimensions: { width: 1200, height: 800 } } })),
    },
    create: vi.fn(async (d: Record<string, unknown>) => ({ ...d, _id: 'media-new' })),
    getDocument: vi.fn(async () => draft),
    patch,
  }
  const fetch = vi.fn(async (query: string, params: Record<string, unknown> = {}) => {
    if (query.startsWith('*[_id == $referencedDocId]')) {
      const a = assets[params.referencedDocId as string]
      return a ? { projectSlug: a.projectSlug } : null
    }
    if (query.startsWith('count(*[_type == "project"')) {
      // The single-Sanity-project write guard (sanity-project-guard.ts).
      return 1 + (opts.duplicateProjects ?? 0)
    }
    if (query.includes('"projects"')) {
      const project = opts.project === undefined ? { _id: 'sanity-project-a', clientId: 'client-a' } : opts.project
      const projects = project ? [project] : []
      for (let i = 0; i < (opts.duplicateProjects ?? 0); i++) projects.push({ _id: `dup-${i}`, clientId: 'client-x' })
      return { projects, recentUploads: opts.recentUploads === undefined ? 0 : opts.recentUploads }
    }
    if (query.includes('_type == "siteConfig"')) {
      return opts.site === undefined ? { defaultLocale: 'it', supportedLocales: ['it', 'de'] } : opts.site
    }
    if (query.includes('image.asset._ref == $ref')) {
      const hit = Object.entries(assets).find(([, a]) => a.ref === params.ref && a.projectSlug === params.projectSlug)
      if (query.trim().endsWith('[0]._id')) return hit ? hit[0] : null
      return hit ? { _id: hit[0], url: hit[1].url, hotspot: hit[1].hotspot } : null
    }
    if (query.includes('_id == $assetId')) {
      const a = assets[params.assetId as string]
      return a && a.projectSlug === params.projectSlug
        ? { ref: a.ref, url: a.url, altText: a.altText, hotspot: a.hotspot ?? null, crop: a.crop ?? null }
        : null
    }
    if (query.includes('_type == "mediaAsset"')) {
      // Emulates the scoped GROQ filter: only rows of the bound $projectSlug.
      return (opts.library ?? LIBRARY).filter((r) => r.projectSlug === params.projectSlug)
    }
    throw new Error(`unexpected query: ${query}`)
  })
  const optimize = vi.fn(async (data: Buffer, contentType: string): Promise<OptimizeImageResult> => ({
    data: Buffer.from('small'),
    contentType,
    optimized: true,
    bytesBefore: data.length,
    bytesAfter: 5,
  }))
  const deps = {
    client: client as never,
    fetch: fetch as never,
    optimize,
    now: () => new Date('2026-10-05T10:00:00Z'),
    log: () => {},
  }
  const draftCommits = () => patches.filter((p) => p.id.startsWith('drafts.') && p.ops.some(([o]) => o === 'commit')).length
  const io = () => client.assets.upload.mock.calls.length + client.create.mock.calls.length + draftCommits()
  return { client, fetch, optimize, deps, patches, io, draftCommits }
}

const file = (bytes: Uint8Array = JPEG, type = 'image/jpeg', name = 'Foto mare.jpg') => new File([bytes as BlobPart], name, { type })

// ── uploadPostImage ─────────────────────────────────────────────────────────

describe('uploadPostImage', () => {
  it('optimises, uploads and files a mediaAsset scoped from the grant', async () => {
    const f = fakes()
    const r = await uploadPostImage(ctx(grant()), 'project-a', file(), f.deps)
    expect(r).toEqual({
      assetId: 'media-new',
      url: 'https://cdn/new.jpg',
      width: 1200,
      height: 800,
      optimized: true,
      bytesBefore: JPEG.length,
      bytesAfter: 5,
      name: 'Foto mare',
    })
    expect(f.optimize).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg')
    expect(f.client.assets.upload).toHaveBeenCalledWith('image', Buffer.from('small'), {
      filename: 'Foto-mare.jpg',
      contentType: 'image/jpeg',
    })
    expect(f.client.create).toHaveBeenCalledWith({
      _type: 'mediaAsset',
      image: { _type: 'image', asset: { _type: 'reference', _ref: 'image-new-1200x800-jpg' } },
      tenant: { _type: 'reference', _ref: 'client-a' },
      project: { _type: 'reference', _ref: 'sanity-project-a' },
      projectSlug: 'hoffmann',
      name: 'Foto mare',
      tags: ['blog'],
      uploadedBy: 'u1',
    })
    // The project lookup went through the scoped client with the grant's slug,
    // counting THIS user's uploads in the last 24 h.
    expect(f.fetch.mock.calls[0][1]).toEqual({
      projectSlug: 'hoffmann',
      userId: 'u1',
      since: '2026-10-04T10:00:00.000Z',
    })
  })

  it('refuses (forbidden) when more than one Sanity project carries the slug — nothing uploaded', async () => {
    const f = fakes({ duplicateProjects: 1 })
    await expect(uploadPostImage(ctx(grant()), 'project-a', file(), f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.io()).toBe(0)
    expect(f.optimize).not.toHaveBeenCalled()
  })

  it('rate limit: the 61st upload in 24 h is refused with rate_limited before Tinify or Sanity', async () => {
    const ok = fakes({ recentUploads: POST_MEDIA_LIMITS.uploadsPerWindow - 1 })
    await uploadPostImage(ctx(grant()), 'project-a', file(), ok.deps)
    expect(ok.client.create).toHaveBeenCalledTimes(1)
    for (const recentUploads of [POST_MEDIA_LIMITS.uploadsPerWindow, 500, null]) {
      const f = fakes({ recentUploads })
      await expect(uploadPostImage(ctx(grant()), 'project-a', file(), f.deps)).rejects.toMatchObject({ code: 'rate_limited' })
      expect(f.io()).toBe(0)
      expect(f.optimize).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['viewer (no write permission)', grant({ role: 'viewer', permissions: ['blog.post.read'] })],
    ['blog not installed', grant({ enabledModuleIds: ['forms'] })],
  ])('refuses %s before any I/O', async (_l, g) => {
    const f = fakes()
    await expect(uploadPostImage(ctx(g), 'project-a', file(), f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.io()).toBe(0)
  })

  it("refuses another tenant's project before any I/O", async () => {
    const f = fakes()
    await expect(uploadPostImage(ctx(grant()), 'project-b', file(), f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.io()).toBe(0)
  })

  it.each([
    ['a GIF', file(new Uint8Array([0x47, 0x49, 0x46, 0x38]), 'image/gif', 'a.gif')],
    ['HEIC', file(HEIC, 'image/heic', 'a.heic')],
    ['a JPEG label on non-image bytes', file(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'image/jpeg')],
    ['a PDF', file(new Uint8Array([0x25, 0x50, 0x44, 0x46]), 'application/pdf', 'a.pdf')],
  ])('refuses %s before upload', async (_l, f0) => {
    const f = fakes()
    await expect(uploadPostImage(ctx(grant()), 'project-a', f0, f.deps)).rejects.toMatchObject({ code: 'unsupported_type' })
    expect(f.optimize).not.toHaveBeenCalled()
    expect(f.io()).toBe(0)
  })

  it('refuses oversize files before reading or uploading', async () => {
    const f = fakes()
    const big = file()
    Object.defineProperty(big, 'size', { value: POST_MEDIA_LIMITS.maxBytes + 1 })
    const read = vi.spyOn(big, 'arrayBuffer')
    await expect(uploadPostImage(ctx(grant()), 'project-a', big, f.deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(read).not.toHaveBeenCalled()
    expect(f.io()).toBe(0)
  })

  it('refuses empty files', async () => {
    const f = fakes()
    await expect(uploadPostImage(ctx(grant()), 'project-a', file(new Uint8Array()), f.deps)).rejects.toMatchObject({
      code: 'invalid_value',
    })
  })

  it('fails closed when the Sanity project has no owner', async () => {
    const f = fakes({ project: { _id: 'sanity-project-a', clientId: null } })
    await expect(uploadPostImage(ctx(grant()), 'project-a', file(), f.deps)).rejects.toMatchObject({ code: 'failed' })
    expect(f.io()).toBe(0)
  })

  it('accepts PNG and keeps going when optimisation is skipped', async () => {
    const f = fakes()
    f.optimize.mockImplementationOnce(async (data: Buffer, contentType: string) => ({
      data,
      contentType,
      optimized: false,
      reason: 'no_key',
      bytesBefore: data.length,
      bytesAfter: data.length,
    }))
    const r = await uploadPostImage(ctx(grant()), 'project-a', file(PNG, 'image/png', 'x.png'), f.deps)
    expect(r.optimized).toBe(false)
    expect(f.client.assets.upload.mock.calls[0][2]).toEqual({ filename: 'x.png', contentType: 'image/png' })
  })
})

describe('sniffImageType', () => {
  it('reads the real format', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg')
    expect(sniffImageType(PNG)).toBe('image/png')
    expect(sniffImageType(new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)))))).toBe('image/webp')
    expect(sniffImageType(HEIC)).toBe('heic')
  })
})

// ── listProjectMedia ────────────────────────────────────────────────────────

describe('listProjectMedia', () => {
  const list = (f: ReturnType<typeof fakes>, o: Parameters<typeof listProjectMedia>[2] = {}) =>
    listProjectMedia(ctx(grant()), 'project-a', o, f.deps)

  it("lists only this project's images, newest first, through the scoped client", async () => {
    const f = fakes()
    const r = await list(f)
    expect(r.items.map((i) => i.assetId)).toEqual(['m3', 'm2', 'm1'])
    expect(r.items[0]).toEqual({
      assetId: 'm3',
      url: 'https://cdn/3.jpg',
      thumbUrl: 'https://cdn/3.jpg?w=480&h=480&fit=crop&auto=format',
      width: 10,
      height: 10,
      alt: { it: 'La città di Varese', de: 'Die Praxis' },
      focal: { x: 0.2, y: 0.7 },
      rev: '',
      name: 'Studio',
      title: {},
      caption: {},
      tags: ['studio', 'esterni'],
    })
    expect(r.items[1].focal).toBeNull()
    expect(r.items[1].alt).toEqual({ en: 'legacy text' })
    expect(r.nextCursor).toBeNull()
    const [query, params] = f.fetch.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(query).toContain('projectSlug == $projectSlug')
    expect(params).toEqual({ projectSlug: 'hoffmann' })
  })

  it("returns this project's distinct tags, most used first, never another project's", async () => {
    const r = await list(fakes())
    expect(r.tags).toEqual(['studio', 'esterni', 'ritratti'])
  })

  it('searches name and alt text in any language, accent-insensitive, all words', async () => {
    const f = fakes()
    expect((await list(f, { q: 'citta' })).items.map((i) => i.assetId)).toEqual(['m3'])
    expect((await list(f, { q: 'PRAXIS' })).items.map((i) => i.assetId)).toEqual(['m3'])
    expect((await list(f, { q: 'ritratto claudia' })).items.map((i) => i.assetId)).toEqual(['m1'])
    expect((await list(f, { q: 'legacy' })).items.map((i) => i.assetId)).toEqual(['m2'])
    expect((await list(f, { q: 'claudia varese' })).items).toEqual([])
    expect((await list(f, { q: 'tenant' })).items).toEqual([])
  })

  it('filters by tags ("any of", case-insensitive) and combines with search', async () => {
    const f = fakes()
    expect((await list(f, { tags: ['STUDIO'] })).items.map((i) => i.assetId)).toEqual(['m3', 'm2'])
    expect((await list(f, { tags: ['esterni', 'ritratti'] })).items.map((i) => i.assetId)).toEqual(['m3', 'm1'])
    expect((await list(f, { tags: ['studio'], q: 'legacy' })).items.map((i) => i.assetId)).toEqual(['m2'])
    expect((await list(f, { tags: ['secret'] })).items).toEqual([])
  })

  it('validates search and tags', async () => {
    const f = fakes()
    await expect(list(f, { q: 'x'.repeat(POST_MEDIA_LIMITS.query + 1) })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(list(f, { tags: Array.from({ length: POST_MEDIA_LIMITS.tags + 1 }, (_, i) => `t${i}`) })).rejects.toMatchObject({
      code: 'invalid_value',
    })
    await expect(list(f, { tags: ['" || true'] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(list(f, { tags: ['x'.repeat(POST_MEDIA_LIMITS.tagLength + 1)] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(list(f, { cursor: '" || true' })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('pages with a cursor', async () => {
    const library: LibraryRow[] = Array.from({ length: POST_MEDIA_LIMITS.pageSize + 5 }, (_, i) => ({
      _id: `m${String(i).padStart(2, '0')}`,
      _createdAt: `2026-10-01T10:${String(59 - i).padStart(2, '0')}:00Z`,
      projectSlug: 'hoffmann',
      url: `https://cdn/${i}.jpg`,
    }))
    const f = fakes({ library })
    const first = await list(f)
    expect(first.items).toHaveLength(POST_MEDIA_LIMITS.pageSize)
    const last = library[POST_MEDIA_LIMITS.pageSize - 1]
    expect(first.nextCursor).toBe(`${last._createdAt}|${last._id}`)
    const second = await list(f, { cursor: first.nextCursor })
    expect(second.items.map((i) => i.assetId)).toEqual(library.slice(POST_MEDIA_LIMITS.pageSize).map((r) => r._id))
    expect(second.nextCursor).toBeNull()
  })

  it('refuses a viewer and another project before any read', async () => {
    const f = fakes()
    await expect(
      listProjectMedia(ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] })), 'project-a', {}, f.deps)
    ).rejects.toThrow(TenantAuthorizationError)
    await expect(listProjectMedia(ctx(grant()), 'project-b', {}, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

// ── setPostCover ────────────────────────────────────────────────────────────

describe('setPostCover', () => {
  const set = (f: ReturnType<typeof fakes>, input: Record<string, unknown> = {}, g = grant()) =>
    setPostCover(ctx(g), 'project-a', { id: ID, rev: 'r1', assetId: 'media-a', alt: { it: 'Il mare al tramonto' }, ...input } as never, f.deps)

  it('writes coverImage in the website shape with ifRevisionId', async () => {
    const f = fakes()
    const r = await set(f, { alt: { it: '  Il mare   al tramonto ', de: 'Das Meer' } })
    expect(r).toEqual({
      rev: 'r2',
      cover: { assetId: 'media-a', url: 'https://cdn/a.jpg', alt: { it: 'Il mare al tramonto', de: 'Das Meer' }, focal: null },
    })
    const draftPatch = f.patches.find((p) => p.id === `drafts.${ID}`)!
    expect(draftPatch.ops).toEqual([
      ['ifRevisionId', 'r1'],
      [
        'set',
        {
          coverImage: {
            _type: 'localizedImage',
            asset: { _type: 'reference', _ref: 'image-abc-800x600-jpg' },
            alt: { _type: 'localizedString', it: 'Il mare al tramonto', de: 'Das Meer' },
          },
          'wizard.updatedAt': '2026-10-05T10:00:00.000Z',
        },
      ],
      ['commit', null],
    ])
  })

  it('fills the missing alt text on the Media Library asset, never overwriting', async () => {
    const f = fakes({
      assets: { 'media-a': { projectSlug: 'hoffmann', ref: 'image-abc-1x1-jpg', url: 'u', altText: { _type: 'localizedString', it: 'Esistente' } } },
    })
    await set(f, { alt: { it: 'Nuovo', de: 'Neu' } })
    const lib = f.patches.find((p) => p.id === 'media-a')!
    expect(lib.ops).toContainEqual(['set', { 'altText.de': 'Neu' }])
  })

  it.each([
    ['viewer', grant({ role: 'viewer', permissions: ['blog.post.read'] })],
    ['blog not installed', grant({ enabledModuleIds: [] })],
  ])('refuses a %s before any I/O', async (_l, g) => {
    const f = fakes()
    await expect(set(f, {}, g)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it("reports another project's draft as not found", async () => {
    const f = fakes({ draft: { _type: 'post', _rev: 'r1', projectSlug: 'livener' } })
    await expect(set(f)).rejects.toMatchObject({ code: 'not_found' })
    expect(f.draftCommits()).toBe(0)
  })

  it('refuses an asset from another project', async () => {
    const f = fakes()
    await expect(set(f, { assetId: 'media-b' })).rejects.toMatchObject({ code: 'not_found' })
    expect(f.draftCommits()).toBe(0)
  })

  it('refuses an unknown asset and a non-mediaAsset document of the same project', async () => {
    const f = fakes({ assets: { 'post-x': { projectSlug: 'hoffmann' } } })
    await expect(set(f, { assetId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(set(f, { assetId: 'post-x' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(set(f, { assetId: 'drafts.media-a' })).rejects.toMatchObject({ code: 'not_found' })
    expect(f.draftCommits()).toBe(0)
  })

  it.each([
    ['missing', undefined],
    ['empty', {}],
    ['blank', { it: '   ' }],
  ])('stores the cover without alt when alt is %s', async (_l, alt) => {
    const f = fakes()
    const r = await set(f, { alt })
    expect(r.cover).toEqual({ assetId: 'media-a', url: 'https://cdn/a.jpg', alt: {}, focal: null })
    const draftPatch = f.patches.find((p) => p.id === `drafts.${ID}`)!
    expect(draftPatch.ops[1]).toEqual([
      'set',
      {
        coverImage: { _type: 'localizedImage', asset: { _type: 'reference', _ref: 'image-abc-800x600-jpg' } },
        'wizard.updatedAt': '2026-10-05T10:00:00.000Z',
      },
    ])
    expect(f.patches.some((p) => p.id === 'media-a')).toBe(false)
  })

  it('accepts alt text only in another site language', async () => {
    const f = fakes()
    const r = await set(f, { alt: { de: 'Das Meer' } })
    expect(r.cover?.alt).toEqual({ de: 'Das Meer' })
  })

  it('refuses alt that is not one text per language', async () => {
    const f = fakes()
    await expect(set(f, { alt: ['x'] })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(set(f, { alt: { it: 42 } })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.draftCommits()).toBe(0)
  })

  it('refuses alt text that is too long or in a language the site does not have', async () => {
    const f = fakes()
    await expect(set(f, { alt: { it: 'x'.repeat(POST_MEDIA_LIMITS.alt + 1) } })).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(set(f, { alt: { it: 'ok', fr: 'non' } })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.draftCommits()).toBe(0)
  })

  it('reports a stale rev as conflict before writing', async () => {
    const f = fakes()
    await expect(set(f, { rev: 'old' })).rejects.toMatchObject({ code: 'conflict' })
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.draftCommits()).toBe(0)
  })

  it('maps a 409 from ifRevisionId to conflict', async () => {
    const f = fakes({ commitError: Object.assign(new Error('rev'), { statusCode: 409 }) })
    await expect(set(f)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('removes the cover', async () => {
    const f = fakes()
    const r = await setPostCover(ctx(grant()), 'project-a', { id: ID, rev: 'r1', remove: true }, f.deps)
    expect(r).toEqual({ rev: 'r2', cover: null })
    expect(f.patches[0].ops).toEqual([
      ['ifRevisionId', 'r1'],
      ['unset', ['coverImage']],
      ['set', { 'wizard.updatedAt': '2026-10-05T10:00:00.000Z' }],
      ['commit', null],
    ])
  })

  it('rejects malformed draft ids as not found', async () => {
    const f = fakes()
    await expect(set(f, { id: '../x' })).rejects.toBeInstanceOf(PostMediaError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })
})

describe('setPostCover · focal point', () => {
  const set = (f: ReturnType<typeof fakes>, input: Record<string, unknown> = {}) =>
    setPostCover(ctx(grant()), 'project-a', { id: ID, rev: 'r1', assetId: 'media-a', ...input } as never, f.deps)
  const withCrop = () =>
    fakes({
      assets: {
        'media-a': {
          projectSlug: 'hoffmann',
          ref: 'image-abc-800x600-jpg',
          url: 'https://cdn/a.jpg',
          crop: { _type: 'sanity.imageCrop', top: 0.1, bottom: 0, left: 0, right: 0 },
          hotspot: { _type: 'sanity.imageHotspot', x: 0.5, y: 0.5, width: 0.4, height: 0.2 },
        },
        'media-b': { projectSlug: 'livener', ref: 'image-def-800x600-jpg', url: 'https://cdn/b.jpg' },
      },
    })

  it('writes the hotspot on the Media Library asset AND the cover, keeping the crop', async () => {
    const f = withCrop()
    const r = await set(f, { focal: { x: 0.25, y: 0.123456 } })
    expect(r.cover?.focal).toEqual({ x: 0.25, y: 0.1235 })
    const hotspot = { _type: 'sanity.imageHotspot', x: 0.25, y: 0.1235, width: 0.4, height: 0.2 }
    const lib = f.patches.find((p) => p.id === 'media-a')!
    expect(lib.ops).toEqual([['set', { 'image.hotspot': hotspot }], ['commit', null]])
    const draft = f.patches.find((p) => p.id === `drafts.${ID}`)!
    expect(draft.ops[1]).toEqual([
      'set',
      {
        coverImage: {
          _type: 'localizedImage',
          asset: { _type: 'reference', _ref: 'image-abc-800x600-jpg' },
          hotspot,
          crop: { _type: 'sanity.imageCrop', top: 0.1, bottom: 0, left: 0, right: 0 },
        },
        'wizard.updatedAt': '2026-10-05T10:00:00.000Z',
      },
    ])
    // The asset (source of truth) is written before the draft.
    expect(f.patches.map((p) => p.id)).toEqual(['media-a', `drafts.${ID}`])
  })

  it('uses a default hotspot size when the asset had none', async () => {
    const f = fakes()
    await set(f, { focal: { x: 0, y: 1 } })
    expect(f.patches.find((p) => p.id === 'media-a')!.ops[0]).toEqual([
      'set',
      { 'image.hotspot': { _type: 'sanity.imageHotspot', x: 0, y: 1, width: HOTSPOT_SIZE, height: HOTSPOT_SIZE } },
    ])
  })

  it("copies the asset's existing focal point onto the cover when none is sent", async () => {
    const f = withCrop()
    const r = await set(f, { alt: { it: 'Mare' } })
    expect(r.cover?.focal).toEqual({ x: 0.5, y: 0.5 })
    expect(f.patches.some((p) => p.id === 'media-a' && p.ops.some(([, v]) => JSON.stringify(v).includes('hotspot')))).toBe(false)
    const draft = f.patches.find((p) => p.id === `drafts.${ID}`)!
    expect((draft.ops[1][1] as { coverImage: { hotspot: unknown } }).coverImage.hotspot).toMatchObject({ x: 0.5, y: 0.5 })
  })

  it.each([
    ['x above 1', { x: 1.2, y: 0.5 }],
    ['negative y', { x: 0.5, y: -0.1 }],
    ['NaN', { x: Number.NaN, y: 0.5 }],
    ['a string', { x: '0.5', y: 0.5 }],
    ['an array', [0.5, 0.5]],
  ])('refuses a focal point that is %s before any read or write', async (_l, focal) => {
    const f = fakes()
    await expect(set(f, { focal })).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.patches).toEqual([])
  })

  it("refuses another project's asset without touching it", async () => {
    const f = withCrop()
    await expect(set(f, { assetId: 'media-b', focal: { x: 0.1, y: 0.1 } })).rejects.toMatchObject({ code: 'not_found' })
    expect(f.patches).toEqual([])
  })

  it('accepts the image asset id the wizard reads back, resolved within this project only', async () => {
    const f = withCrop()
    const r = await set(f, { assetId: 'image-abc-800x600-jpg', focal: { x: 0.3, y: 0.3 } })
    expect(r.cover?.assetId).toBe('media-a')
    expect(f.patches.map((p) => p.id)).toEqual(['media-a', `drafts.${ID}`])
    await expect(set(f, { assetId: 'image-def-800x600-jpg' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('validates the point with parseFocal', () => {
    expect(parseFocal({ x: 0.33333, y: 1 })).toEqual({ x: 0.3333, y: 1 })
    expect(() => parseFocal(null)).toThrow(PostMediaError)
  })
})

describe('getPostCover', () => {
  it('resolves the cover back to its Media Library asset', async () => {
    const f = fakes({
      draft: {
        _type: 'post',
        _rev: 'r1',
        projectSlug: 'hoffmann',
        coverImage: { asset: { _ref: 'image-abc-800x600-jpg' }, alt: { _type: 'localizedString', it: 'Mare' } },
      },
    })
    expect(await getPostCover(ctx(grant()), 'project-a', { id: ID }, f.deps)).toEqual({
      assetId: 'media-a',
      url: 'https://cdn/a.jpg',
      alt: { it: 'Mare' },
      focal: null,
    })
  })

  it('returns null without a cover', async () => {
    const f = fakes()
    expect(await getPostCover(ctx(grant()), 'project-a', { id: ID }, f.deps)).toBeNull()
  })
})

// ── optimizeImage (no network) ──────────────────────────────────────────────

describe('optimizeImage', () => {
  it('skips without a key and returns the original', async () => {
    const data = Buffer.from(JPEG)
    const fetch = vi.fn()
    const r = await optimizeImage(data, 'image/jpeg', { apiKey: '', fetch: fetch as never })
    expect(r).toMatchObject({ optimized: false, reason: 'no_key', data })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves formats Tinify does not handle (SVG, GIF) untouched, without calling it', async () => {
    const fetch = vi.fn()
    const r = await optimizeImage(Buffer.from('<svg/>'), 'image/svg+xml', { apiKey: 'k', fetch: fetch as never })
    expect(r).toMatchObject({ optimized: false, reason: 'unsupported' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shrinks, then resizes large images to fit', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === 'https://api.tinify.com/shrink') {
        return new Response(JSON.stringify({ output: { width: 4000, height: 3000, type: 'image/jpeg' } }), {
          status: 201,
          headers: { location: 'https://api.tinify.com/output/abc' },
        })
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    const r = await optimizeImage(Buffer.from(JPEG), 'image/jpeg', { apiKey: 'k', fetch: fetch as never })
    expect(r).toMatchObject({ optimized: true, bytesAfter: 3, contentType: 'image/jpeg' })
    const [, init] = fetch.mock.calls[1] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ resize: { method: 'fit', width: 2560, height: 2560 } })
  })

  it('falls back to the original when Tinify fails', async () => {
    const fetch = vi.fn(async () => new Response('quota', { status: 429 }))
    const r = await optimizeImage(Buffer.from(JPEG), 'image/jpeg', { apiKey: 'k', fetch: fetch as never })
    expect(r).toMatchObject({ optimized: false, reason: 'failed' })
  })
})

describe('setPostCover — single-Sanity-project write guard', () => {
  it('set (with a new focal point) and remove are refused before any write when the slug is shared', async () => {
    const set = fakes({ duplicateProjects: 1 })
    await expect(
      setPostCover(ctx(grant()), 'project-a', { id: ID, rev: 'r1', assetId: 'media-a', focal: { x: 0.2, y: 0.3 } }, set.deps)
    ).rejects.toThrow(TenantAuthorizationError)
    expect(set.patches.filter((p) => p.ops.some(([o]) => o === 'commit'))).toHaveLength(0)

    const remove = fakes({ duplicateProjects: 1 })
    await expect(
      setPostCover(ctx(grant()), 'project-a', { id: ID, rev: 'r1', remove: true }, remove.deps)
    ).rejects.toThrow(TenantAuthorizationError)
    expect(remove.draftCommits()).toBe(0)
  })
})
