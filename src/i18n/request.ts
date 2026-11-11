import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { withEnglishFallback } from '@/lib/i18n/with-fallback'

// Locales advertised by the Platform Locale Registry can outrun the message
// bundles in messages/ — translations are content and ship separately from the
// code that enables a language. A missing bundle must degrade to English, not
// throw a 500 for the whole request.
const warnedLocales = new Set<string>()
/** Each language merged over English once per server instance (the bundles never change at runtime). */
const merged = new Map<string, Record<string, unknown>>()

async function loadMessages(locale: string) {
  try {
    const bundle = (await import(`../../messages/${locale}.json`)).default
    if (locale === 'en') return bundle
    // A language that is still being translated (French, added 2026-11-11) shows English for the
    // text it does not have yet — never a raw key.
    const cached = merged.get(locale)
    if (cached) return cached
    const en = (await import('../../messages/en.json')).default
    const full = withEnglishFallback(en as Record<string, unknown>, bundle)
    merged.set(locale, full)
    return full
  } catch {
    if (!warnedLocales.has(locale)) {
      warnedLocales.add(locale)
      console.warn(
        `[i18n] No messages bundle found for locale "${locale}" (messages/${locale}.json). Falling back to "en".`
      )
    }
    return (await import('../../messages/en.json')).default
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !routing.locales.includes(locale as SupportedLocale)) {
    locale = routing.defaultLocale
  }

  return {
    locale,
    messages: await loadMessages(locale),
  }
})
