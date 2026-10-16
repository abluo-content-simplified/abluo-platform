import { describe, it, expect } from 'vitest'
import { BRAND_HUB_MESSAGES_FOR_TEST, getBrandHubMessages, formatBrandHubMessage } from '../brand-hub-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }),
      {},
    )
  }
  return { [prefix]: value }
}

describe('brand hub messages', () => {
  it('covers every platform locale with every key, non-empty', () => {
    const enKeys = Object.keys(flatten(BRAND_HUB_MESSAGES_FOR_TEST.en)).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = BRAND_HUB_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      const flat = flatten(m)
      expect(Object.keys(flat).sort()).toEqual(enKeys)
      for (const k of enKeys) {
        expect(typeof flat[k] === 'string' && (flat[k] as string).trim().length > 0, `${code}.${k}`).toBe(true)
      }
    }
  })
  it('keeps placeholders in every locale', () => {
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = BRAND_HUB_MESSAGES_FOR_TEST[code]
      expect(m.version).toContain('{version}')
      expect(m.lastUpdated).toContain('{date}')
      expect(m.copyLabel).toContain('{value}')
      expect(m.opacityNote).toContain('{n}')
      expect(m.opacityNote).toContain('{role}')
      expect(m.sameAs).toContain('{role}')
      expect(m.contrastOn).toContain('{role}')
    }
  })
  it('falls back to English', () => {
    expect(getBrandHubMessages('xx').copy).toBe('Copy')
    expect(getBrandHubMessages(undefined).copy).toBe('Copy')
  })
  it('fills placeholders', () => {
    expect(formatBrandHubMessage(getBrandHubMessages('it').sameAs, { role: 'Sfondo' })).toBe('Uguale a Sfondo')
  })
})
