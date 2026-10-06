/**
 * "Improve title" / "Improve subtitle" (Title step). Same gates as the body:
 * every refusal before the provider; the site comes from the grant; the reply
 * is forced back to one clean line within the field's limit.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {}, sanityServerReadClient: {} }))

import { cleanLine, improvePostLine, LINE_LIMITS } from '../post-ai'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { createFakeAiProvider } from '@/lib/ai/providers/fake'

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
const site = vi.fn(async (slug: string) => (void slug, { tone: 'Calma', locales: ['it', 'de'] }))
const deps = (provider = createFakeAiProvider('"Perché siamo passati alle radiografie digitali"'), o: Record<string, unknown> = {}) => ({
  provider,
  loadSite: site,
  logError: vi.fn(),
  env: { AI_FEATURES: 'improve' },
  ...o,
})
const input = { locale: 'it', field: 'title' as const, text: 'perche siamo passati alle radiografie digitali' }

describe('improvePostLine', () => {
  it.each([
    ['viewer', ctx(grant({ role: 'viewer', permissions: ['blog.post.read'] })), 'project-a'],
    ['blog not installed', ctx(grant({ enabledModuleIds: ['forms'] })), 'project-a'],
    ["another tenant's project", ctx(grant()), 'project-b'],
  ])('refuses %s before the provider', async (_l, c, pid) => {
    const p = createFakeAiProvider()
    site.mockClear()
    await expect(improvePostLine(c, pid, input, deps(p))).rejects.toThrow(TenantAuthorizationError)
    expect(p.calls).toHaveLength(0)
    expect(site).not.toHaveBeenCalled()
  })

  it('is off unless AI_FEATURES has improve', async () => {
    const p = createFakeAiProvider()
    await expect(improvePostLine(ctx(grant()), 'project-a', input, deps(p, { env: {} }))).rejects.toMatchObject({ code: 'ai_unavailable' })
    expect(p.calls).toHaveLength(0)
  })

  it.each([
    ['an unknown field', { ...input, field: 'body' as never }, 'invalid_value'],
    ['empty text', { ...input, text: '  ' }, 'invalid_value'],
    ['a language the site lacks', { ...input, locale: 'fr' }, 'invalid_value'],
    ['an over-long title', { ...input, text: 'x'.repeat(LINE_LIMITS.title + 1) }, 'too_large'],
  ])('refuses %s', async (_l, bad, code) => {
    const p = createFakeAiProvider()
    await expect(improvePostLine(ctx(grant()), 'project-a', bad, deps(p))).rejects.toMatchObject({ code })
    expect(p.calls).toHaveLength(0)
  })

  it("returns one clean line, in the site's tone, for the GRANT's site", async () => {
    const p = createFakeAiProvider('"Perché siamo passati alle radiografie digitali"\nAlternative: …')
    site.mockClear()
    await expect(improvePostLine(ctx(grant()), 'project-a', input, deps(p))).resolves.toEqual({
      text: 'Perché siamo passati alle radiografie digitali',
    })
    expect(site).toHaveBeenCalledWith('hoffmann')
    expect(p.calls[0].system).toContain('Calma')
    expect(p.calls[0].system).toContain('Italian')
  })

  it('a subtitle gets the title as context', async () => {
    const p = createFakeAiProvider('Meno radiazioni, immagini più nitide.')
    await improvePostLine(ctx(grant()), 'project-a', { locale: 'it', field: 'subtitle', text: 'meno radiazioni', title: 'Radiografie' }, deps(p))
    expect(p.calls[0].prompt).toContain('<title>\nRadiografie\n</title>')
  })

  it('provider failure or an empty reply → ai_unavailable', async () => {
    await expect(improvePostLine(ctx(grant()), 'project-a', input, deps(createFakeAiProvider('  \n '))) ).rejects.toMatchObject({ code: 'ai_unavailable' })
    await expect(
      improvePostLine(ctx(grant()), 'project-a', input, deps(createFakeAiProvider('x', { configured: false })))
    ).rejects.toMatchObject({ code: 'ai_unavailable' })
  })

  it('cleanLine strips quotes and markup and caps the length', () => {
    expect(cleanLine('**“Hello world”**', 200)).toBe('Hello world')
    expect(cleanLine('\n\n  A line \nB', 200)).toBe('A line')
    expect(cleanLine('abcdef', 3)).toBe('abc')
  })
})
