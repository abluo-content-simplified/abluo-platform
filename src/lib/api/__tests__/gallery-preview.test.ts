/** The gallery preview link: gate, ownership, page check, token kind. */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { mintGalleryPreview, pageShowsGallery } from '../gallery-preview'
import { verifyDraftPreviewToken } from '@/lib/preview/draft-preview-token'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const secret = Buffer.from('test-secret-test-secret-test-secret')
const NOW = Date.UTC(2026, 9, 6, 10, 0, 0)
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['gallery.gallery.read', 'gallery.gallery.write'],
  enabledModuleIds: ['gallery'],
  ...o,
})
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

function client(docs: Record<string, unknown>, pageHit: string | null = 'page-home') {
  return {
    getDocument: vi.fn(async (id: string) => (docs[id] ?? undefined) as never),
    fetch: vi.fn(async (q: string) => (q.includes('references($galleryId)') ? pageHit : { themeMode: 'darkOnly', hasLight: false })),
  }
}
const own = { 'drafts.g1': { _type: 'gallery', projectSlug: 'hoffmann' } }
const mint = (c: ReturnType<typeof client>, input: Record<string, unknown> = {}, g = grant()) =>
  mintGalleryPreview(ctx(g), 'project-a', { id: 'g1', ...input } as never, { client: c as never, secret, now: NOW })

describe('mintGalleryPreview', () => {
  it('mints a gallery token (no page) for this project’s gallery draft', async () => {
    const r = await mint(client(own))
    expect(r).toMatchObject({ projectSlug: 'hoffmann', pageId: null, origin: '', themes: ['dark'] })
    expect(verifyDraftPreviewToken(r.token, { secret, now: NOW + 1000 })).toMatchObject({ kind: 'gallery', draftId: 'g1', pageId: null })
  })

  it('falls back to the published gallery; with a page, only one that shows it', async () => {
    const c = client({ g1: { _type: 'gallery', projectSlug: 'hoffmann' } })
    const r = await mint(c, { pageId: 'page-home' })
    expect(verifyDraftPreviewToken(r.token, { secret, now: NOW + 1000 })).toMatchObject({ pageId: 'page-home' })
    await expect(mint(client(own, null), { pageId: 'page-other' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it("another project's gallery, a non-gallery and unsafe ids are not_found", async () => {
    await expect(mint(client({ 'drafts.g1': { _type: 'gallery', projectSlug: 'livener' } }))).rejects.toMatchObject({ code: 'not_found' })
    await expect(mint(client({ 'drafts.g1': { _type: 'post', projectSlug: 'hoffmann' } }))).rejects.toMatchObject({ code: 'not_found' })
    const c = client(own)
    await expect(mint(c, { id: '../g1' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(mint(c, { pageId: 'a/b' })).rejects.toMatchObject({ code: 'not_found' })
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it('no secret → unavailable', async () => {
    await expect(
      mintGalleryPreview(ctx(grant()), 'project-a', { id: 'g1' }, { client: client(own) as never, secret: null, now: NOW })
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it.each([
    ['a viewer', grant({ role: 'viewer', permissions: ['gallery.gallery.read'] }), 'project-a'],
    ['gallery not installed', grant({ enabledModuleIds: ['blog'] }), 'project-a'],
    ["another tenant's project", grant(), 'project-b'],
  ])('refuses %s before any read', async (_l, g, projectId) => {
    const c = client(own)
    await expect(mintGalleryPreview(ctx(g), projectId, { id: 'g1' }, { client: c as never, secret, now: NOW })).rejects.toThrow(TenantAuthorizationError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it('pageShowsGallery asks one project-scoped references() question', async () => {
    const c = client(own)
    expect(await pageShowsGallery(c as never, 'page-home', 'g1', 'hoffmann')).toBe(true)
    const [q, p] = c.fetch.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(q).toContain('projectSlug == $projectSlug && references($galleryId)')
    expect(p).toEqual({ pageId: 'page-home', galleryId: 'g1', projectSlug: 'hoffmann' })
  })
})
