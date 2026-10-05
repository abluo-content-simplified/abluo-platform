/**
 * ADR-026 — "Improve" on the Story step. Every refusal happens BEFORE the
 * provider is called; identity (the site) comes from the grant; whatever the
 * model returns is forced back into the allowed Portable Text shape.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {}, sanityServerReadClient: {} }))

import { improvePostBody, PostAiError, IMPROVE_LIMITS, improveMaxTokens } from '../post-ai'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { createFakeAiProvider } from '@/lib/ai/providers/fake'
import { AiError } from '@/lib/ai/types'
import type { AiGenerateInput } from '@/lib/ai/types'

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

let n = 0
const key = () => `k${++n}`
const para = (text: string, marks: string[] = []) => ({
  _type: 'block',
  _key: key(),
  style: 'normal',
  markDefs: [],
  children: [{ _type: 'span', _key: key(), text, marks }],
})
const TONE = 'Calma, calda e rassicurante. Tu informale.'
const site = vi.fn(async (slug: string) => (void slug, { tone: TONE, locales: ['it', 'de'] }))
const deps = (provider = createFakeAiProvider(), o: Record<string, unknown> = {}) => ({
  provider,
  loadSite: site,
  key,
  logError: vi.fn(),
  env: { AI_FEATURES: 'improve' },
  ...o,
})
const input = { locale: 'it', blocks: [para('ciao a tutti, oggi parliamo di ansia')] }

describe('improvePostBody — gate', () => {
  it.each([
    ['viewer (no write permission)', ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] })), 'project-a'],
    ['blog not installed', ctx(grant({ enabledModuleIds: ['forms'] })), 'project-a'],
    ["another tenant's project", ctx(grant()), 'project-b'],
  ])('refuses %s before any provider call or site read', async (_l, c, pid) => {
    const p = createFakeAiProvider()
    site.mockClear()
    await expect(improvePostBody(c, pid, input, deps(p))).rejects.toThrow(TenantAuthorizationError)
    expect(p.calls).toHaveLength(0)
    expect(site).not.toHaveBeenCalled()
  })

  it("reads the GRANT's site, not anything the caller names", async () => {
    site.mockClear()
    await improvePostBody(ctx(grant()), 'project-a', input, deps())
    expect(site).toHaveBeenCalledWith('hoffmann')
  })
})

describe('improvePostBody — input', () => {
  it('refuses oversized input before the provider', async () => {
    const p = createFakeAiProvider()
    const big = { locale: 'it', blocks: [para('x'.repeat(15_001)), para('y'.repeat(15_000))] }
    await expect(improvePostBody(ctx(grant()), 'project-a', big, deps(p))).rejects.toMatchObject({ code: 'too_large' })
    expect(p.calls).toHaveLength(0)
  })

  it.each([
    ['a language the site does not have', { locale: 'fr', blocks: input.blocks }],
    ['no language', { locale: '', blocks: input.blocks }],
    ['empty body', { locale: 'it', blocks: [] }],
    ['whitespace body', { locale: 'it', blocks: [para('   ')] }],
    ['an unsafe link in the input', { locale: 'it', blocks: [{ ...para('x'), markDefs: [{ _key: 'l', _type: 'link', href: 'javascript:alert(1)' }] }] }],
    ['an image block', { locale: 'it', blocks: [{ _type: 'image', _key: 'i1' }] }],
    ['not a list', { locale: 'it', blocks: 'hello' }],
  ])('refuses %s as invalid_value before the provider', async (_l, inp) => {
    const p = createFakeAiProvider()
    const err = await improvePostBody(ctx(grant()), 'project-a', inp, deps(p)).catch((e) => e)
    expect(err).toBeInstanceOf(PostAiError)
    expect(err.code).toBe('invalid_value')
    expect(p.calls).toHaveLength(0)
  })
})

describe('improvePostBody — prompt', () => {
  it('includes the site tone, the language and the draft as markdown', async () => {
    const p = createFakeAiProvider()
    await improvePostBody(ctx(grant()), 'project-a', { locale: 'it', blocks: [para('Ciao'), para('forte', ['strong'])] }, deps(p))
    const call = p.calls[0] as AiGenerateInput
    expect(call.system).toContain(TONE)
    expect(call.system).toContain('<tone_of_voice>')
    expect(call.system).toMatch(/Write in Italian/)
    expect(call.system).toMatch(/Do NOT add new links, information/)
    expect(call.prompt).toBe('<draft>\nCiao\n\n**forte**\n</draft>')
    expect(call.maxTokens).toBe(improveMaxTokens(9))
    expect(call.maxTokens).toBeLessThanOrEqual(IMPROVE_LIMITS.maxOutputTokens)
  })

  it('works without a tone', async () => {
    const p = createFakeAiProvider()
    await improvePostBody(ctx(grant()), 'project-a', input, deps(p, { loadSite: async () => ({ tone: null, locales: ['it'] }) }))
    expect(p.calls[0].system).toMatch(/none specified/)
  })
})

describe('improvePostBody — output', () => {
  it('returns sanitized blocks with fresh keys', async () => {
    const p = createFakeAiProvider('## Ansia\n\nCiao a tutti, oggi parliamo di **ansia**.\n\n- uno\n  - due')
    const { blocks } = await improvePostBody(ctx(grant()), 'project-a', input, deps(p))
    expect(blocks.map((b) => (b as { style: string }).style)).toEqual(['h2', 'normal', 'normal', 'normal'])
    expect(blocks[2]).toMatchObject({ listItem: 'bullet', level: 1 })
    expect(blocks[3]).toMatchObject({ listItem: 'bullet', level: 2 })
    const keys = blocks.map((b) => (b as { _key: string })._key)
    expect(keys).not.toContain(input.blocks[0]._key)
  })

  it('normalises an h1, links, images and HTML from the provider', async () => {
    const p = createFakeAiProvider('# Titolo\n\nVedi [qui](https://evil.example) <script>x</script>\n\n![x](https://img)')
    const { blocks } = await improvePostBody(ctx(grant()), 'project-a', input, deps(p))
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ style: 'h2' })
    const b1 = blocks[1] as { markDefs: unknown[]; children: { text: string }[] }
    expect(b1.markDefs).toEqual([])
    expect(b1.children.map((s) => s.text).join('')).toBe('Vedi qui x')
    expect(JSON.stringify(blocks)).not.toMatch(/evil|script|img/)
  })

  it.each([
    ['provider throws', createFakeAiProvider(() => { throw new AiError('provider_error', 'HTTP 500') })],
    ['provider not configured', createFakeAiProvider('x', { configured: false })],
    ['provider times out', createFakeAiProvider(() => { throw new AiError('timeout') })],
    ['empty reply', createFakeAiProvider('   \n\n')],
    ['too many blocks', createFakeAiProvider(Array.from({ length: 2100 }, (_, i) => `p${i}`).join('\n\n'))],
  ])('%s → ai_unavailable', async (_l, p) => {
    const d = deps(p)
    await expect(improvePostBody(ctx(grant()), 'project-a', input, d)).rejects.toMatchObject({ code: 'ai_unavailable' })
    expect(d.logError).toHaveBeenCalled()
  })

  it('a missing provider config surfaces as ai_unavailable, not a crash', async () => {
    const d = deps(undefined as never, { provider: undefined })
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      await expect(improvePostBody(ctx(grant()), 'project-a', input, d)).rejects.toMatchObject({ code: 'ai_unavailable' })
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev
    }
  })
})

describe('improvePostBody — AI_FEATURES flag', () => {
  it.each([[undefined], [''], ['off'], ['translate']])('AI_FEATURES=%s → ai_unavailable before any site read or provider call', async (flag) => {
    const p = createFakeAiProvider()
    site.mockClear()
    const d = deps(p, { env: { AI_FEATURES: flag, ANTHROPIC_API_KEY: 'sk-present' } })
    await expect(improvePostBody(ctx(grant()), 'project-a', input, d)).rejects.toMatchObject({ code: 'ai_unavailable' })
    expect(p.calls).toHaveLength(0)
    expect(site).not.toHaveBeenCalled()
  })

  it('the auth gate still wins over the flag (viewer → forbidden, not ai_unavailable)', async () => {
    const d = deps(createFakeAiProvider(), { env: {} })
    await expect(
      improvePostBody(ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] })), 'project-a', input, d)
    ).rejects.toThrow(TenantAuthorizationError)
  })

  it.each([['improve'], ['all'], ['translate, improve']])('AI_FEATURES=%s → runs', async (flag) => {
    const p = createFakeAiProvider()
    await improvePostBody(ctx(grant()), 'project-a', input, deps(p, { env: { AI_FEATURES: flag } }))
    expect(p.calls).toHaveLength(1)
  })
})

describe('improvePostBody — links', () => {
  it("keeps the author's own link and drops links the model invented", async () => {
    const withLink = {
      _type: 'block',
      _key: 'b1',
      style: 'normal',
      markDefs: [{ _type: 'link', _key: 'l1', href: 'https://ch-psicoterapeuta.com/contatti' }],
      children: [
        { _type: 'span', _key: 's1', text: 'Scrivimi ', marks: [] },
        { _type: 'span', _key: 's2', text: 'qui', marks: ['l1'] },
      ],
    }
    const p = createFakeAiProvider(
      'Scrivimi [qui](https://ch-psicoterapeuta.com/contatti) oppure [altrove](https://evil.example).'
    )
    const { blocks } = await improvePostBody(ctx(grant()), 'project-a', { locale: 'it', blocks: [withLink] }, deps(p))
    expect(p.calls[0].prompt).toContain('[qui](https://ch-psicoterapeuta.com/contatti)')
    const out = JSON.stringify(blocks)
    expect(out).toContain('https://ch-psicoterapeuta.com/contatti')
    expect(out).not.toContain('evil.example')
    expect(out).toContain('altrove')
  })
})
