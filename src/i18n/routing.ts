import { defineRouting } from 'next-intl/routing'
import { LOCALE_CODES } from '@/lib/i18n/locales'

// locales is derived from the Platform Locale Registry.
// To add a language, edit src/lib/i18n/locales.ts and add a messages/<code>.json file.
export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: 'en',
})
