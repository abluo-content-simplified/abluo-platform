'use client'

import { useRouter, usePathname } from '@/i18n/navigation'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { LOCALE_NATIVE_NAMES } from '@/lib/i18n/locales'
import { useSlugMap } from '@/components/SlugMapContext'

interface LanguageSwitcherProps {
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
  tenantId?: string
}

export function FooterLanguageSwitcher({
  currentLocale,
  supportedLocales,
  tenantId,
}: LanguageSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()
  const slugMap = useSlugMap()

  function switchLocale(locale: SupportedLocale) {
    const targetSlug = slugMap[locale]
    if (targetSlug && tenantId) {
      router.push(`/${tenantId}/${targetSlug}`, { locale })
    } else if (tenantId) {
      router.replace(`/${tenantId}`, { locale })
    } else {
      router.replace(pathname, { locale })
    }
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
