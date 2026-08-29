import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import type { SupportedLocale } from '@/lib/i18n/locales'

// Locales advertised by the Platform Locale Registry can outrun the message
// bundles in messages/ — translations are content and ship separately from the
// code that enables a language. A missing bundle must degrade to English, not
// throw a 500 for the whole request.
const warnedLocales = new Set<string>()

async function loadMessages(locale: string) {
  try {
    return (await import(`../../messages/${locale}.json`)).default
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
