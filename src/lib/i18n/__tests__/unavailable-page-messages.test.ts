import { describe, it, expect } from 'vitest'
import { UNAVAILABLE_PAGE_MESSAGES_FOR_TEST, getUnavailablePageMessages } from '../unavailable-page-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'

describe('unavailable page messages (ADR-032 D12)', () => {
  it('covers every platform locale with every key', () => {
    const keys = Object.keys(UNAVAILABLE_PAGE_MESSAGES_FOR_TEST.en).sort()
    for (const code of Object.keys(PLATFORM_LOCALES)) {
      const m = UNAVAILABLE_PAGE_MESSAGES_FOR_TEST[code]
      expect(m, `missing locale ${code}`).toBeDefined()
      expect(Object.keys(m).sort()).toEqual(keys)
      for (const k of keys) expect((m as unknown as Record<string, string>)[k], `${code}.${k}`).toBeTruthy()
    }
  })
  it('uses the ADR copy in English', () => {
    const en = getUnavailablePageMessages('en')
    expect(en.heading).toBe('This page isn’t available.')
    expect(en.body).toBe('The page may have moved or may no longer be available. You can continue exploring the website using the links below.')
    expect(en.goHome).toBe('Go to homepage')
  })
  it('falls back to English', () => {
    expect(getUnavailablePageMessages('xx').goHome).toBe('Go to homepage')
    expect(getUnavailablePageMessages(undefined).goHome).toBe('Go to homepage')
    expect(getUnavailablePageMessages('it').goHome).toBe('Vai alla home page')
  })
})
