import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import type { SupportedLocale } from '@/lib/i18n/locales'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale

  if (!locale || !routing.locales.includes(locale as SupportedLocale)) {
    locale = routing.defaultLocale
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
