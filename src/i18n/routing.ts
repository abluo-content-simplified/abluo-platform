import { defineRouting } from 'next-intl/routing'
import { LOCALE_CODES } from '@/lib/i18n/locales'

// locales is derived from the Platform Locale Registry.
// To add a language, edit src/lib/i18n/locales.ts and add a messages/<code>.json file.
export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: 'en',
  // The language switcher writes NEXT_LOCALE when a visitor changes language.
  // Without maxAge it was a SESSION cookie — gone when the browser closed, so
  // "I switched to English, next time show me English" did not hold. One year,
  // per the platform rule in src/lib/i18n/negotiate-locale.ts.
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
})
