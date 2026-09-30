import { describe, it, expect } from 'vitest'
import { EVENT_MESSAGES_FOR_TEST, getEventMessages } from '../event-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('event messages', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(EVENT_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = EVENT_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k], `${code}.${k}`).toBeTruthy()
    }
  })
  it('keeps the {price} placeholder in every priceFrom', () => {
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      expect(EVENT_MESSAGES_FOR_TEST[code].priceFrom).toContain('{price}')
    }
  })
  it('falls back to English', () => {
    expect(getEventMessages('xx').registerFallback).toBe('Sign up')
    expect(getEventMessages('fr').registerFallback).toBe("S'inscrire")
    expect(getEventMessages('it').registerFallback).toBe('Iscriviti')
  })
})
