/**
 * LanguageSwitcher UI messages — the heading above the language options in the
 * mobile drawer / header menu. It was hardcoded "Language", so the Italian
 * menu read "LANGUAGE" next to "ASPETTO".
 *
 * Same pattern as theme-switcher-messages.ts; FUTURE: next-intl messages/.
 */

export interface LanguageSwitcherMessages {
  /** Section heading shown above the language options in the drawer. */
  languageLabel: string
}

const MESSAGES: Record<string, LanguageSwitcherMessages> = {
  en: { languageLabel: 'Language' },
  it: { languageLabel: 'Lingua' },
  de: { languageLabel: 'Sprache' },
  fr: { languageLabel: 'Langue' },
  es: { languageLabel: 'Idioma' },
  pt: { languageLabel: 'Idioma' },
  nl: { languageLabel: 'Taal' },
}

export function getLanguageSwitcherMessages(locale: string): LanguageSwitcherMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}

export const LANGUAGE_SWITCHER_MESSAGES_FOR_TEST = MESSAGES
