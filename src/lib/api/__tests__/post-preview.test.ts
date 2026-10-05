import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { mintDraftPreview, previewOrigin, previewThemes, PostPreviewError } from '../post-preview'
import { verifyDraftPreviewToken } from '@/lib/preview/draft-preview-token'
import { draftPreviewUrl } from '@/lib/client/preview-url'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { lookupHostRoute } from '@/lib/tenancy/host-scope'

const ID = '11111111-2222-4333-8444-555555555555'
const secret = Buffer.from('test-secret-test-secret-test-secret')
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0)
const HOFFMANN_ID = lookupHostRoute('ch-psicoterapeuta.com')!.projectId

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: HOFFMANN_ID,
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

function fake(draft: unknown = { _type: 'post', projectSlug: 'hoffmann' }, site: unknown = { themeMode: 'toggle', hasLight: true }) {
  return { getDocument: vi.fn(async () => draft), fetch: vi.fn(async () => site) }
}
const mint = (c = fake(), g = grant(), host: string | null = 'dev.abluo.app', id = ID) =>
  mintDraftPreview(ctx(g), HOFFMANN_ID, { id, host }, { client: c as never, secret, now: NOW })

describe('mintDraftPreview', () => {
  it("returns a token for this draft, this project and this user", async () => {
    const c = fake()
    const r = await mint(c)
    expect(c.getDocument).toHaveBeenCalledWith(`drafts.${ID}`)
    expect(verifyDraftPreviewToken(r.token, { secret, now: NOW })).toMatchObject({ draftId: ID, projectSlug: 'hoffmann', userId: 'u1' })
    expect(r).toMatchObject({ origin: '', projectSlug: 'hoffmann', themes: ['light', 'dark'], exp: NOW / 1000 + 900 })
  })

  it.each([
    ['a viewer', grant({ role: 'viewer', permissions: ['blog.post.read'] })],
    ['a site without Blog', grant({ enabledModuleIds: [] })],
  ])('refuses %s before reading anything', async (_l, g) => {
    const c = fake()
    await expect(mint(c, g)).rejects.toThrow(TenantAuthorizationError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it("refuses another tenant's project", async () => {
    const c = fake()
    await expect(mintDraftPreview(ctx(grant()), 'other-project', { id: ID }, { client: c as never, secret })).rejects.toThrow(
      TenantAuthorizationError
    )
  })

  it.each([
    ['no draft (published-only or missing)', null],
    ["another project's draft", { _type: 'post', projectSlug: 'livener' }],
    ['a non-post draft', { _type: 'page', projectSlug: 'hoffmann' }],
  ])('reports %s as not_found', async (_l, draft) => {
    await expect(mint(fake(draft))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects malformed ids without reading', async () => {
    const c = fake()
    await expect(mint(c, grant(), 'dev.abluo.app', 'drafts.x')).rejects.toBeInstanceOf(PostPreviewError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it('fails closed without a secret', async () => {
    await expect(
      mintDraftPreview(ctx(grant()), HOFFMANN_ID, { id: ID }, { client: fake() as never, secret: null })
    ).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('offers only the themes the site has', async () => {
    expect((await mint(fake({ _type: 'post', projectSlug: 'hoffmann' }, null))).themes).toEqual(['light', 'dark'])
    expect((await mint(fake({ _type: 'post', projectSlug: 'hoffmann' }, { themeMode: 'lightOnly', hasLight: true }))).themes).toEqual(['light'])
  })
})

describe('previewThemes', () => {
  it.each([
    ['toggle', true, ['light', 'dark']],
    ['system', true, ['light', 'dark']],
    [undefined, true, ['light', 'dark']],
    ['toggle', false, ['dark']],
    ['lightOnly', true, ['light']],
    ['darkOnly', true, ['dark']],
  ])('%s / light=%s → %j', (mode, light, expected) => {
    expect(previewThemes(mode as string | undefined, light as boolean)).toEqual(expected)
  })
})

describe('previewOrigin', () => {
  const p = { projectId: HOFFMANN_ID, projectSlug: 'hoffmann' }
  it.each([
    ['dev.abluo.app', ''],
    ['preview.abluo.app', ''],
    ['localhost:3000', ''],
    ['ch-psicoterapeuta.com', ''],
  ])('stays on the same origin on %s', (host, expected) => {
    expect(previewOrigin(host, p)).toBe(expected)
  })

  it("moves to the project's own host when the dashboard runs on another site's domain", () => {
    const origin = previewOrigin('livener.net', p)
    expect(origin).toMatch(/^https:\/\//)
    expect(lookupHostRoute(origin.replace(/^https?:\/\//, ''))?.projectSlug).toBe('hoffmann')
  })
})

describe('draftPreviewUrl', () => {
  it('builds the path-based route with the token and theme', () => {
    expect(draftPreviewUrl({ origin: '', locale: 'it', projectSlug: 'hoffmann', id: ID, token: 'a.b', theme: 'dark' })).toBe(
      `/it/hoffmann/preview/post/${ID}?t=a.b&theme=dark`
    )
  })
})
