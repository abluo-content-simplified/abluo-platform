import { describe, it, expect, vi } from 'vitest'
import { authorizeCoursePreview } from '../authorize'
import { signDraftPreviewToken, verifyDraftPreviewToken } from '../draft-preview-token'

const secret = Buffer.from('test-secret-test-secret-test-secret')
const ID = 'course-1'
const tok = (o: Partial<Parameters<typeof signDraftPreviewToken>[0]> = {}) =>
  signDraftPreviewToken({ kind: 'course', draftId: ID, projectSlug: 'hoffmann', userId: 'u', ...o }, { secret }).token
const run = (token: unknown, doc: unknown = { _type: 'course', projectSlug: 'hoffmann' }, o: { courseId?: string; urlProject?: string; host?: string } = {}) => {
  const getDoc = vi.fn(async (id: string) => (id === `drafts.${ID}` || id === ID ? (doc as never) : undefined))
  return authorizeCoursePreview({ token, courseId: o.courseId ?? ID, urlProject: o.urlProject ?? 'hoffmann', host: o.host ?? 'dev.abluo.app', getDoc, secret }).then((r) => ({ r, getDoc }))
}

describe('course preview token + authorization', () => {
  it('round-trips the course kind', () => {
    expect(verifyDraftPreviewToken(tok(), { secret })).toMatchObject({ kind: 'course', draftId: ID })
  })
  it('accepts a matching token', async () => {
    expect((await run(tok())).r).toMatchObject({ kind: 'course' })
  })
  it.each([
    ['a post token', () => tok({ kind: 'post' })],
    ['a person token', () => tok({ kind: 'person' })],
    ['another course', () => tok({ draftId: 'other' })],
    ['another project', () => tok({ projectSlug: 'livener' })],
    ['garbage', () => 'x.y'],
  ])('404s for %s without reading the document', async (_l, make) => {
    const { r, getDoc } = await run(make())
    expect(r).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })
  it('refuses a course token on the post/person routes', async () => {
    const { authorizeDraftPreview, authorizePersonPreview } = await import('../authorize')
    const getDraft = vi.fn(async () => ({ _type: 'post', projectSlug: 'hoffmann' }))
    expect(await authorizeDraftPreview({ token: tok(), draftId: ID, urlProject: 'hoffmann', host: 'dev.abluo.app', getDraft, secret })).toBeNull()
    expect(await authorizePersonPreview({ token: tok(), personId: ID, urlProject: 'hoffmann', host: 'dev.abluo.app', getDoc: getDraft, secret })).toBeNull()
  })
  it('refuses another project URL, another type and another project’s document', async () => {
    expect((await run(tok(), undefined, { urlProject: 'livener' })).r).toBeNull()
    expect((await run(tok(), { _type: 'post', projectSlug: 'hoffmann' })).r).toBeNull()
    expect((await run(tok(), { _type: 'course', projectSlug: 'livener' })).r).toBeNull()
  })
})
