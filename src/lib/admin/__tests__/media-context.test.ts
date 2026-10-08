/**
 * Admin Media (ADR-030 step 4): the one-project, Media-Library-only context an
 * admin action builds, the project checks, the cross-project paging, and the
 * delete the admin screen adds — all against the SAME library gates the client
 * dashboard uses.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  adminMediaContext,
  adminMediaCursor,
  collectAcrossProjects,
  parseAdminMediaCursor,
  pickAdminProject,
  usableAdminProjects,
  type AdminMediaProject,
} from '../media-context'
import { assertProjectAccess, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { deleteMediaAsset } from '@/lib/api/media-library'
import { GalleryError } from '@/lib/api/gallery-drafts'
import { tenantScopedSanityClient, TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'

const admin = { userId: 'admin-1', platformRole: 'abluo_admin' as const }
const A: AdminMediaProject = { id: 'p-a', slug: 'amelie', name: 'Amélie' }
const B: AdminMediaProject = { id: 'p-b', slug: 'livener', name: 'Livener' }
const C: AdminMediaProject = { id: 'p-c', slug: 'nologo', name: 'No!Logo' }

describe('adminMediaContext', () => {
  it('is only built for an Abluo admin', () => {
    expect(adminMediaContext(null, A)).toBeNull()
    expect(adminMediaContext({ userId: 'u1', platformRole: 'tenant_user' }, A)).toBeNull()
    expect(adminMediaContext({ userId: '', platformRole: 'abluo_admin' }, A)).toBeNull()
  })

  it('holds exactly one synthetic grant, with the Media Library permission only', () => {
    const ctx = adminMediaContext(admin, A)!
    expect(ctx.userId).toBe('admin-1')
    expect(ctx.platformRole).toBe('abluo_admin')
    expect(ctx.tenants).toEqual([])
    expect(ctx.projects).toHaveLength(1)
    expect(ctx.projects[0]).toMatchObject({
      projectId: 'p-a',
      projectSlug: 'amelie',
      membershipId: 'abluo-admin:admin-1',
      permissions: [MEDIA_MANAGE_PERMISSION],
      enabledModuleIds: [],
    })
  })

  it('passes the Media Library gate for its project only, and no module gate', () => {
    const ctx = adminMediaContext(admin, A)!
    expect(assertProjectAccess(ctx, 'p-a', MEDIA_MANAGE_PERMISSION).projectSlug).toBe('amelie')
    expect(() => assertProjectAccess(ctx, 'p-b', MEDIA_MANAGE_PERMISSION)).toThrow(TenantAuthorizationError)
    expect(() => assertProjectAccess(ctx, 'p-a', 'gallery.gallery.write')).toThrow(TenantAuthorizationError)
    expect(() => assertProjectAccess(ctx, 'p-a', 'blog.post.write')).toThrow(TenantAuthorizationError)
  })

  it('scopes Sanity reads to its project (projectSlug forced from the grant)', async () => {
    const fetch = vi.fn(async () => [])
    const scoped = tenantScopedSanityClient(adminMediaContext(admin, A)!, 'p-a', { fetch: fetch as never })
    await scoped.fetch('*[_type == "mediaAsset" && projectSlug == $projectSlug]', { projectSlug: 'livener' })
    expect(fetch).toHaveBeenCalledWith(expect.any(String), { projectSlug: 'amelie' })
    expect(() => tenantScopedSanityClient(adminMediaContext(admin, A)!, 'p-b')).toThrow(TenantAuthorizationError)
  })
})

describe('admin project checks', () => {
  it('keeps valid rows with an unshared slug, A–Z by name', () => {
    const rows = [
      { id: 'p-b', slug: 'livener', name: 'Livener' },
      { id: 'p-a', slug: 'amelie', name: 'Amélie' },
      { id: 'x1', slug: 'main', name: 'Main 1' },
      { id: 'x2', slug: 'main', name: 'Main 2' },
      { id: '', slug: 'broken', name: 'No id' },
      { id: 'p-n', slug: 'noname', name: '' },
      null,
    ]
    expect(usableAdminProjects(rows)).toEqual([A, B, { id: 'p-n', slug: 'noname', name: 'noname' }])
  })

  it('picks a project by slug, failing closed on unknown, empty or shared slugs', () => {
    expect(pickAdminProject([A, B], 'amelie')).toEqual(A)
    expect(pickAdminProject([A, B], 'nope')).toBeNull()
    expect(pickAdminProject([A, B], '')).toBeNull()
    expect(pickAdminProject([A, B], null)).toBeNull()
    expect(pickAdminProject([A, { ...B, slug: 'amelie' }], 'amelie')).toBeNull()
  })
})

describe('cross-project cursor', () => {
  it('round-trips, keeping the inner cursor intact', () => {
    const inner = '2026-10-01T10:00:00.000Z|m-42'
    expect(parseAdminMediaCursor(adminMediaCursor('amelie', inner))).toEqual({ slug: 'amelie', inner })
    expect(parseAdminMediaCursor(adminMediaCursor('amelie', null))).toEqual({ slug: 'amelie', inner: null })
  })

  it('rejects malformed cursors', () => {
    expect(parseAdminMediaCursor('')).toBeNull()
    expect(parseAdminMediaCursor('::x')).toBeNull()
    expect(parseAdminMediaCursor('no separator')).toBeNull()
    expect(parseAdminMediaCursor('bad slug!::')).toBeNull()
    expect(parseAdminMediaCursor(42)).toBeNull()
  })
})

describe('collectAcrossProjects', () => {
  const pages: Record<string, Record<string, { items: string[]; nextCursor: string | null; tags: string[] }>> = {
    amelie: { '': { items: ['a1', 'a2'], nextCursor: 'ca', tags: ['beach'] }, ca: { items: ['a3'], nextCursor: null, tags: ['beach'] } },
    livener: { '': { items: [], nextCursor: null, tags: [] } },
    nologo: { '': { items: ['n1', 'n2'], nextCursor: null, tags: ['logo', 'beach'] } },
  }
  const fetchPage = async (p: AdminMediaProject, inner: string | null) => pages[p.slug][inner ?? '']

  it('walks projects in order until the page is full, and resumes from the cursor', async () => {
    const first = await collectAcrossProjects({ projects: [A, B, C], cursor: null, pageSize: 2, fetchPage })
    expect(first!.items.map((i) => `${i.project.slug}/${i.item}`)).toEqual(['amelie/a1', 'amelie/a2'])
    expect(first!.nextCursor).toBe('amelie::ca')

    const second = await collectAcrossProjects({ projects: [A, B, C], cursor: parseAdminMediaCursor(first!.nextCursor), pageSize: 2, fetchPage })
    expect(second!.items.map((i) => `${i.project.slug}/${i.item}`)).toEqual(['amelie/a3', 'nologo/n1', 'nologo/n2'])
    expect(second!.nextCursor).toBeNull()
    expect(second!.tags).toEqual(['beach', 'logo'])
  })

  it('skips a project whose page fails', async () => {
    const onSkip = vi.fn()
    const r = await collectAcrossProjects({
      projects: [A, C],
      cursor: null,
      pageSize: 10,
      fetchPage: async (p, inner) => {
        if (p.slug === 'amelie') throw new Error('boom')
        return fetchPage(p, inner)
      },
      onSkip,
    })
    expect(r!.items.map((i) => i.item)).toEqual(['n1', 'n2'])
    expect(onSkip).toHaveBeenCalledWith(A, expect.any(Error))
  })

  it('refuses a cursor naming a project that is not listed', async () => {
    expect(await collectAcrossProjects({ projects: [A], cursor: { slug: 'gone', inner: null }, pageSize: 2, fetchPage })).toBeNull()
  })
})

describe('deleteMediaAsset (admin delete, Media Library gate)', () => {
  const client = (o: { asset?: unknown; refs?: unknown; deleteError?: unknown } = {}) => ({
    getDocument: vi.fn(async () => ('asset' in o ? o.asset : { _id: 'm1', _type: 'mediaAsset', projectSlug: 'amelie' })),
    fetch: vi.fn(async (q: string) => (q.includes('references(') ? ('refs' in o ? o.refs : 0) : 1)),
    delete: vi.fn(async () => {
      if (o.deleteError) throw o.deleteError
      return {}
    }),
  })
  const ctx = () => adminMediaContext(admin, A)!

  it('deletes an unused photo of the project', async () => {
    const c = client()
    expect(await deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: c as never })).toEqual({ assetId: 'm1' })
    expect(c.delete).toHaveBeenCalledWith('m1')
  })

  it('counts references from drafts and versions too (raw perspective)', async () => {
    const c = client()
    await deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: c as never })
    expect(c.fetch).toHaveBeenCalledWith(expect.stringContaining('references('), { id: 'm1' }, { perspective: 'raw' })
  })

  it("also counts this project's content that uses the photo's image asset directly", async () => {
    const asset = { _id: 'm1', _type: 'mediaAsset', projectSlug: 'amelie', image: { asset: { _ref: 'image-abc-10x10-jpg' } } }
    const c = client({ asset, refs: 1 })
    await expect(deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: c as never })).rejects.toMatchObject({ code: 'in_use' })
    expect(c.fetch).toHaveBeenCalledWith(
      expect.stringContaining('references($ref) && projectSlug == $projectSlug && _type != "mediaAsset"'),
      { id: 'm1', ref: 'image-abc-10x10-jpg', projectSlug: 'amelie' },
      { perspective: 'raw' }
    )
    expect(c.delete).not.toHaveBeenCalled()
  })

  it('refuses before any read without the grant', async () => {
    const c = client()
    await expect(deleteMediaAsset(ctx(), 'p-b', { assetId: 'm1' }, { client: c as never })).rejects.toThrow(TenantAuthorizationError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it("never deletes another project's asset, a non-media document or a bad id", async () => {
    for (const asset of [{ _type: 'mediaAsset', projectSlug: 'livener' }, { _type: 'post', projectSlug: 'amelie' }, undefined]) {
      const c = client({ asset })
      await expect(deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: c as never })).rejects.toMatchObject({ code: 'not_found' })
      expect(c.delete).not.toHaveBeenCalled()
    }
    await expect(deleteMediaAsset(ctx(), 'p-a', { assetId: 'drafts.m1' }, { client: client() as never })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses a photo that is still referenced (in_use), also when Sanity refuses', async () => {
    const c = client({ refs: 2 })
    await expect(deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: c as never })).rejects.toMatchObject({ code: 'in_use' })
    expect(c.delete).not.toHaveBeenCalled()
    const late = client({ deleteError: Object.assign(new Error('ref'), { statusCode: 409 }) })
    await expect(deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: late as never })).rejects.toBeInstanceOf(GalleryError)
    await expect(deleteMediaAsset(ctx(), 'p-a', { assetId: 'm1' }, { client: client({ deleteError: Object.assign(new Error('ref'), { statusCode: 409 }) }) as never })).rejects.toMatchObject({ code: 'in_use' })
  })
})
