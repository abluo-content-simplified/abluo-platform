/**
 * Links round 2 — "A page on your site" search. Gate, scoping and bounded input.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/sanity/client', () => ({ sanityClient: {}, findTenantScopeViolation: (q: string) => (q.includes('$projectSlug') ? null : { message: 'unscoped' }) }))

import { searchLinkTargets, PostLinkSearchError, LINK_SEARCH_LIMITS } from '../post-link-search'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
  ...o,
})
const ctx = (...grants: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: grants })

const ROWS = [
  { _id: 'hoffmann-page-home', _type: 'page', pageType: 'home', projectSlug: 'hoffmann', title: 'Home', slug: 'home' },
  { _id: 'hoffmann-page-chi-sono', _type: 'page', projectSlug: 'hoffmann', title: 'Chi sono', slug: 'chi-sono' },
  { _id: 'hoffmann-post-x', _type: 'post', projectSlug: 'hoffmann', title: 'Ansia', slug: 'ansia' },
  { _id: 'hoffmann-post-untranslated', _type: 'post', projectSlug: 'hoffmann', title: 'Senza slug', slug: null },
  { _id: 'weird', _type: 'author', projectSlug: 'hoffmann', title: 'Nope', slug: 'nope' },
]
const fetcher = () => vi.fn<(q: string, p?: Record<string, unknown>) => Promise<never>>(async () => ROWS as never)

describe('searchLinkTargets', () => {
  it('returns linkable targets with their site paths, scoped to the grant’s project', async () => {
    const fetch = fetcher()
    const out = await searchLinkTargets(ctx(grant()), 'project-a', { locale: 'it', query: '  chi so ' }, { fetch })
    expect(out).toEqual([
      { id: 'hoffmann-page-home', type: 'page', title: 'Home', path: '' },
      { id: 'hoffmann-page-chi-sono', type: 'page', title: 'Chi sono', path: 'chi-sono' },
      { id: 'hoffmann-post-x', type: 'post', title: 'Ansia', path: 'blog/ansia' },
    ])
    const [query, params] = fetch.mock.calls[0]
    expect(query).toContain('projectSlug == $projectSlug')
    expect(query).toContain('!(_id in path("drafts.**"))')
    expect(params).toMatchObject({ projectSlug: 'hoffmann', locale: 'it', q: ['chi*', 'so*'], ids: [], limit: LINK_SEARCH_LIMITS.results })
    expect(params!.types).toEqual(['page', 'post', 'newsArticle', 'event'])
  })

  it('a caller-supplied projectSlug can never widen the scope', async () => {
    const fetch = fetcher()
    await searchLinkTargets(ctx(grant()), 'project-a', { locale: 'it', query: '', projectSlug: 'livener' } as never, { fetch })
    expect(fetch.mock.calls[0][1]).toMatchObject({ projectSlug: 'hoffmann', q: '' })
  })

  it('looks up titles by id (bounded)', async () => {
    const fetch = fetcher()
    await searchLinkTargets(ctx(grant()), 'project-a', { locale: 'de', ids: ['hoffmann-page-chi-sono'] }, { fetch })
    expect(fetch.mock.calls[0][1]).toMatchObject({ ids: ['hoffmann-page-chi-sono'], limit: 1, q: '' })
  })

  it.each([
    ['a viewer', ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] }))],
    ['another project', ctx(grant({ projectId: 'project-b' }))],
    ['blog not installed', ctx(grant({ enabledModuleIds: [] }))],
  ])('refuses %s before any read', async (_l, c) => {
    const fetch = fetcher()
    await expect(searchLinkTargets(c, 'project-a', { locale: 'it', query: 'x' }, { fetch })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a bad locale', { locale: 'it"]' }],
    ['no locale', { locale: undefined }],
    ['a long query', { locale: 'it', query: 'x'.repeat(LINK_SEARCH_LIMITS.query + 1) }],
    ['a non-string query', { locale: 'it', query: { $ne: 1 } }],
    ['draft ids', { locale: 'it', ids: ['drafts.abc'] }],
    ['too many ids', { locale: 'it', ids: Array.from({ length: LINK_SEARCH_LIMITS.ids + 1 }, (_, i) => `id${i}`) }],
  ])('refuses %s as invalid_value before any read', async (_l, input) => {
    const fetch = fetcher()
    await expect(searchLinkTargets(ctx(grant()), 'project-a', input as never, { fetch })).rejects.toBeInstanceOf(PostLinkSearchError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('strips GROQ match wildcards and quotes from the words', async () => {
    const fetch = fetcher()
    await searchLinkTargets(ctx(grant()), 'project-a', { locale: 'it', query: 'a*"b \\ *' }, { fetch })
    expect(fetch.mock.calls[0][1]).toMatchObject({ q: ['ab*'] })
  })
})
