import { describe, it, expect } from 'vitest'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { getValidationMessages } from '@/lib/forms/validation-messages'
import { EVENT_MESSAGES_FOR_TEST } from '@/lib/i18n/event-messages'
import { getLivePageMessages } from '@/lib/i18n/live-page-messages'
import { getLanguageSwitcherMessages, LANGUAGE_SWITCHER_MESSAGES_FOR_TEST } from '@/lib/i18n/language-switcher-messages'

// German website chrome addresses the visitor formally ("Sie"), like the rest
// of the platform's German strings and the sites built on it. QA 2026-10-02
// found the invalid-email message saying "Bitte gib…" next to "Bitte geben
// Sie…".
const INFORMAL = /\b(du|dich|dir|dein\w*|gib|wähle|schau|klicke|prüfe|versuche)\b/i

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') {
    const out = (value as (...a: unknown[]) => unknown)(3, 'file.pdf', 5)
    return typeof out === 'string' ? [out] : []
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('German platform strings use the formal register', () => {
  it.each([
    ['validation messages', getValidationMessages('de')],
    ['event messages', EVENT_MESSAGES_FOR_TEST.de],
    ['live page messages', getLivePageMessages('de')],
  ])('%s', (_name, messages) => {
    const informal = strings(messages).filter((s) => INFORMAL.test(s))
    expect(informal).toEqual([])
  })

  it('invalid email reads "Bitte geben Sie…"', () => {
    expect(getValidationMessages('de').invalidEmail).toBe('Bitte geben Sie eine gültige E-Mail-Adresse ein')
  })
})

describe('language switcher label is localized', () => {
  it('has an entry for every platform locale', () => {
    for (const code of LOCALE_CODES) expect(LANGUAGE_SWITCHER_MESSAGES_FOR_TEST[code]?.languageLabel).toBeTruthy()
  })

  it('Italian is not English', () => {
    expect(getLanguageSwitcherMessages('it').languageLabel).toBe('Lingua')
    expect(getLanguageSwitcherMessages('de').languageLabel).toBe('Sprache')
  })
})
