'use client'

import { useRouter, usePathname } from '@/i18n/navigation'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { LOCALE_NATIVE_NAMES } from '@/lib/i18n/locales'

interface LanguageSwitcherProps {
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
}

export function FooterLanguageSwitcher({
  currentLocale,
  supportedLocales,
}: LanguageSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()

  function switchLocale(locale: SupportedLocale) {
    // next-intl's router.replace handles locale prefix correctly
    router.replace(pathname, { locale })
  }

  if (supportedLocales.length <= 1) return null

  return (
    <div className="flex flex-wrap items-center gap-4">
      {supportedLocales.map((locale) => (
        <button
          key={locale}
          onClick={() => switchLocale(locale)}
          className="bg-transparent border-none p-0 cursor-pointer text-xs font-medium transition-opacity"
          style={{
            color: 'var(--color-text-primary)',
            opacity: locale === currentLocale ? 0.7 : 0.3,
            fontWeight: locale === currentLocale ? 600 : 400,
          }}
        >
          {LOCALE_NATIVE_NAMES[locale]}
        </button>
      ))}
    </div>
  )
}
