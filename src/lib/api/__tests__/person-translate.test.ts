/**
 * Translate on People fields (ADR-023, dashboard path). Same engine as
 * /api/translate; here the gates are people.person.write + the Translate module
 * installed, the source is read from the SAVED person, and one click never
 * overwrites original or reviewed text.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { translatePersonFields, type PersonTranslateDeps } from '../person-translate'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { hashText } from '@/lib/translate/status'
import type { TranslationProvider } from '@/lib/translate/providers/types'
import { TranslateError } from '@/lib/translate/types'

const PID = '11111111-1111-4111-8111-111111111111'
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'editor',
  permissions: ['people.person.read', 'people.person.write'],
  enabledModuleIds: ['people', 'translate'],
  ...o,
})
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

const person = (extra: Record<string, unknown> = {}) => ({
  _id: 'drafts.anna', _type: 'person', projectSlug: 'cyce', firstName: 'Anna',
  jobTitle: { it: 'Insegnante', de: '', fr: 'Professeure', translationStatus: { fr: { status: 'reviewed' } } },
  shortBio: { it: 'Insegna yoga da dieci anni.' },
  ...extra,
})

function setup(opts: { doc?: Record<string, unknown>; quota?: number | null; used?: number; configured?: boolean; enabled?: boolean; meterable?: boolean; reply?: (t: string, target: string) => string } = {}) {
  const calls: Array<{ texts: string[]; target: string }> = []
  const usage: unknown[] = []
  const provider: TranslationProvider = {
    id: 'google',
    isConfigured: () => opts.configured !== false,
    translate: vi.fn(async (req: Parameters<TranslationProvider['translate']>[0]) => {
      calls.push({ texts: req.texts, target: req.target })
      return { texts: req.texts.map((t) => (opts.reply ? opts.reply(t, req.target) : `[${req.target}] ${t}`)), billedCharacters: req.texts.join('').length }
    }),
  }
  const getDocument = vi.fn(async (id: string) => (id === 'drafts.anna' ? (opts.doc ?? person()) : undefined))
  const deps: PersonTranslateDeps = {
    getDocument: getDocument as never,
    now: () => new Date('2026-11-03T10:00:00Z'),
    translate: {
      loadConfig: async () => ({ projectId: PID, enabled: opts.enabled !== false, provider: 'google', quota: opts.quota ?? null, supportedLocales: ['it', 'de', 'fr'] }),
      getProvider: () => provider,
      getMonthToDate: async () => opts.used ?? 0,
      projectIsMeterable: async () => opts.meterable !== false,
      recordUsage: async (rows) => void usage.push(...rows),
      environment: 'test',
      logError: () => {},
    },
  }
  return { deps, calls, usage, provider, getDocument }
}
const input = (o: Record<string, unknown> = {}) => ({ id: 'anna', fields: ['jobTitle' as const], sourceLocale: 'it', ...o })

describe('gates', () => {
  it.each([
    ['a viewer', ctx(grant({ role: 'viewer', permissions: ['people.person.read'] })), 'forbidden'],
    ['People not installed', ctx(grant({ enabledModuleIds: ['translate'] })), 'forbidden'],
  ])('%s is refused before any read', async (_n, c) => {
    const s = setup()
    await expect(translatePersonFields(c, PID, input(), s.deps)).rejects.toBeTruthy()
    expect(s.getDocument).not.toHaveBeenCalled()
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('the Translate module must be installed on the project', async () => {
    const s = setup()
    await expect(translatePersonFields(ctx(grant({ enabledModuleIds: ['people'] })), PID, input(), s.deps)).rejects.toMatchObject({ code: 'module_disabled' })
    expect(s.getDocument).not.toHaveBeenCalled()
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('a person of another website is not found', async () => {
    const s = setup({ doc: person({ projectSlug: 'livener' }) })
    await expect(translatePersonFields(ctx(grant()), PID, input(), s.deps)).rejects.toMatchObject({ code: 'not_found' })
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('refuses an unknown field and malformed ids; archived and anonymised people are read-only', async () => {
    const s = setup()
    await expect(translatePersonFields(ctx(grant()), PID, input({ fields: ['bio'] }), s.deps)).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(translatePersonFields(ctx(grant()), PID, input({ id: '../x' }), s.deps)).rejects.toMatchObject({ code: 'not_found' })
    await expect(translatePersonFields(ctx(grant()), PID, input(), setup({ doc: person({ archivedAt: '2026-10-01' }) }).deps)).rejects.toMatchObject({ code: 'archived' })
    await expect(translatePersonFields(ctx(grant()), PID, input(), setup({ doc: person({ anonymisedAt: '2026-10-01' }) }).deps)).rejects.toMatchObject({ code: 'anonymised' })
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('the module being off in the config, an unset key and an unmeterable project all stop before the provider', async () => {
    for (const [o, code] of [
      [{ enabled: false }, 'module_disabled'],
      [{ configured: false }, 'provider_not_configured'],
      [{ meterable: false }, 'usage_unavailable'],
    ] as const) {
      const s = setup(o)
      await expect(translatePersonFields(ctx(grant()), PID, input(), s.deps)).rejects.toMatchObject({ code })
      expect(s.provider.translate).not.toHaveBeenCalled()
    }
  })

  it('a reached quota refuses the whole request', async () => {
    const s = setup({ quota: 100, used: 95 })
    await expect(translatePersonFields(ctx(grant()), PID, input(), s.deps)).rejects.toMatchObject({ code: 'quota_reached' })
    expect(s.provider.translate).not.toHaveBeenCalled()
    expect(s.usage).toEqual([])
  })
})

describe('what one click does', () => {
  it('translates the SAVED source into empty targets only, never over reviewed text, and meters every call', async () => {
    const s = setup()
    const r = await translatePersonFields(ctx(grant()), PID, input(), s.deps)
    expect(s.calls).toEqual([{ texts: ['Insegnante'], target: 'de' }]) // fr is reviewed
    expect(r.results.jobTitle).toEqual({
      de: { text: '[de] Insegnante', meta: expect.objectContaining({ status: 'machine', provider: 'google', sourceLocale: 'it', textHash: hashText('[de] Insegnante'), sourceHash: hashText('Insegnante'), translatedAt: '2026-11-03T10:00:00.000Z' }) },
    })
    expect(r.skipped).toEqual([{ field: 'jobTitle', locale: 'fr', reason: 'protected' }])
    expect(s.usage).toEqual([expect.objectContaining({ project_id: PID, provider: 'google', source_locale: 'it', target_locale: 'de', characters: 10, sanity_document_id: 'anna', actor_id: 'u1' })])
  })

  it('re-translates an untouched machine value but not one that was edited', async () => {
    const machine = (text: string, hashOf = text) => ({ status: 'machine', textHash: hashText(hashOf) })
    const untouched = setup({ doc: person({ jobTitle: { it: 'Insegnante', de: 'alt', fr: 'alt', translationStatus: { de: machine('alt'), fr: machine('alt') } } }) })
    expect(Object.keys((await translatePersonFields(ctx(grant()), PID, input(), untouched.deps)).results.jobTitle ?? {}).sort()).toEqual(['de', 'fr'])
    const edited = setup({ doc: person({ jobTitle: { it: 'Insegnante', de: 'von Hand geändert', fr: 'alt', translationStatus: { de: machine('de', 'original-machine-text'), fr: machine('alt') } } }) })
    const r = await translatePersonFields(ctx(grant()), PID, input(), edited.deps)
    expect(Object.keys(r.results.jobTitle ?? {})).toEqual(['fr'])
    expect(r.skipped).toContainEqual({ field: 'jobTitle', locale: 'de', reason: 'protected' })
  })

  it('typed (original) text in a target is never overwritten', async () => {
    const s = setup({ doc: person({ jobTitle: { it: 'Insegnante', de: 'Lehrerin', fr: 'Professeure' } }) })
    const r = await translatePersonFields(ctx(grant()), PID, input(), s.deps)
    expect(r.results).toEqual({})
    expect(r.skipped).toHaveLength(2)
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('translates several fields, one metered call per field and target', async () => {
    const s = setup()
    const r = await translatePersonFields(ctx(grant()), PID, input({ fields: ['jobTitle', 'shortBio'] }), s.deps)
    expect(Object.keys(r.results)).toEqual(['jobTitle', 'shortBio'])
    expect(Object.keys(r.results.shortBio ?? {}).sort()).toEqual(['de', 'fr'])
    expect(s.usage).toHaveLength(3)
  })

  it('a result longer than the field allows is not offered', async () => {
    const s = setup({ reply: () => 'x'.repeat(130) })
    const r = await translatePersonFields(ctx(grant()), PID, input(), s.deps)
    expect(r.results).toEqual({})
    expect(r.skipped).toContainEqual({ field: 'jobTitle', locale: 'de', reason: 'too_long' })
  })

  it('without source text there is nothing to translate and no provider call', async () => {
    const s = setup({ doc: person({ jobTitle: { de: 'Lehrerin' } }) })
    await expect(translatePersonFields(ctx(grant()), PID, input(), s.deps)).rejects.toBeInstanceOf(TranslateError)
    expect(s.provider.translate).not.toHaveBeenCalled()
  })

  it('reads the saved person (draft first, else published)', async () => {
    const s = setup()
    await translatePersonFields(ctx(grant()), PID, input(), s.deps)
    expect(s.getDocument.mock.calls.map((c) => c[0]).sort()).toEqual(['anna', 'drafts.anna'])
  })
})
