/**
 * "Shorten" the long bio into the short bio (People editor). Same gates as
 * the post assistant: every refusal before the provider; the site comes from
 * the grant; the reply is forced to plain text within the short-bio limit.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {}, sanityServerReadClient: {} }))

import { cleanShortBio, shortenPersonBio, SHORTEN_LIMITS } from '../person-ai'
import { PERSON_LIMITS } from '../persons'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { createFakeAiProvider } from '@/lib/ai/providers/fake'

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'project-a',
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['people.person.read', 'people.person.write'],
  enabledModuleIds: ['people'],
  ...o,
})
const ctx = (...grants: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: grants })
const site = vi.fn(async (slug: string) => (void slug, { tone: 'Calma', locales: ['it', 'de'] }))
const deps = (provider = createFakeAiProvider('Insegna yoga da dieci anni.'), o: Record<string, unknown> = {}) => ({ provider, loadSite: site, logError: vi.fn(), env: { AI_FEATURES: 'improve' }, ...o })
const block = (text: string) => ({ _type: 'block', _key: 'k', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's', text, marks: [] }] })
const input = { locale: 'it', blocks: [block('Insegna yoga da dieci anni e ama la montagna.')] }

describe('shortenPersonBio', () => {
  it.each([
    ['viewer', ctx(grant({ role: 'viewer', permissions: ['people.person.read'] })), 'project-a'],
    ['People not installed', ctx(grant({ enabledModuleIds: ['forms'] })), 'project-a'],
    ["another tenant's project", ctx(grant()), 'project-b'],
  ])('refuses %s before the provider', async (_l, c, pid) => {
    const p = createFakeAiProvider()
    site.mockClear()
    await expect(shortenPersonBio(c, pid, input, deps(p))).rejects.toThrow(TenantAuthorizationError)
    expect(p.calls).toHaveLength(0)
    expect(site).not.toHaveBeenCalled()
  })

  it('is off unless AI_FEATURES has improve', async () => {
    const p = createFakeAiProvider()
    await expect(shortenPersonBio(ctx(grant()), 'project-a', input, deps(p, { env: {} }))).rejects.toMatchObject({ code: 'ai_unavailable' })
    expect(p.calls).toHaveLength(0)
  })

  it.each([
    ['no blocks', { ...input, blocks: [] }, 'invalid_value'],
    ['an empty bio', { ...input, blocks: [block('  ')] }, 'invalid_value'],
    ['a language the site lacks', { ...input, locale: 'fr' }, 'invalid_value'],
    ['an over-long bio', { ...input, blocks: [block('x'.repeat(SHORTEN_LIMITS.inputChars + 1))] }, 'too_large'],
  ])('refuses %s', async (_l, bad, code) => {
    const p = createFakeAiProvider()
    await expect(shortenPersonBio(ctx(grant()), 'project-a', bad, deps(p))).rejects.toMatchObject({ code })
    expect(p.calls).toHaveLength(0)
  })

  it('returns a clean suggestion and never writes', async () => {
    const p = createFakeAiProvider('"**Insegna** yoga da dieci anni."')
    const r = await shortenPersonBio(ctx(grant()), 'project-a', input, deps(p))
    expect(r).toEqual({ text: 'Insegna yoga da dieci anni.' })
    expect(p.calls).toHaveLength(1)
    expect(site).toHaveBeenCalledWith('cyce')
  })

  it('fails closed when the provider fails or returns nothing', async () => {
    const p = createFakeAiProvider('   ')
    await expect(shortenPersonBio(ctx(grant()), 'project-a', input, deps(p))).rejects.toMatchObject({ code: 'ai_unavailable' })
  })
})

describe('cleanShortBio', () => {
  it('cuts at a sentence end within the limit', () => {
    const text = `${'Una frase abbastanza lunga. '.repeat(40)}`
    const out = cleanShortBio(text, PERSON_LIMITS.shortBio)
    expect(out.length).toBeLessThanOrEqual(PERSON_LIMITS.shortBio)
    expect(out.endsWith('.')).toBe(true)
  })
  it('strips markup and quotes', () => {
    expect(cleanShortBio('- “Ciao *mondo*”', 100)).toBe('Ciao mondo')
  })
})
