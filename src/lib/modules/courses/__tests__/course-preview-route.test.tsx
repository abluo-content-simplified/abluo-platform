/**
 * The private course preview route: forged / other-project requests are a
 * plain 404 before anything is read; the page is noindex.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const ID = 'course-1'
const getDocument = vi.fn()
const sanityFetch = vi.fn()
const hydrate = vi.fn(async () => {})
vi.mock('@/lib/sanity/server-clients', () => ({
  sanityWriteClient: { getDocument: (...a: unknown[]) => getDocument(...a), fetch: (...a: unknown[]) => sanityFetch(...a) },
}))
vi.mock('@/lib/sanity/client', () => ({
  tenantClient: () => ({ fetchForTenant: vi.fn(async () => ({ defaultLocale: 'it' })) }),
  fetchDesignSystemById: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'dev.abluo.app' }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/lib/modules/config', () => ({ getEnabledModuleIds: () => ['courses'] }))
vi.mock('@/lib/tenancy/link-scope.server', () => ({ isHostScopedRequest: async () => false }))
vi.mock('@/components/sections/SectionRenderer', () => ({ SectionRenderer: () => null }))
vi.mock('@/lib/modules/courses/timetable-section.server', () => ({ hydrateTimetableSection: (...a: unknown[]) => (hydrate as never as (...x: unknown[]) => Promise<void>)(...a) }))
process.env.PREVIEW_SECRET = 'test-secret-test-secret-test-secret'

import Page, { metadata } from '@/app/[locale]/(website)/[tenant]/preview/course/[id]/page'
import { signDraftPreviewToken } from '@/lib/preview/draft-preview-token'

const secret = Buffer.from('test-secret-test-secret-test-secret')
const token = (o: { kind?: 'course' | 'post'; draftId?: string; projectSlug?: string } = {}) =>
  signDraftPreviewToken({ kind: 'course', draftId: ID, projectSlug: 'hoffmann', userId: 'u1', ...o }, { secret }).token
const call = (t: string | undefined, tenant = 'hoffmann') =>
  Page({ params: Promise.resolve({ tenant, locale: 'it', id: ID }), searchParams: Promise.resolve({ t }) })

beforeEach(() => {
  getDocument.mockReset().mockResolvedValue({ _type: 'course', projectSlug: 'hoffmann' })
  sanityFetch.mockReset().mockResolvedValue({ publicId: 'pub-1', title: 'Yoga', color: 'accent' })
  hydrate.mockClear()
})

describe('course preview route', () => {
  it('is noindex, nofollow, no-referrer', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false, nocache: true })
    expect(metadata.referrer).toBe('no-referrer')
  })

  it.each([
    ['no token', undefined, 'hoffmann'],
    ['a post token', token({ kind: 'post' }), 'hoffmann'],
    ['another course', token({ draftId: 'other' }), 'hoffmann'],
    ['another project', token({ projectSlug: 'livener' }), 'hoffmann'],
    ['the right token on another project URL', token(), 'livener'],
  ])('404s for %s without reading anything', async (_l, t, tenant) => {
    await expect(call(t, tenant)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(getDocument).not.toHaveBeenCalled()
    expect(sanityFetch).not.toHaveBeenCalled()
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('renders for a valid token: hydrates with the preview course, no meeting details', async () => {
    await call(token())
    expect(hydrate).toHaveBeenCalledOnce()
    const [section, ctx] = hydrate.mock.calls[0] as unknown as [{ showOnlineDetails: boolean }, { previewCourse: unknown; pageProtected: boolean; projectSlug: string }]
    expect(ctx.previewCourse).toMatchObject({ publicId: 'pub-1', title: 'Yoga', color: 'accent' })
    expect(ctx.projectSlug).toBe('hoffmann')
    expect(ctx.pageProtected).toBe(false)
    expect(section.showOnlineDetails).toBe(false)
    // The owner can test printing from the preview.
    expect(section).toMatchObject({ showPrintButton: true, allowViewSwitch: true })
  })

  it('404s when the course cannot be read', async () => {
    sanityFetch.mockResolvedValue(null)
    await expect(call(token())).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
