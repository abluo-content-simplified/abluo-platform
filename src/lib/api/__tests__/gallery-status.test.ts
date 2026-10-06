/**
 * Gallery status: where a gallery is used, and what still needs attention.
 * Read-only; project-scoped; identity from the grant.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { getGalleryStatuses } from '../gallery-status'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'viewer',
  permissions: ['gallery.gallery.read'],
  enabledModuleIds: ['gallery'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

const gal = (id: string, refs: string[], projectSlug = 'hoffmann') => ({ _id: id, projectSlug, refs })
const ALT: Record<string, unknown> = {
  m1: { it: 'Sala', de: 'Raum' },
  m2: { it: 'Studio' },
  m3: { de: 'nur deutsch' },
  m4: { it: 'Altro' },
}

function fake(opts: { galleries?: unknown[]; usage?: unknown[] } = {}) {
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de', 'en'] }
    if (q.includes('_type == "gallery"')) return opts.galleries ?? [gal('g1', ['m1', 'm2', 'm3'])]
    if (q.includes('_type == "mediaAsset"')) return (p.ids as string[]).map((id) => ({ _id: id, altText: ALT[id] }))
    if (q.includes('references($ids)')) return opts.usage ?? []
    throw new Error(`unexpected query ${q}`)
  })
  return { fetch, deps: { client: { fetch } as never } }
}

describe('getGalleryStatuses', () => {
  it('counts photos, missing descriptions and missing translations per language', async () => {
    const f = fake()
    const s = await getGalleryStatuses(ctx(grant()), 'project-a', undefined, f.deps)
    expect(s.g1).toMatchObject({
      photos: 3,
      missingDescription: 1, // m3 has no Italian (main) description
      missingTranslation: { de: 1, en: 2 }, // m2 lacks de + en; m1 lacks en
    })
    expect(s.g1.usedOn).toEqual({ pages: [], posts: { published: 0, draft: 0 } })
  })

  it('lists pages (published or draft) and counts posts', async () => {
    const f = fake({
      usage: [
        { _id: 'page-1', _type: 'page', projectSlug: 'hoffmann', title: { it: 'Home', en: 'Home page' }, refs: ['g1'] },
        { _id: 'drafts.page-1', _type: 'page', projectSlug: 'hoffmann', title: { it: 'Home' }, refs: ['g1'] },
        { _id: 'drafts.page-2', _type: 'page', projectSlug: 'hoffmann', title: { it: 'Chi siamo' }, refs: ['g1'] },
        { _id: 'post-1', _type: 'post', projectSlug: 'hoffmann', title: {}, refs: ['g1'] },
        { _id: 'post-2', _type: 'post', projectSlug: 'hoffmann', title: {}, refs: ['g1'] },
        { _id: 'drafts.post-3', _type: 'post', projectSlug: 'hoffmann', title: {}, refs: ['g1'] },
        { _id: 'page-9', _type: 'page', projectSlug: 'hoffmann', title: { it: 'Altro' }, refs: ['other-gallery'] },
        { _id: 'page-x', _type: 'page', projectSlug: 'livener', title: { it: 'Foreign' }, refs: ['g1'] },
      ],
    })
    const s = await getGalleryStatuses(ctx(grant()), 'project-a', undefined, f.deps)
    expect(s.g1.usedOn.pages).toEqual([
      { id: 'page-1', title: 'Home', published: true },
      { id: 'page-2', title: 'Chi siamo', published: false },
    ])
    expect(s.g1.usedOn.posts).toEqual({ published: 2, draft: 1 })
  })

  it('uses the draft photos when there is a draft, and honours the id filter', async () => {
    const f = fake({ galleries: [gal('g1', ['m1']), gal('drafts.g1', ['m1', 'm4']), gal('g2', ['m1'])] })
    const s = await getGalleryStatuses(ctx(grant()), 'project-a', ['g1'], f.deps)
    expect(Object.keys(s)).toEqual(['g1'])
    expect(s.g1.photos).toBe(2)
  })

  it("ignores another project's documents", async () => {
    const f = fake({ galleries: [gal('g1', ['m1']), gal('g9', ['m1'], 'livener')] })
    const s = await getGalleryStatuses(ctx(grant()), 'project-a', undefined, f.deps)
    expect(Object.keys(s)).toEqual(['g1'])
    for (const [, params] of f.fetch.mock.calls) expect((params as { projectSlug: string }).projectSlug).toBe('hoffmann')
  })

  it('is refused before any I/O without read permission or for another project', async () => {
    const f = fake()
    await expect(getGalleryStatuses(ctx(grant({ permissions: [] })), 'project-a', undefined, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(getGalleryStatuses(ctx(grant({ enabledModuleIds: ['blog'] })), 'project-a', undefined, f.deps)).rejects.toThrow(TenantAuthorizationError)
    await expect(getGalleryStatuses(ctx(grant()), 'project-b', undefined, f.deps)).rejects.toThrow(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('turns a failing read into an opaque error', async () => {
    const f = fake()
    f.fetch.mockRejectedValueOnce(new Error('boom: secret detail'))
    await expect(getGalleryStatuses(ctx(grant()), 'project-a', undefined, f.deps)).rejects.toMatchObject({ code: 'failed', message: 'Could not read gallery status.' })
  })
})
