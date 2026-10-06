import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { batchUpdatePhotos, cleanTags, updateGalleryPhoto, PHOTO_LIMITS } from '../gallery-photos'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['gallery.gallery.read', 'gallery.gallery.write'],
  enabledModuleIds: ['gallery'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

function fake(asset: Record<string, unknown> | undefined = {
  _id: 'm1',
  _type: 'mediaAsset',
  _rev: 'a1',
  projectSlug: 'hoffmann',
  altText: { it: 'Vecchio' },
  image: { hotspot: { x: 0.5, y: 0.5, width: 0.4, height: 0.2 } },
}) {
  const ops: Array<[string, unknown]> = []
  const patch = vi.fn((id: string) => {
    ops.push(['patch', id])
    const p = {
      ifRevisionId: (r: string) => (ops.push(['ifRevisionId', r]), p),
      set: (v: unknown) => (ops.push(['set', v]), p),
      commit: vi.fn(async () => (ops.push(['commit', null]), { _rev: 'a2' })),
    }
    return p
  })
  const fetch = vi.fn(async (q: string) => {
    if (q.includes('count(*[_type == "project"')) return 1
    if (q.includes('siteConfig')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
    if (q.includes('image.asset->url')) return 'https://cdn.sanity.io/images/x/y/m1.jpg'
    throw new Error(q)
  })
  const client = { getDocument: vi.fn(async () => asset), fetch, patch }
  return { client, ops, deps: { client: client as never } }
}
const update = (f: ReturnType<typeof fake>, input: Record<string, unknown>, g = grant()) =>
  updateGalleryPhoto(ctx(g), 'project-a', { assetId: 'm1', ...input } as never, f.deps)

describe('updateGalleryPhoto', () => {
  it('writes the photo facts to the Media Library asset, guarded by its revision', async () => {
    const f = fake()
    const r = await update(f, {
      rev: 'a1',
      alt: { it: ' Sala   d’attesa ', de: '' },
      title: { de: 'Wartezimmer' },
      caption: {},
      tags: ['Studio', 'studio', ' Esterni '],
      focal: { x: 0.25, y: 0.123456 },
    })
    expect(f.ops).toEqual([
      ['patch', 'm1'],
      ['ifRevisionId', 'a1'],
      [
        'set',
        {
          altText: { _type: 'localizedString', it: 'Sala d’attesa' },
          title: { _type: 'localizedString', de: 'Wartezimmer' },
          caption: { _type: 'localizedString' },
          tags: ['studio', 'esterni'],
          'image.hotspot': { _type: 'sanity.imageHotspot', x: 0.25, y: 0.1235, width: 0.4, height: 0.2 },
        },
      ],
      ['commit', null],
    ])
    expect(r.rev).toBe('a2')
    expect(r.photo).toMatchObject({ assetId: 'm1', alt: { it: 'Sala d’attesa' }, tags: ['studio', 'esterni'], focal: { x: 0.25, y: 0.1235 } })
    expect(r.photo.thumbUrl).toContain('crop=focalpoint')
  })

  it('writes the name (not translated) and returns it', async () => {
    const f = fake()
    const r = await update(f, { name: '  Summer   party 1 ' })
    expect(f.ops[2]).toEqual(['set', { name: 'Summer party 1' }])
    expect(r.photo.name).toBe('Summer party 1')
  })

  it('leaves untouched fields alone', async () => {
    const f = fake()
    await update(f, { tags: [] })
    expect(f.ops[2]).toEqual(['set', { tags: [] }])
  })

  it.each([
    ['a viewer', grant({ role: 'viewer', permissions: ['gallery.gallery.read'] })],
    ['a site without Gallery', grant({ enabledModuleIds: [] })],
  ])('refuses %s before reading', async (_l, g) => {
    const f = fake()
    await expect(update(f, { alt: { it: 'x' } }, g)).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it.each([
    ["another project's asset", { _id: 'm1', _type: 'mediaAsset', _rev: 'a1', projectSlug: 'livener' }],
    ['a document that is not a media asset', { _id: 'm1', _type: 'post', _rev: 'a1', projectSlug: 'hoffmann' }],
    ['a missing asset', null],
  ])('reports %s as not_found without writing', async (_l, asset) => {
    const f = fake(asset as never)
    await expect(update(f, { alt: { it: 'x' } })).rejects.toMatchObject({ code: 'not_found' })
    expect(f.client.patch).not.toHaveBeenCalled()
  })

  it.each([
    ['a foreign language', { alt: { fr: 'x' } }],
    ['too long alt', { alt: { it: 'x'.repeat(PHOTO_LIMITS.alt + 1) } }],
    ['too long name', { name: 'x'.repeat(PHOTO_LIMITS.name + 1) }],
    ['too long caption', { caption: { it: 'x'.repeat(PHOTO_LIMITS.caption + 1) } }],
    ['too many tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['an unsafe tag', { tags: ['" || true'] }],
    ['a bad focal point', { focal: { x: 2, y: 0 } }],
    ['nothing', {}],
  ])('refuses %s', async (_l, input) => {
    const f = fake()
    await expect(update(f, input)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.client.patch).not.toHaveBeenCalled()
  })

  it('a stale revision is a conflict', async () => {
    const f = fake()
    await expect(update(f, { rev: 'old', alt: { it: 'x' } })).rejects.toMatchObject({ code: 'conflict' })
    expect(f.client.patch).not.toHaveBeenCalled()
  })
})

describe('cleanTags', () => {
  it('lower-cases, trims, de-duplicates and drops blanks', () => {
    expect(cleanTags([' A ', 'a', '', 'b c'])).toEqual(['a', 'b c'])
  })
})

describe('batchUpdatePhotos', () => {
  type Row = { _id: string; _rev: string; _type: string; projectSlug: string; tags?: string[] }
  function fakeBatch(rows: Row[], commitError?: unknown) {
    const tx: Array<[string, unknown]> = []
    const transaction = vi.fn(() => {
      const t = {
        patch: (id: string, op: unknown) => (tx.push([id, op]), t),
        commit: vi.fn(async () => {
          if (commitError) throw commitError
          return {}
        }),
      }
      return t
    })
    const fetch = vi.fn(async (q: string, p?: { ids?: string[] }) => {
      if (q.includes('count(*[_type == "project"')) return 1
      if (q.startsWith('*[_id in $ids]')) return rows.filter((r) => p?.ids?.includes(r._id))
      if (q.includes('{ _id, _rev, name }')) return (p?.ids ?? []).map((id) => ({ _id: id, _rev: `${id}-new`, name: `stored ${id}` }))
      throw new Error(q)
    })
    const client = { getDocument: vi.fn(), fetch, patch: vi.fn(), transaction }
    return { client, tx, deps: { client: client as never } }
  }
  const row = (id: string, o: Partial<Row> = {}): Row => ({ _id: id, _rev: `${id}-r`, _type: 'mediaAsset', projectSlug: 'hoffmann', ...o })
  const run = (f: ReturnType<typeof fakeBatch>, input: Record<string, unknown>, g = grant()) =>
    batchUpdatePhotos(ctx(g), 'project-a', input as never, f.deps)

  it('names in order and merges tags, one revision-guarded transaction', async () => {
    const f = fakeBatch([row('a', { tags: ['studio'] }), row('b')])
    const r = await run(f, { assetIds: ['a', 'b'], baseName: ' Summer party ', addTags: ['Party', 'studio'] })
    expect(f.tx).toEqual([
      ['a', { ifRevisionID: 'a-r', set: { name: 'Summer party 1', tags: ['studio', 'party'] } }],
      ['b', { ifRevisionID: 'b-r', set: { name: 'Summer party 2', tags: ['party', 'studio'] } }],
    ])
    expect(r.results).toEqual([
      { assetId: 'a', ok: true, rev: 'a-new', name: 'stored a', tags: ['studio', 'party'] },
      { assetId: 'b', ok: true, rev: 'b-new', name: 'stored b', tags: ['party', 'studio'] },
    ])
  })

  it('checks every asset: another project, another type or a missing id are skipped as not_found', async () => {
    const f = fakeBatch([row('a'), row('b', { projectSlug: 'livener' }), row('c', { _type: 'post' })])
    const r = await run(f, { assetIds: ['a', 'b', 'c', 'd'], addTags: ['x'] })
    expect(f.tx.map(([id]) => id)).toEqual(['a'])
    expect(r.results.filter((x) => !x.ok).map((x) => x.assetId)).toEqual(['b', 'c', 'd'])
  })

  it('a photo that would pass 10 tags is left alone', async () => {
    const f = fakeBatch([row('a', { tags: Array.from({ length: 10 }, (_, i) => `t${i}`) })])
    const r = await run(f, { assetIds: ['a'], addTags: ['new'] })
    expect(r.results).toEqual([{ assetId: 'a', ok: false, code: 'invalid_value' }])
    expect(f.client.transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['no photos', { assetIds: [], addTags: ['x'] }],
    ['more than 100 photos', { assetIds: Array.from({ length: PHOTO_LIMITS.batch + 1 }, (_, i) => `a${i}`), addTags: ['x'] }],
    ['duplicate ids', { assetIds: ['a', 'a'], addTags: ['x'] }],
    ['a bad id', { assetIds: ['*'], addTags: ['x'] }],
    ['an empty base name', { assetIds: ['a'], baseName: '  ' }],
    ['nothing to do', { assetIds: ['a'] }],
  ])('refuses %s before reading', async (_l, input) => {
    const f = fakeBatch([row('a')])
    await expect(run(f, input)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.client.fetch).not.toHaveBeenCalled()
  })

  it('refuses a viewer before reading', async () => {
    const f = fakeBatch([row('a')])
    await expect(run(f, { assetIds: ['a'], addTags: ['x'] }, grant({ role: 'viewer', permissions: ['gallery.gallery.read'] }))).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.fetch).not.toHaveBeenCalled()
  })

  it('a revision clash is a conflict', async () => {
    const f = fakeBatch([row('a')], { statusCode: 409 })
    await expect(run(f, { assetIds: ['a'], baseName: 'x' })).rejects.toMatchObject({ code: 'conflict' })
  })
})
