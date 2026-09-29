import { describe, it, expect, vi } from 'vitest'
import { getTranslateStatus, runTranslate, type TranslateDeps } from '../service'
import type { ResolvedTranslateConfig } from '../config'
import type { TranslationProvider } from '../providers/types'
import { TranslateError } from '../types'
import { validateTranslateRequest } from '../validate'

const CONFIG: ResolvedTranslateConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  enabled: true,
  provider: 'google',
  quota: null,
  supportedLocales: ['en', 'fr', 'de'],
}

function fakeProvider(configured = true): TranslationProvider {
  return {
    id: 'google',
    isConfigured: () => configured,
    translate: vi.fn(async ({ texts, target }) => ({
      texts: texts.map((t: string) => `[${target}] ${t}`),
      billedCharacters: texts.join('').length,
    })),
  }
}

function deps(overrides: Partial<TranslateDeps> = {}, config: ResolvedTranslateConfig | null = CONFIG) {
  const provider = fakeProvider()
  const d: TranslateDeps = {
    loadConfig: vi.fn(async () => config),
    getProvider: vi.fn(() => provider),
    getMonthToDate: vi.fn(async () => 0),
    projectIsMeterable: vi.fn(async () => true),
    recordUsage: vi.fn(async () => {}),
    environment: 'test',
    logError: vi.fn(),
    ...overrides,
  }
  return { d, provider }
}

const req = (over: Record<string, unknown> = {}) =>
  validateTranslateRequest({
    projectSlug: 'cyce', sourceLocale: 'en', targetLocales: ['fr', 'de'], texts: ['Hello'],
    documentId: 'page-1', ...over,
  })

async function codeOf(p: Promise<unknown>) {
  try {
    await p
    return 'ok'
  } catch (err) {
    return err instanceof TranslateError ? err.code : String(err)
  }
}

describe('runTranslate', () => {
  it('translates into every target and records one usage row per target', async () => {
    const { d } = deps()
    const out = await runTranslate(req(), 'user-1', d)
    expect(out.translations).toEqual({ fr: ['[fr] Hello'], de: ['[de] Hello'] })
    expect(out.usage.charactersThisRequest).toBe(10)
    expect(d.recordUsage).toHaveBeenCalledWith([
      expect.objectContaining({ target_locale: 'fr', characters: 5, provider: 'google', actor_id: 'user-1', sanity_document_id: 'page-1', environment: 'test' }),
      expect.objectContaining({ target_locale: 'de', characters: 5 }),
    ])
  })

  it('refuses when the project is unknown, the module is off, or there is no Supabase project id', async () => {
    expect(await codeOf(runTranslate(req(), null, deps({}, null).d))).toBe('project_not_found')
    expect(await codeOf(runTranslate(req(), null, deps({}, { ...CONFIG, enabled: false }).d))).toBe('module_disabled')
    expect(await codeOf(runTranslate(req(), null, deps({}, { ...CONFIG, projectId: null }).d))).toBe('usage_unavailable')
  })

  it('refuses — before calling the provider — when usage could not be recorded for the project', async () => {
    const a = deps({ projectIsMeterable: vi.fn(async () => false) })
    expect(await codeOf(runTranslate(req(), null, a.d))).toBe('usage_unavailable')
    expect(a.provider.translate).not.toHaveBeenCalled()
    const b = deps({ projectIsMeterable: vi.fn(async () => { throw new Error('db down') }) })
    expect(await codeOf(runTranslate(req(), null, b.d))).toBe('usage_unavailable')
    expect(b.provider.translate).not.toHaveBeenCalled()
  })

  it('refuses languages the site does not offer', async () => {
    expect(await codeOf(runTranslate(req({ targetLocales: ['it'] }), null, deps().d))).toBe('invalid_request')
    expect(await codeOf(runTranslate(req(), null, deps({}, { ...CONFIG, supportedLocales: [] }).d))).toBe('invalid_request')
  })

  it('refuses when the provider has no key, before calling it', async () => {
    const provider = fakeProvider(false)
    const { d } = deps({ getProvider: () => provider })
    expect(await codeOf(runTranslate(req(), null, d))).toBe('provider_not_configured')
    expect(provider.translate).not.toHaveBeenCalled()
  })

  it('refuses a request that would cross the monthly quota, without calling the provider', async () => {
    const { d, provider } = deps({ getMonthToDate: vi.fn(async () => 995) }, { ...CONFIG, quota: 1000 })
    expect(await codeOf(runTranslate(req(), null, d))).toBe('quota_reached')
    expect(provider.translate).not.toHaveBeenCalled()
  })

  it('fails CLOSED when a quota is set and usage cannot be read', async () => {
    const { d, provider } = deps(
      { getMonthToDate: vi.fn(async () => { throw new Error('db down') }) },
      { ...CONFIG, quota: 1000 }
    )
    expect(await codeOf(runTranslate(req(), null, d))).toBe('usage_unavailable')
    expect(provider.translate).not.toHaveBeenCalled()
  })

  it('still returns the translation when recording usage fails, and logs it', async () => {
    const { d } = deps({ recordUsage: vi.fn(async () => { throw new Error('insert failed') }) }, { ...CONFIG, quota: 1000 })
    const out = await runTranslate(req(), null, d)
    expect(out.translations.fr).toEqual(['[fr] Hello'])
    expect(out.usage).toEqual({ charactersThisRequest: 10, monthToDate: 10, quota: 1000 })
    expect(d.logError).toHaveBeenCalledWith(expect.stringContaining('USAGE NOT RECORDED'), expect.anything())
  })
})

describe('getTranslateStatus', () => {
  it('reports a disabled module without touching the provider', async () => {
    const { d } = deps({}, { ...CONFIG, enabled: false })
    const s = await getTranslateStatus('cyce', d)
    expect(s).toMatchObject({ enabled: false, provider: null })
    expect(d.getProvider).not.toHaveBeenCalled()
  })

  it('reports usage, quota and whether it is reached', async () => {
    const { d } = deps({ getMonthToDate: vi.fn(async () => 1200) }, { ...CONFIG, quota: 1000 })
    expect(await getTranslateStatus('cyce', d)).toMatchObject({
      enabled: true, provider: 'google', providerConfigured: true,
      quota: 1000, monthToDate: 1200, quotaReached: true, supportedLocales: ['en', 'fr', 'de'],
    })
  })

  it('treats unreadable usage under a quota as reached (same fail-closed rule)', async () => {
    const { d } = deps({ getMonthToDate: vi.fn(async () => { throw new Error('x') }) }, { ...CONFIG, quota: 1000 })
    expect(await getTranslateStatus('cyce', d)).toMatchObject({ monthToDate: null, quotaReached: true })
  })
})
