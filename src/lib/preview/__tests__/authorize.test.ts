/**
 * The draft-preview gate. Every refusal is a plain null (→ 404), and the
 * draft is never read unless the token, URL and host already agree.
 */
import { describe, it, expect, vi } from 'vitest'
import { authorizeDraftPreview, hostMayServeProject } from '../authorize'
import { signDraftPreviewToken } from '../draft-preview-token'

const secret = Buffer.from('test-secret-test-secret-test-secret')
const ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = '99999999-2222-4333-8444-555555555555'
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0)
const tokenFor = (o: Partial<{ draftId: string; projectSlug: string }> = {}, s = secret, now = NOW) =>
  signDraftPreviewToken({ draftId: ID, projectSlug: 'hoffmann', userId: 'u1', ...o }, { secret: s, now }).token

function run(o: Partial<Parameters<typeof authorizeDraftPreview>[0]> = {}, draft: unknown = { _type: 'post', projectSlug: 'hoffmann' }) {
  const getDraft = vi.fn(async () => draft as never)
  const result = authorizeDraftPreview({
    token: tokenFor(),
    draftId: ID,
    urlProject: 'hoffmann',
    host: 'dev.abluo.app',
    getDraft,
    secret,
    now: NOW + 1000,
    ...o,
  })
  return { result, getDraft }
}

describe('authorizeDraftPreview', () => {
  it('lets the owner of a fresh token see the draft', async () => {
    const { result, getDraft } = run()
    expect(await result).toMatchObject({ draftId: ID, projectSlug: 'hoffmann', userId: 'u1' })
    expect(getDraft).toHaveBeenCalledWith(`drafts.${ID}`)
  })

  it.each([
    ['no token', { token: undefined }],
    ['a forged token', { token: tokenFor({}, Buffer.from('forged-forged-forged-forged-forged')) }],
    ['an expired token', { now: NOW + 16 * 60 * 1000 }],
    ['a token for another draft', { token: tokenFor({ draftId: OTHER_ID }) }],
    ['a token for another project', { token: tokenFor({ projectSlug: 'livener' }) }],
    ['a URL for another project', { urlProject: 'livener' }],
    ['a malformed id', { draftId: '../etc' }],
    ["another site's domain", { host: 'livener.net' }],
  ])('refuses %s without reading the draft', async (_label, o) => {
    const { result, getDraft } = run(o as never)
    expect(await result).toBeNull()
    expect(getDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['a published-only post (no draft)', null],
    ["another project's draft", { _type: 'post', projectSlug: 'livener' }],
    ['a draft that is not a post', { _type: 'page', projectSlug: 'hoffmann' }],
  ])('refuses %s', async (_label, draft) => {
    expect(await run({}, draft).result).toBeNull()
  })

  it('refuses when the draft read fails', async () => {
    const getDraft = vi.fn(async () => {
      throw new Error('boom')
    })
    expect(
      await authorizeDraftPreview({ token: tokenFor(), draftId: ID, urlProject: 'hoffmann', host: 'localhost:3000', getDraft, secret, now: NOW })
    ).toBeNull()
  })
})

describe('hostMayServeProject', () => {
  it.each([
    ['dev.abluo.app', true],
    ['preview.abluo.app', true],
    ['localhost:3000', true],
    ['abluo-platform-git-dev.vercel.app', true],
    ['ch-psicoterapeuta.com', true],
    ['hoffmann.preview.abluo.app', true],
    ['hoffmann.localhost:3000', true],
    ['livener.net', false],
    ['abluo.app', false],
    ['livener.preview.abluo.app', false],
  ])('%s → %s for hoffmann', (host, ok) => {
    expect(hostMayServeProject(host, 'hoffmann')).toBe(ok)
  })
})
