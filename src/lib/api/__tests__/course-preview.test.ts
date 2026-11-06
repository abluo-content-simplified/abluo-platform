import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { mintCoursePreview } from '../course-preview'
import { verifyDraftPreviewToken } from '@/lib/preview/draft-preview-token'
import { coursePreviewUrl } from '@/lib/client/preview-url'
import { PostPreviewError } from '../post-preview'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { lookupHostRoute } from '@/lib/tenancy/host-scope'

const ID = '11111111-2222-4333-8444-555555555555'
const secret = Buffer.from('test-secret-test-secret-test-secret')
const NOW = Date.UTC(2026, 10, 5, 10, 0, 0)
const PID = lookupHostRoute('ch-psicoterapeuta.com')!.projectId
const DOC = { _type: 'course', projectSlug: 'hoffmann', publicId: 'pub-1' }

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['courses.course.write'],
  enabledModuleIds: ['courses'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })
const fake = (docs: Record<string, unknown> = {}) => ({
  getDocument: vi.fn(async (id: string) => docs[id]),
  fetch: vi.fn(async () => ({ themeMode: 'toggle', hasLight: true })),
})
const mint = (c = fake({ [`drafts.${ID}`]: DOC }), g = grant(), id = ID) =>
  mintCoursePreview(ctx(g), PID, { id, host: 'dev.abluo.app' }, { client: c as never, secret, now: NOW })

describe('mintCoursePreview', () => {
  it('mints a course-kind token for this course, project and user', async () => {
    const r = await mint()
    expect(verifyDraftPreviewToken(r.token, { secret, now: NOW })).toMatchObject({ kind: 'course', draftId: ID, projectSlug: 'hoffmann', userId: 'u1' })
    expect(r.exp).toBe(Math.floor(NOW / 1000) + 15 * 60)
    expect(coursePreviewUrl({ origin: r.origin, locale: 'it', projectSlug: r.projectSlug, id: ID, token: r.token })).toMatch(
      new RegExp(`^/it/hoffmann/preview/course/${ID}\\?t=`),
    )
  })

  it('previews the published course when there is no draft', async () => {
    await expect(mint(fake({ [ID]: DOC }))).resolves.toBeTruthy()
  })

  it.each([
    ['a viewer without write permission', grant({ permissions: ['courses.course.read'] })],
    ['a site without Courses', grant({ enabledModuleIds: [] })],
  ])('refuses %s before reading anything', async (_l, g) => {
    const c = fake()
    await expect(mint(c, g)).rejects.toThrow(TenantAuthorizationError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['another project', { ...DOC, projectSlug: 'livener' }],
    ['a different document type', { ...DOC, _type: 'post' }],
    ['a course without a public id', { ...DOC, publicId: undefined }],
  ])('looks like not_found for %s', async (_l, doc) => {
    await expect(mint(fake({ [`drafts.${ID}`]: doc }))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('looks like not_found for a missing course', async () => {
    await expect(mint(fake())).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a malformed id and a missing secret', async () => {
    await expect(mint(undefined, grant(), '../x')).rejects.toBeInstanceOf(PostPreviewError)
    await expect(mintCoursePreview(ctx(grant()), PID, { id: ID }, { client: fake() as never, secret: null })).rejects.toMatchObject({ code: 'unavailable' })
  })
})
