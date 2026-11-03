import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { mintPersonPreview } from '../person-preview'
import { verifyDraftPreviewToken } from '@/lib/preview/draft-preview-token'
import { personPreviewUrl } from '@/lib/client/preview-url'
import { PostPreviewError } from '../post-preview'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { lookupHostRoute } from '@/lib/tenancy/host-scope'

const ID = '11111111-2222-4333-8444-555555555555'
const secret = Buffer.from('test-secret-test-secret-test-secret')
const NOW = Date.UTC(2026, 9, 5, 10, 0, 0)
const PID = lookupHostRoute('ch-psicoterapeuta.com')!.projectId

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'viewer',
  permissions: ['people.person.read'],
  enabledModuleIds: ['people'],
  ...o,
})
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })
const fake = (docs: Record<string, unknown> = {}) => ({
  getDocument: vi.fn(async (id: string) => docs[id]),
  fetch: vi.fn(async () => ({ themeMode: 'toggle', hasLight: true })),
})
const mint = (c = fake({ [`drafts.${ID}`]: { _type: 'person', projectSlug: 'hoffmann' } }), g = grant(), id = ID) =>
  mintPersonPreview(ctx(g), PID, { id, host: 'dev.abluo.app' }, { client: c as never, secret, now: NOW })

describe('mintPersonPreview', () => {
  it('mints a person-kind token for this person, project and user (a viewer may read)', async () => {
    const r = await mint()
    expect(verifyDraftPreviewToken(r.token, { secret, now: NOW })).toMatchObject({ kind: 'person', draftId: ID, projectSlug: 'hoffmann', userId: 'u1' })
    expect(personPreviewUrl({ origin: r.origin, locale: 'it', projectSlug: r.projectSlug, id: ID, token: r.token })).toMatch(
      new RegExp(`^/it/hoffmann/preview/person/${ID}\\?t=`),
    )
  })

  it('previews the published person when there is no draft', async () => {
    await expect(mint(fake({ [ID]: { _type: 'person', projectSlug: 'hoffmann' } }))).resolves.toBeTruthy()
  })

  it.each([
    ['without read permission', grant({ permissions: [] })],
    ['a site without People', grant({ enabledModuleIds: [] })],
  ])('refuses %s before reading anything', async (_l, g) => {
    const c = fake()
    await expect(mint(c, g)).rejects.toThrow(TenantAuthorizationError)
    expect(c.getDocument).not.toHaveBeenCalled()
  })

  it.each([
    ['another project', { _type: 'person', projectSlug: 'livener' }],
    ['a different document type', { _type: 'post', projectSlug: 'hoffmann' }],
    ['an anonymised person', { _type: 'person', projectSlug: 'hoffmann', anonymisedAt: '2026-01-01' }],
  ])('looks like not_found for %s', async (_l, doc) => {
    await expect(mint(fake({ [`drafts.${ID}`]: doc }))).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects a malformed id and a missing secret', async () => {
    await expect(mint(undefined, grant(), '../x')).rejects.toBeInstanceOf(PostPreviewError)
    await expect(
      mintPersonPreview(ctx(grant()), PID, { id: ID }, { client: fake() as never, secret: null }),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })
})
