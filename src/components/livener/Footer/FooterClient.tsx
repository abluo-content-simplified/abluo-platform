'use client'

import { useRouter, usePathname } from 'next/navigation'
import type { SupportedLocale } from '@/lib/sanity/types'

interface LanguageSwitcherProps {
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
}

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  it: 'Italiano',
  de: 'Deutsch',
}

/**
 * Footer language switcher — always visible in the footer (no dropdown).
 * Shows all supported locales as discrete buttons.
 */
export function FooterLanguageSwitcher({
  currentLocale,
  supportedLocales,
}: LanguageSwitcherProps) {
  const router = useRouter()
  const pathname = usePathname()

  function switchLocale(locale: SupportedLocale) {
    const segments = pathname.split('/')
    segments[1] = locale
    router.push(segments.join('/'))
  }

  if (supportedLocales.length <= 1) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {supportedLocales.map((locale) => (
        <button
          key={locale}
          onClick={() => switchLocale(locale)}
          className={[
            'rounded-lg border px-3.5 py-1.5 text-sm font-medium transition-all',
            locale === currentLocale
              ? 'border-white/30 bg-white/10 text-white'
              : 'border-white/12 bg-transparent text-white/50 hover:border-white/25 hover:text-white/80',
          ].join(' ')}
        >
          {LOCALE_LABELS[locale]}
        </button>
      ))}
    </div>
  )
}
