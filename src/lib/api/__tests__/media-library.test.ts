/**
 * The Media screen: gated by the Media Library rule (owner/editor, no module
 * needed), project-scoped reads, "Used in …", and photo edits through the
 * shared asset writer.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { assertProjectAccess, grantCanManageMedia, MEDIA_MANAGE_PERMISSION } from '../media-permission'
import { getMediaSite, imageRefFromUrl, listMediaLibrary, mediaUsage, mediaUsageKind } from '../media-library'
import { updateGalleryPhoto } from '../gallery-photos'
import { POST_MEDIA_LIMITS } from '../post-media'
import { mediaNavItems } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import { grantPermissions, type ProjectGrant, type TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

// Permissions come from the real resolver for the role (ADR-028), unless a test overrides them.
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('amelie'),
  membershipId: 'm1',
  role: 'editor',
  enabledModuleIds: [], // the Media Library needs no module
  ...o,
  permissions: o.permissions ?? grantPermissions(o.role ?? 'editor', o.enabledModuleIds ?? []),
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })
const URL1 = 'https://cdn.sanity.io/images/3n7t84j3/production/66a8b9bcfe43b1394d24c10e3effe6e0f5f4cb27-2560x1707.jpg'

describe('Media Library gate', () => {
  it('owners and editors may manage media without any module; viewers may not', () => {
    expect(assertProjectAccess(ctx(grant()), 'project-a', MEDIA_MANAGE_PERMISSION).projectSlug).toBe('amelie')
    expect(assertProjectAccess(ctx(grant({ role: 'owner' })), 'project-a', MEDIA_MANAGE_PERMISSION).role).toBe('owner')
    expect(() => assertProjectAccess(ctx(grant({ role: 'viewer' })), 'project-a', MEDIA_MANAGE_PERMISSION)).toThrow(TenantAuthorizationError)
    expect(() => assertProjectAccess(ctx(grant()), 'project-b', MEDIA_MANAGE_PERMISSION)).toThrow(TenantAuthorizationError)
    expect(grantCanManageMedia({ permissions: grantPermissions('viewer', []) })).toBe(false)
  })

  it('module permissions still go through assertModuleAction', () => {
    expect(() => assertProjectAccess(ctx(grant()), 'project-a', 'gallery.gallery.write')).toThrow(TenantAuthorizationError)
  })

  it('shows the Media nav item to owners and editors only', () => {
    expect(mediaNavItems(grant())).toEqual([{ moduleId: 'media', labelKey: 'clientDashboard.nav.media', href: '/amelie/media' }])
    expect(mediaNavItems(grant({ role: 'viewer' }))).toEqual([])
  })

  it('allows 300 uploads per user per project per day', () => {
    expect(POST_MEDIA_LIMITS.uploadsPerWindow).toBe(300)
    expect(POST_MEDIA_LIMITS.uploadWindowMs).toBe(24 * 60 * 60 * 1000)
  })
})

describe('imageRefFromUrl', () => {
  it('maps a Sanity CDN URL to its image asset id', () => {
    expect(imageRefFromUrl(URL1)).toBe('image-66a8b9bcfe43b1394d24c10e3effe6e0f5f4cb27-2560x1707-jpg')
    expect(imageRefFromUrl(`${URL1}?w=320`)).toBe('image-66a8b9bcfe43b1394d24c10e3effe6e0f5f4cb27-2560x1707-jpg')
    expect(imageRefFromUrl('https://evil.example/x.jpg')).toBeNull()
  })
})

describe('mediaUsage', () => {
  it('one scoped request; maps galleries, pages and posts (incl. blog covers) per asset', async () => {
    const fetch = vi.fn(async (q: string, p: Record<string, unknown>) => {
      expect(q).toContain('projectSlug == $projectSlug')
      expect(q).not.toContain('m1') // ids only ever travel as params
      expect(p).toMatchObject({ projectSlug: 'amelie', a0: 'm1', r0: 'image-66a8b9bcfe43b1394d24c10e3effe6e0f5f4cb27-2560x1707-jpg', a1: 'm2', r1: '-' })
      return {
        u0: [
          { _id: 'g1', _type: 'gallery', title: null, internalName: 'Studio' },
          { _id: 'p1', _type: 'post', title: { it: 'Un articolo', en: 'A post' } },
        ],
        u1: [],
      }
    })
    const used = await mediaUsage({ fetch } as never, 'amelie', [{ assetId: 'm1', url: URL1 }, { assetId: 'm2', url: 'x' }], 'it')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(used.get('m1')).toEqual([
      { kind: 'gallery', id: 'g1', title: 'Studio' },
      { kind: 'post', id: 'p1', title: 'Un articolo' },
    ])
    expect(used.get('m2')).toEqual([])
  })

  it('also finds content that references the image ASSET directly (backfilled photos), project-scoped', async () => {
    const fetch = vi.fn(async (q: string, p: Record<string, unknown>) => {
      // every subquery is scoped to the project and skips the mediaAsset itself
      expect(q.match(/projectSlug == \$projectSlug/g)).toHaveLength(1)
      expect(q).toContain('_type != "mediaAsset"')
      expect(q).toContain('references($a0) || references($r0)')
      expect(q).not.toContain('image-66a8') // the asset id travels as a param only
      expect(p).toMatchObject({ projectSlug: 'livener', a0: 'mediaAsset-backfill-livener-x', r0: 'image-66a8b9bcfe43b1394d24c10e3effe6e0f5f4cb27-2560x1707-jpg' })
      return {
        u0: [
          { _id: 'home', _type: 'homePage', title: { en: 'Home' } },
          { _id: 'p2', _type: 'page', internalName: 'About' },
          { _id: 'ev1', _type: 'event', title: { en: 'Open day', it: 'Porte aperte' } },
          { _id: 'site', _type: 'siteConfig', siteName: 'Livener' },
          { _id: 'cta', _type: 'callToAction', name: 'Book' },
          { _id: 'p2', _type: 'page', internalName: 'About' }, // duplicates are dropped
        ],
      }
    })
    const used = await mediaUsage({ fetch } as never, 'livener', [{ assetId: 'mediaAsset-backfill-livener-x', url: URL1 }], 'it')
    expect(used.get('mediaAsset-backfill-livener-x')).toEqual([
      { kind: 'page', id: 'home', title: 'Home' },
      { kind: 'page', id: 'p2', title: 'About' },
      { kind: 'event', id: 'ev1', title: 'Porte aperte' },
      { kind: 'settings', id: 'site', title: 'Livener' },
      { kind: 'other', id: 'cta', title: 'Book' },
    ])
  })

  it('makes no request for an empty page', async () => {
    const fetch = vi.fn()
    expect((await mediaUsage({ fetch } as never, 'amelie', [], 'en')).size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('mediaUsageKind', () => {
  it('labels every document type', () => {
    expect(mediaUsageKind('gallery')).toBe('gallery')
    expect(mediaUsageKind('post')).toBe('post')
    for (const t of ['page', 'homePage', 'blogPage', 'eventsPage', 'newsPage', 'livePage']) expect(mediaUsageKind(t)).toBe('page')
    expect(mediaUsageKind('event')).toBe('event')
    expect(mediaUsageKind('siteConfig')).toBe('settings')
    expect(mediaUsageKind('designSystem')).toBe('other')
  })
})

describe('listMediaLibrary', () => {
  it('lists this project only and adds where each photo is used', async () => {
    const scopedFetch = vi.fn(async (_q: string, p: Record<string, unknown>) => {
      expect(p.projectSlug).toBe('amelie')
      return [{ _id: 'm1', _rev: 'r1', _createdAt: '2026-10-01T10:00:00Z', url: URL1, alt: { en: 'A' }, tags: ['x'] }]
    })
    const client = {
      fetch: vi.fn(async (q: string) => (q.includes('siteConfig') ? { defaultLocale: 'en' } : { u0: [{ _id: 'g1', _type: 'gallery', internalName: 'G' }] })),
    }
    const r = await listMediaLibrary(ctx(grant()), 'project-a', {}, { fetch: scopedFetch as never, client: client as never })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ assetId: 'm1', rev: 'r1', tags: ['x'], usedIn: [{ kind: 'gallery', id: 'g1', title: 'G' }] })
  })

  it('refuses a viewer before any read', async () => {
    const scopedFetch = vi.fn()
    const client = { fetch: vi.fn() }
    await expect(listMediaLibrary(ctx(grant({ role: 'viewer' })), 'project-a', {}, { fetch: scopedFetch as never, client: client as never })).rejects.toThrow(
      TenantAuthorizationError
    )
    await expect(getMediaSite(ctx(grant({ role: 'viewer' })), 'project-a', { client: client as never })).rejects.toThrow(TenantAuthorizationError)
    expect(scopedFetch).not.toHaveBeenCalled()
    expect(client.fetch).not.toHaveBeenCalled()
  })
})

describe('updateGalleryPhoto with the Media Library gate', () => {
  const asset = { _id: 'm1', _type: 'mediaAsset', _rev: 'a1', projectSlug: 'amelie' }
  const client = () => {
    const patch = vi.fn(() => {
      const p = { ifRevisionId: () => p, set: () => p, commit: vi.fn(async () => ({ _rev: 'a2' })) }
      return p
    })
    return {
      getDocument: vi.fn(async () => asset),
      fetch: vi.fn(async (q: string) => (q.includes('count(') ? 1 : q.includes('siteConfig') ? { defaultLocale: 'en', supportedLocales: ['en'] } : URL1)),
      patch,
    }
  }

  it('an editor without the Gallery module can edit a photo from the Media screen', async () => {
    const c = client()
    const r = await updateGalleryPhoto(ctx(grant()), 'project-a', { assetId: 'm1', alt: { en: 'A photo' } }, { client: c as never }, MEDIA_MANAGE_PERMISSION)
    expect(r.rev).toBe('a2')
  })

  it('a viewer cannot, and the gallery gate still needs the module', async () => {
    const c = client()
    await expect(
      updateGalleryPhoto(ctx(grant({ role: 'viewer' })), 'project-a', { assetId: 'm1', alt: { en: 'x' } }, { client: c as never }, MEDIA_MANAGE_PERMISSION)
    ).rejects.toThrow(TenantAuthorizationError)
    await expect(updateGalleryPhoto(ctx(grant()), 'project-a', { assetId: 'm1', alt: { en: 'x' } }, { client: c as never })).rejects.toThrow(
      TenantAuthorizationError
    )
    expect(c.getDocument).not.toHaveBeenCalled()
  })
})
