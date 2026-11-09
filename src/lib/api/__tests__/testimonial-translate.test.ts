/**
 * Translate on Testimonial fields (ADR-023 dashboard path, ADR-048 D6). Same
 * engine as /api/translate; the gates are testimonials.write + the Translate
 * module installed, the source is read from the SAVED testimonial, and one
 * click never overwrites original or reviewed text. Results carry status
 * `machine` so the editor can store them.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { translateTestimonialFields, type TestimonialTranslateDeps } from '../testimonial-translate'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { hashText } from '@/lib/translate/status'
import type { TranslationProvider } from '@/lib/translate/providers/types'

const PID = '11111111-1111-4111-8111-111111111111'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('hoffmann'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['testimonials.read', 'testimonials.write'],
  enabledModuleIds: ['testimonials', 'translate'],
  ...o,
})
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

const doc = (extra: Record<string, unknown> = {}) => ({
  _id: 'drafts.t1',
  _type: 'testimonial',
  projectSlug: 'hoffmann',
  body: { it: 'Un’esperienza bellissima.\n\nGrazie.', de: '', fr: 'Fait main', translationStatus: { fr: { status: 'reviewed' } } },
  context: { it: 'Socia dal 2019' },
  ...extra,
})

function setup(opts: { doc?: Record<string, unknown>; enabled?: boolean; reply?: (t: string, target: string) => string } = {}) {
  const calls: Array<{ texts: string[]; target: string }> = []
  const usage: unknown[] = []
  const provider: TranslationProvider = {
    id: 'google',
    isConfigured: () => true,
    translate: vi.fn(async (req: Parameters<TranslationProvider['translate']>[0]) => {
      calls.push({ texts: req.texts, target: req.target })
      return { texts: req.texts.map((t) => (opts.reply ? opts.reply(t, req.target) : `[${req.target}] ${t}`)), billedCharacters: req.texts.join('').length }
    }),
  }
  const getDocument = vi.fn(async (id: string) => (id === 'drafts.t1' ? (opts.doc ?? doc()) : undefined))
  const deps: TestimonialTranslateDeps = {
    getDocument: getDocument as never,
    now: () => new Date('2026-11-08T10:00:00Z'),
    translate: {
      loadConfig: async () => ({ projectId: PID, enabled: opts.enabled !== false, provider: 'google', quota: null, supportedLocales: ['it', 'de', 'fr'] }),
      getProvider: () => provider,
      getMonthToDate: async () => 0,
      projectIsMeterable: async () => true,
      recordUsage: async (rows) => void usage.push(...rows),
      environment: 'test',
      logError: () => {},
    },
  }
  return { deps, calls, usage, provider, getDocument }
}
const input = (o: Record<string, unknown> = {}) => ({ id: 't1', fields: ['body' as const], sourceLocale: 'it', ...o })

describe('gates', () => {
  it.each([
    ['a viewer', ctx(grant({ role: 'viewer', permissions: ['testimonials.read'] }))],
    ['Testimonials not installed', ctx(grant({ enabledModuleIds: ['translate'] }))],
  ])('%s is refused before any read', async (_n, c) => {
    const s = setup()
    await expect(translateTestimonialFields(c, PID, input(), s.deps)).rejects.toBeTruthy()
    expect(s.getDocument).not.toHaveBeenCalled()
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('the Translate module must be installed on the project', async () => {
    const s = setup()
    await expect(translateTestimonialFields(ctx(grant({ enabledModuleIds: ['testimonials'] })), PID, input(), s.deps)).rejects.toMatchObject({ code: 'module_disabled' })
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('a testimonial of another website, or another type, is not found', async () => {
    await expect(translateTestimonialFields(ctx(grant()), PID, input(), setup({ doc: doc({ projectSlug: 'livener' }) }).deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(translateTestimonialFields(ctx(grant()), PID, input(), setup({ doc: doc({ _type: 'post' }) }).deps)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses unknown fields, malformed ids and archived testimonials', async () => {
    const s = setup()
    await expect(translateTestimonialFields(ctx(grant()), PID, input({ fields: ['displayName'] }), s.deps)).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(translateTestimonialFields(ctx(grant()), PID, input({ id: '../x' }), s.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(translateTestimonialFields(ctx(grant()), PID, input(), setup({ doc: doc({ archivedAt: '2026-10-01' }) }).deps)).rejects.toMatchObject({ code: 'archived' })
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('the module switched off in its config stops before the provider', async () => {
    const s = setup({ enabled: false })
    await expect(translateTestimonialFields(ctx(grant()), PID, input(), s.deps)).rejects.toMatchObject({ code: 'module_disabled' })
    expect(s.provider.translate).not.toHaveBeenCalled()
  })
})

describe('what one click does', () => {
  it('translates the SAVED source into empty targets only, never over reviewed text, with status machine and metering', async () => {
    const s = setup()
    const r = await translateTestimonialFields(ctx(grant()), PID, input(), s.deps)
    expect(s.calls).toEqual([{ texts: ['Un’esperienza bellissima.\n\nGrazie.'], target: 'de' }]) // fr is reviewed
    expect(r.results.body).toEqual({
      de: {
        text: '[de] Un’esperienza bellissima.\n\nGrazie.',
        meta: expect.objectContaining({ status: 'machine', provider: 'google', sourceLocale: 'it', textHash: hashText('[de] Un’esperienza bellissima.\n\nGrazie.'), translatedAt: '2026-11-08T10:00:00.000Z' }),
      },
    })
    expect(r.skipped).toEqual([{ field: 'body', locale: 'fr', reason: 'protected' }])
    expect(s.usage).toEqual([expect.objectContaining({ project_id: PID, provider: 'google', source_locale: 'it', target_locale: 'de', sanity_document_id: 't1', actor_id: 'u1' })])
  })

  it('cleans a line field like the save does, so the stored hash matches the saved text', async () => {
    const s = setup({ reply: () => '  Mitglied \n seit 2019 ' })
    const r = await translateTestimonialFields(ctx(grant()), PID, input({ fields: ['context'] }), s.deps)
    expect(r.results.context?.de.text).toBe('Mitglied seit 2019')
    expect(r.results.context?.de.meta.textHash).toBe(hashText('Mitglied seit 2019'))
  })

  it('skips a field with no source text, and reports nothing to translate when nothing ran', async () => {
    const s = setup()
    await expect(translateTestimonialFields(ctx(grant()), PID, input({ fields: ['abstract'] }), s.deps)).rejects.toMatchObject({ code: 'invalid_request' })
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('leaves a result that is too long for the field out', async () => {
    const s = setup({ reply: () => 'x'.repeat(700) })
    const r = await translateTestimonialFields(ctx(grant()), PID, input({ fields: ['abstract'] }), setup({ doc: doc({ abstract: { it: 'Breve' } }), reply: () => 'x'.repeat(700) }).deps)
    expect(r.results.abstract).toBeUndefined()
    expect(r.skipped).toContainEqual({ field: 'abstract', locale: 'de', reason: 'too_long' })
    void s
  })
})
