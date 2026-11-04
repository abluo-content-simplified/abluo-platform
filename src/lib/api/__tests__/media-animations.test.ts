/**
 * ADR-046 — Lottie animations in the Media Library: the upload checks the
 * file's own bytes, files a FILE asset with no image, and only lists that ask
 * for animations (the admin Media screen) ever contain one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { listProjectMedia, PostMediaError, uploadProjectAnimation } from '../post-media'
import { createAnimationAsset } from '@/lib/media/create-media-asset'
import { LOTTIE_LIMITS } from '@/lib/media/lottie'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const enc = (s: string) => new TextEncoder().encode(s)
const LOTTIE = enc(JSON.stringify({ v: '5.7.4', fr: 25, ip: 0, op: 41, w: 900, h: 849, layers: [] }))
const DOTLOTTIE = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, ...enc('manifest.json\0animations/a.json')])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('freeriders'),
  membershipId: 'abluo-admin:u1',
  role: 'admin',
  permissions: ['media.library.manage'],
  enabledModuleIds: [],
  ...o,
})
const ctx = (...grants: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'abluo_admin', projects: grants, tenants: [] })
const file = (bytes: Uint8Array, name = 'Rider bike.json', type = 'application/json') => new File([bytes as BlobPart], name, { type })

function fakes(opts: { rows?: Record<string, unknown>[]; recentUploads?: number } = {}) {
  const queries: string[] = []
  const client = {
    assets: { upload: vi.fn(async (..._a: unknown[]) => ({ _id: 'file-abc-json', url: 'https://cdn.sanity.io/files/p/d/abc.json' })) },
    create: vi.fn(async (d: Record<string, unknown>) => ({ ...d, _id: 'media-new' })),
    getDocument: vi.fn(),
    patch: vi.fn(),
  }
  const fetch = vi.fn(async (query: string, params: Record<string, unknown> = {}) => {
    queries.push(query)
    if (query.includes('"projects"')) return { projects: [{ _id: 'sanity-project-a', clientId: 'client-freeriders' }], recentUploads: opts.recentUploads ?? 0 }
    if (query.includes('_type == "mediaAsset"')) return (opts.rows ?? []).filter((r) => r.projectSlug === params.projectSlug)
    throw new Error(`unexpected query: ${query}`)
  })
  const deps = { client: client as never, fetch: fetch as never, now: () => new Date('2026-11-03T10:00:00Z') }
  return { client, fetch, deps, queries }
}

describe('uploadProjectAnimation', () => {
  it('files a plain Lottie as a FILE asset with its facts and no image', async () => {
    const f = fakes()
    const r = await uploadProjectAnimation(ctx(grant()), 'project-a', file(LOTTIE), {}, f.deps)
    expect(r).toEqual({ assetId: 'media-new', url: 'https://cdn.sanity.io/files/p/d/abc.json', format: 'lottie-json', width: 900, height: 849, bytes: LOTTIE.length, name: 'Rider bike' })
    expect(f.client.assets.upload).toHaveBeenCalledWith('file', expect.any(Buffer), { filename: 'Rider-bike.json', contentType: 'application/json' })
    const doc = f.client.create.mock.calls[0][0]
    expect(doc).toMatchObject({
      _type: 'mediaAsset',
      mediaType: 'animation',
      tenant: { _type: 'reference', _ref: 'client-freeriders' },
      project: { _type: 'reference', _ref: 'sanity-project-a' },
      projectSlug: 'freeriders',
      animation: { _type: 'file', asset: { _type: 'reference', _ref: 'file-abc-json' } },
      animationInfo: { format: 'lottie-json', width: 900, height: 849, frameRate: 25, frames: 41 },
      processing: { status: 'ready', optimized: false },
      uploadedBy: 'u1',
    })
    expect(doc).not.toHaveProperty('image')
  })

  it('files a .lottie archive whatever its declared type, with the right extension', async () => {
    const f = fakes()
    const r = await uploadProjectAnimation(ctx(grant()), 'project-a', file(DOTLOTTIE, 'rider', 'application/octet-stream'), {}, f.deps)
    expect(r.format).toBe('dotlottie')
    expect(f.client.assets.upload).toHaveBeenCalledWith('file', expect.any(Buffer), { filename: 'rider.lottie', contentType: 'application/zip' })
    expect(f.client.create.mock.calls[0][0].animationInfo).toEqual({ format: 'dotlottie' })
  })

  it('refuses a file that only claims to be an animation — before any upload', async () => {
    const f = fakes()
    await expect(uploadProjectAnimation(ctx(grant()), 'project-a', file(PNG, 'fake.json'), {}, f.deps)).rejects.toMatchObject({ code: 'unsupported_type' })
    await expect(uploadProjectAnimation(ctx(grant()), 'project-a', file(enc('{"a":1}'), 'x.json'), {}, f.deps)).rejects.toMatchObject({ code: 'unsupported_type' })
    expect(f.client.assets.upload).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('refuses empty and oversized files', async () => {
    const f = fakes()
    await expect(uploadProjectAnimation(ctx(grant()), 'project-a', file(new Uint8Array()), {}, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(uploadProjectAnimation(ctx(grant()), 'project-a', file(new Uint8Array(LOTTIE_LIMITS.maxBytes + 1)), {}, f.deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(f.client.assets.upload).not.toHaveBeenCalled()
  })

  it('needs the Media Library permission on the project, and keeps the rate limit', async () => {
    const f = fakes()
    await expect(uploadProjectAnimation(ctx(grant({ permissions: ['blog.post.write'], role: 'editor' })), 'project-a', file(LOTTIE), {}, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    await expect(uploadProjectAnimation(ctx(grant()), 'project-b', file(LOTTIE), {}, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    const limited = fakes({ recentUploads: 10_000 })
    await expect(uploadProjectAnimation(ctx(grant()), 'project-a', file(LOTTIE), {}, limited.deps)).rejects.toBeInstanceOf(PostMediaError)
    expect(f.client.assets.upload).not.toHaveBeenCalled()
    expect(limited.client.assets.upload).not.toHaveBeenCalled()
  })
})

describe('createAnimationAsset', () => {
  it('never runs image optimisation and leaves out unknown facts', async () => {
    const f = fakes()
    const r = await createAnimationAsset(f.client as never, { tenantId: 't', data: Buffer.from(DOTLOTTIE), filename: 'a.lottie', info: { format: 'dotlottie' } }, { now: () => new Date('2026-11-03T10:00:00Z') })
    expect(r).toEqual({ mediaAssetId: 'media-new', fileAssetId: 'file-abc-json', url: 'https://cdn.sanity.io/files/p/d/abc.json', bytes: DOTLOTTIE.length })
    expect(f.client.create.mock.calls[0][0].processing).toEqual({ status: 'ready', finishedAt: '2026-11-03T10:00:00.000Z', optimized: false, originalBytes: DOTLOTTIE.length, finalBytes: DOTLOTTIE.length })
  })
})

describe('listProjectMedia with animations', () => {
  const media = grant({ permissions: ['media.library.manage'] })
  const rows = [
    { _id: 'a1', _createdAt: '2026-11-03T10:00:00Z', projectSlug: 'freeriders', kind: 'animation', url: 'https://cdn.sanity.io/files/p/d/abc.json', width: 900, height: 849, frameRate: 25, frames: 41, name: 'Rider', hotspot: { x: 0.5, y: 0.5 } },
    { _id: 'i1', _createdAt: '2026-11-02T10:00:00Z', projectSlug: 'freeriders', kind: 'image', url: 'https://cdn.sanity.io/images/p/d/x-10x10.jpg', width: 10, height: 10 },
  ]

  it('images only unless asked — the clause is not even in the query', async () => {
    const f = fakes({ rows })
    await listProjectMedia(ctx(media), 'project-a', {}, f.deps, 'media.library.manage')
    expect(f.queries[0]).toContain('defined(image.asset)')
    expect(f.queries[0]).not.toContain('mediaType == "animation" && defined(animation.asset)')
  })

  it('asked: animations come back marked, with no thumbnail and no focal point', async () => {
    const f = fakes({ rows })
    const page = await listProjectMedia(ctx(media), 'project-a', { animations: true }, f.deps, 'media.library.manage')
    expect(f.queries[0]).toContain('|| (mediaType == "animation" && defined(animation.asset))')
    const [anim, img] = page.items
    expect(anim).toMatchObject({ assetId: 'a1', kind: 'animation', url: 'https://cdn.sanity.io/files/p/d/abc.json', thumbUrl: '', focal: null, width: 900, height: 849 })
    expect(anim.seconds).toBeCloseTo(1.64)
    expect(img.kind).toBeUndefined()
    expect(img.thumbUrl).not.toBe('')
  })
})
