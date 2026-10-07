import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { blogAttention, blogGlance } from '../blog'
import { summarizeRequests } from '../forms'
import { galleryAttention, galleryGlance } from '../gallery'
import { altMap, getMediaDashboard, summarizeMedia } from '../media'
import { siteStatusFrom } from '../site'
import { settle } from '../settle'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { DashboardPostList } from '@/lib/api/client-dashboard'
import type { PostDraftSummary } from '@/lib/api/post-drafts'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const iso = (hours: number) => new Date(NOW + hours * 3600_000).toISOString()

describe('blog provider (pure parts)', () => {
  it('counts published, scheduled and never-published drafts once each', () => {
    const posts = [
      { _id: 'a', status: 'published' as const },
      { _id: 'b', status: 'scheduled' as const },
      { _id: 'c', status: 'draft' as const },
    ]
    const drafts = [{ id: 'c', hasLive: false }, { id: 'd', hasLive: false }, { id: 'a', hasLive: true }]
    expect(blogGlance(posts, drafts)).toEqual({ published: 1, scheduled: 1, drafts: 2 })
    expect(blogGlance(posts, null)).toEqual({ published: 1, scheduled: 1, drafts: 1 })
  })

  it('only runs the rules it is given', () => {
    const list = {
      posts: [
        { _id: 'a', status: 'scheduled', publishedAt: iso(3), title: 'Soon', completeLanguages: [] },
        { _id: 'b', status: 'published', title: null, completeLanguages: ['en'] },
      ],
      languages: ['en', 'it'],
      categories: [],
    } as unknown as DashboardPostList
    const drafts = [{ id: 'x', updatedAt: iso(-24 * 30), title: null }] as unknown as PostDraftSummary[]
    const base = { hrefs: { drafts: '/d', scheduled: '/s', missingLanguage: '/m' }, untitled: 'Untitled', when: () => 'soon', now: NOW }
    const all = blogAttention(list, drafts, { ...base, rules: new Set(['stalePostDrafts', 'scheduledSoon', 'missingLanguage'] as const) })
    expect(all.map((i) => i.id)).toEqual(['stalePostDrafts', 'scheduledSoon', 'missingLanguage'])
    expect(all[0].params.title).toBe('Untitled')
    expect(all[2].params.title).toBe('Untitled')
    expect(blogAttention(list, drafts, { ...base, rules: new Set(['scheduledSoon'] as const) }).map((i) => i.id)).toEqual(['scheduledSoon'])
  })
})

describe('forms provider (pure part)', () => {
  it('builds the tile and the attention item from one read', () => {
    const rows = [
      { status: 'new' as const, createdAt: iso(-2) },
      { status: 'processed' as const, createdAt: iso(-24 * 9) },
      { status: 'processed' as const, createdAt: iso(-24 * 20) },
    ]
    const r = summarizeRequests(rows, { limit: 200, attentionHref: '/requests', now: NOW })
    expect(r.glance).toEqual({ week: 1, previousWeek: 1, open: 1 })
    expect(r.attention.map((i) => i.id)).toEqual(['newRequests'])
    expect(summarizeRequests(rows, { limit: 200, attentionHref: null, now: NOW }).attention).toEqual([])
  })
})

describe('gallery provider (pure parts)', () => {
  it('counts and flags old unpublished work', () => {
    const galleries = [
      { isPublished: true, hasDraft: false, updatedAt: iso(-24 * 30), title: 'Live', internalName: '' },
      { isPublished: false, hasDraft: true, updatedAt: iso(-24 * 30), title: '', internalName: 'Inner' },
      { isPublished: true, hasDraft: true, updatedAt: iso(-1), title: 'Fresh changes', internalName: '' },
    ]
    expect(galleryGlance(galleries)).toEqual({ total: 3, live: 2, unpublished: 1 })
    const items = galleryAttention(galleries, '/g', 'Untitled', NOW)
    expect(items).toHaveLength(1)
    expect(items[0].params).toMatchObject({ count: 1, title: 'Inner' })
  })
})

describe('media provider', () => {
  it('reads alt texts in every stored shape', () => {
    expect(altMap({ _type: 'localizedString', en: 'A', it: '' })).toEqual({ en: 'A', it: '' })
    expect(altMap('Legacy')).toEqual({ en: 'Legacy' })
    expect(altMap(null)).toEqual({})
  })

  it('counts photos without a description in the main language', () => {
    const r = summarizeMedia({ defaultLocale: 'it', total: 4, alts: [{ it: 'Ciao' }, { en: 'Hi' }, null, 'Legacy'] }, '/media')
    expect(r.glance).toEqual({ photos: 4, missingAlt: 3 })
    expect(r.attention[0]).toMatchObject({ id: 'missingAltText', params: { count: 3 }, href: '/media' })
    expect(summarizeMedia({ total: 1, alts: [{ en: 'x' }] }, null).attention).toEqual([])
  })

  const ctx = (permissions: string[]): TenantAuthorizationContext => ({
    userId: 'u',
    platformRole: 'user' as never,
    projects: [{ projectId: 'p1', projectSlug: 'abluo' as never, membershipId: 'm', role: 'editor' as never, permissions, enabledModuleIds: [] }],
  })

  it('refuses before any read without media.library.manage (block hidden)', async () => {
    const fetch = vi.fn()
    expect(await getMediaDashboard(ctx(['blog.post.read']), 'p1', { attentionHref: null }, { fetch })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads through the tenant-scoped client (projectSlug forced from the grant)', async () => {
    const fetch = vi.fn().mockResolvedValue({ defaultLocale: 'en', total: 2, alts: [{ en: 'x' }, {}] })
    const r = await getMediaDashboard(ctx(['media.library.manage']), 'p1', { attentionHref: '/m' }, { fetch })
    expect(r?.glance).toEqual({ photos: 2, missingAlt: 1 })
    expect(fetch.mock.calls[0][1]).toMatchObject({ projectSlug: 'abluo' })
  })
})

describe('site status', () => {
  const routes = (status: string) => [
    { host: 'example.com', hostKind: 'custom-domain' as const, status },
    { host: 'example.preview.abluo.app', hostKind: 'preview-subdomain' as const, status },
  ]
  it('live / preview / offline from the routing table', () => {
    expect(siteStatusFrom(routes('active'), null)).toEqual({ state: 'live', host: 'example.com', url: 'https://example.com' })
    expect(siteStatusFrom(routes('active'), 'www.example.com')).toMatchObject({ host: 'www.example.com' })
    expect(siteStatusFrom(routes('preview'), 'example.com')).toEqual({ state: 'preview', host: 'example.preview.abluo.app', url: 'https://example.preview.abluo.app' })
    expect(siteStatusFrom(routes('draft'), null)).toEqual({ state: 'offline', host: null, url: null })
  })
  it('falls back to the domain when the project is not in the table yet', () => {
    expect(siteStatusFrom([], 'example.com')).toMatchObject({ state: 'live', url: 'https://example.com' })
    expect(siteStatusFrom([], null)).toMatchObject({ state: 'offline', url: null })
  })
})

describe('settle', () => {
  it('hides refusals and failures instead of breaking Home', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await settle('x', async () => 1)).toBe(1)
    expect(await settle('x', async () => { throw new TenantAuthorizationError('no') })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(await settle('x', async () => { throw new Error('boom') })).toBeNull()
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })
})
