import { describe, it, expect } from 'vitest'
import {
  DIGITAL_CARD_SITE_MESSAGES_FOR_TEST,
  formatDigitalCardSiteMessage,
  getDigitalCardSiteMessages,
} from '../digital-cards-site-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('digital cards website messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(DIGITAL_CARD_SITE_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = DIGITAL_CARD_SITE_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k], `${code}.${k}`).toBeTruthy()
    }
  })
  it('keeps the same placeholders in every locale', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',')
    for (const [k, v] of Object.entries(DIGITAL_CARD_SITE_MESSAGES_FOR_TEST.en)) {
      for (const code of Object.keys(PLATFORM_LOCALES)) {
        const t = (DIGITAL_CARD_SITE_MESSAGES_FOR_TEST[code] as unknown as Record<string, string>)[k]
        expect(ph(t), `${code}.${k}`).toBe(ph(v))
      }
    }
  })
  it('has the languages CYCE needs (en + fr) and falls back to English', () => {
    expect(getDigitalCardSiteMessages('fr').saveContact).toBe('Enregistrer le contact')
    expect(getDigitalCardSiteMessages('xx').saveContact).toBe('Save contact')
    expect(getDigitalCardSiteMessages(undefined).linkPhone).toBe('Call')
    expect(formatDigitalCardSiteMessage(getDigitalCardSiteMessages('it').moreAbout, { name: 'Sofia' })).toBe('Scopri di più su Sofia')
  })
})
