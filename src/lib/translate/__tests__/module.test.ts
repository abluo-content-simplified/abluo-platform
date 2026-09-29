import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { MODULE_PERMISSION_MAP } from '@/lib/modules/permissions'
import { resolveTranslateConfig } from '../config'
import { TRANSLATE_ERROR_CODES, TRANSLATION_PROVIDER_IDS } from '../types'
import { getTranslateMessages, TRANSLATE_MESSAGE_LOCALES } from '@/lib/i18n/translate-messages'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { schemaTypes } from '@/lib/sanity/schema'

const root = resolve(__dirname, '../../../..')

describe('Translate module manifest (ADR-023 §1–2)', () => {
  const m = MODULE_REGISTRY.find((x) => x.id === 'translate')

  it('is registered with no content types, sections or website surface', () => {
    expect(m).toBeDefined()
    expect(m!.platformContract.schemaTypes).toEqual([])
    expect(m!.platformContract.sectionTypes).toEqual([])
    expect(m!.platformContract.placement.surfaces).toEqual([])
    expect(m!.dataStore.primary).toBe('hybrid')
  })

  it('declares translate.use and translate.usage.read', () => {
    expect(MODULE_PERMISSION_MAP['translate.use']?.defaultRoles).toEqual(['owner', 'editor'])
    expect(MODULE_PERMISSION_MAP['translate.usage.read']?.defaultRoles).toEqual(['owner'])
  })

  it('offers exactly the providers the code implements', () => {
    const provider = m!.platformContract.configSchema.find((f) => f.id === 'provider')
    expect(provider?.options?.map((o) => o.value)).toEqual([...TRANSLATION_PROVIDER_IDS])
  })

  it('keeps API keys out of module config (the dataset is public)', () => {
    const ids = m!.platformContract.configSchema.map((f) => f.id.toLowerCase())
    for (const id of ids) expect(id).not.toMatch(/key|secret|token/)
  })
})

describe('resolveTranslateConfig', () => {
  it('defaults to google, no quota, and only platform locales', () => {
    expect(
      resolveTranslateConfig({ projectId: 'p', translate: { config: {} }, supportedLocales: ['en', 'fr', 'xx'] })
    ).toEqual({ projectId: 'p', enabled: true, provider: 'google', quota: null, supportedLocales: ['en', 'fr'] })
  })

  it('reads provider and quota, and treats a missing installation as disabled', () => {
    expect(
      resolveTranslateConfig({ projectId: 'p', translate: { config: { provider: 'deepl', monthlyCharacterQuota: 5000 } } })
    ).toMatchObject({ enabled: true, provider: 'deepl', quota: 5000 })
    expect(resolveTranslateConfig({ projectId: 'p', translate: null })).toMatchObject({ enabled: false })
    expect(resolveTranslateConfig({ projectId: 'p', translate: { config: { provider: 'babelfish' } } })?.provider).toBe('google')
    expect(resolveTranslateConfig(null)).toBeNull()
  })
})

describe('Translate messages (ADR-023 §9)', () => {
  it('exist for every platform locale and every error code', () => {
    expect([...TRANSLATE_MESSAGE_LOCALES].sort()).toEqual([...LOCALE_CODES].sort())
    const en = getTranslateMessages('en')
    for (const locale of LOCALE_CODES) {
      const msg = getTranslateMessages(locale)
      expect(Object.keys(msg).sort()).toEqual(Object.keys(en).sort())
      for (const code of TRANSLATE_ERROR_CODES) expect(msg.errors[code]).toBeTruthy()
    }
  })
})

describe('translationStatus schema (ADR-023 §4)', () => {
  const byName = new Map((schemaTypes as { name: string; fields?: { name: string; hidden?: unknown; type?: string }[] }[]).map((t) => [t.name, t]))

  it('every localized text type carries one hidden translationStatus field', () => {
    for (const name of ['localizedString', 'localizedText', 'localizedPortableText']) {
      const fields = byName.get(name)?.fields ?? []
      const status = fields.filter((f) => f.name === 'translationStatus')
      expect(status, name).toHaveLength(1)
      expect(status[0].hidden).toBe(true)
      expect(status[0].type).toBe('translationStatus')
      // Every locale field is still there.
      for (const code of LOCALE_CODES) expect(fields.some((f) => f.name === code), `${name}.${code}`).toBe(true)
    }
  })

  it('is never projected by a website query', () => {
    const queries = readFileSync(resolve(root, 'src/lib/sanity/queries.ts'), 'utf-8')
    expect(queries).not.toMatch(/translationStatus/)
  })
})
