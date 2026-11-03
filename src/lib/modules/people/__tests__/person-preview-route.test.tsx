/**
 * The private person preview route: unauthenticated / forged / other-project
 * requests are a plain 404 before any person is read; the page is noindex.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const secret = Buffer.from('test-secret-test-secret-test-secret')
const ID = '11111111-2222-4333-8444-555555555555'

const getDocument = vi.fn()
const sanityFetch = vi.fn()
vi.mock('@/lib/sanity/server-clients', () => ({
  sanityWriteClient: { getDocument: (...a: unknown[]) => getDocument(...a), fetch: (...a: unknown[]) => sanityFetch(...a) },
}))
vi.mock('@/lib/sanity/client', () => ({
  tenantClient: () => ({ fetchForTenant: vi.fn(async () => ({ defaultLocale: 'it' })) }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'dev.abluo.app' }) }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/tenancy/link-scope.server', () => ({ isHostScopedRequest: async () => false }))
vi.mock('@/components/people/PersonProfile', () => ({ PersonProfile: () => null }))
process.env.PREVIEW_SECRET = 'test-secret-test-secret-test-secret' // = `secret`

import Page, { metadata } from '@/app/[locale]/(website)/[tenant]/preview/person/[id]/page'
import { signDraftPreviewToken } from '@/lib/preview/draft-preview-token'

const token = (o: { kind?: 'person' | 'post'; draftId?: string; projectSlug?: string } = {}) =>
  signDraftPreviewToken({ kind: 'person', draftId: ID, projectSlug: 'hoffmann', userId: 'u1', ...o }, { secret }).token

const call = (t: string | undefined, tenant = 'hoffmann') =>
  Page({ params: Promise.resolve({ tenant, locale: 'it', id: ID }), searchParams: Promise.resolve({ t }) })

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue({ _type: 'person', projectSlug: 'hoffmann' })
  sanityFetch.mockReset().mockResolvedValue({ publicId: 'p', visibility: 'off', archived: false, hasPage: false, slug: {} })
})

describe('person preview route', () => {
  it('is noindex, nofollow, no-referrer', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false, nocache: true })
    expect(metadata.referrer).toBe('no-referrer')
  })

  it.each([
    ['no token', undefined, 'hoffmann'],
    ['a post token', token({ kind: 'post' }), 'hoffmann'],
    ['a token for another person', token({ draftId: 'other-person' }), 'hoffmann'],
    ['a token for another project', token({ projectSlug: 'livener' }), 'hoffmann'],
    ['the right token on another project URL', token(), 'livener'],
  ])('404s for %s without reading the person', async (_l, t, tenant) => {
    await expect(call(t, tenant)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getDocument).not.toHaveBeenCalled()
    expect(sanityFetch).not.toHaveBeenCalled()
  })

  it("404s when the document belongs to another project's person", async () => {
    getDocument.mockResolvedValue({ _type: 'person', projectSlug: 'livener' })
    await expect(call(token())).rejects.toThrow('NEXT_NOT_FOUND')
    expect(sanityFetch).not.toHaveBeenCalled()
  })

  it('renders for a valid token, reading the draft first with perspective raw', async () => {
    await expect(call(token())).resolves.toBeTruthy()
    expect(sanityFetch.mock.calls[0][1]).toMatchObject({ docId: `drafts.${ID}`, projectSlug: 'hoffmann' })
    expect(sanityFetch.mock.calls[0][2]).toEqual({ perspective: 'raw' })
  })

  it('falls back to the published person when there is no draft', async () => {
    sanityFetch.mockResolvedValueOnce(null)
    await call(token())
    expect(sanityFetch.mock.calls[1][1]).toMatchObject({ docId: ID })
  })
})
