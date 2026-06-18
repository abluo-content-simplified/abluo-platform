'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from '@/i18n/navigation'
import { ChevronDown } from 'lucide-react'
import type { SupportedLocale } from '@/lib/i18n/locales'
import { LOCALE_LABELS, LOCALE_NATIVE_NAMES } from '@/lib/i18n/locales'
import { useSlugMap } from '@/components/SlugMapContext'

interface LanguageSwitcherProps {
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
  tenantId?: string
  appearance?: 'header' | 'footer' | 'drawer'
}

export function LanguageSwitcher({ currentLocale, supportedLocales, tenantId, appearance = 'header' }: LanguageSwitcherProps) {
  const pathname = usePathname()
  const router = useRouter()
  const slugMap = useSlugMap()
  const [langOpen, setLangOpen] = useState(false)

  // Auto-hide if only one locale
  if (supportedLocales.length <= 1) return null

  const switchLocale = (locale: SupportedLocale) => {
    const targetSlug = slugMap[locale]
    if (targetSlug && tenantId) {
      // Slug page: navigate directly to the locale-specific slug URL.
      router.push(`/${tenantId}/${targetSlug}`, { locale })
    } else if (tenantId) {
      // Homepage or non-slug route on a tenant custom domain.
      // Use the explicit tenant path so the URL is always in the stable
      // /{locale}/{tenantId} form — never a bare /{locale} that the proxy
      // would rewrite transparently and cause usePathname() timing issues.
      router.replace(`/${tenantId}`, { locale })
    } else {
      // Platform route (no tenant): same path, different locale prefix.
      router.replace(pathname, { locale })
    }
    setLangOpen(false)
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (appearance !== 'header') return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-lang-switch]')) setLangOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [appearance])

  // Drawer appearance
  if (appearance === 'drawer') {
    return (
      <div className="px-6">
        <p
          className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--color-text-primary)', opacity: 0.3 }}
        >
          Language
        </p>
        <div className="flex gap-2">
          {supportedLocales.map((locale) => (
            <button
              key={locale}
              onClick={() => switchLocale(locale)}
              className="flex-1 rounded-[9px] border py-2.5 text-sm font-semibold tracking-wide transition-all"
              style={
                locale === currentLocale
                  ? {
                      borderColor: 'var(--color-primary)',
                      backgroundColor: 'color-mix(in oklch, var(--color-primary) 10%, transparent)',
                      color: 'var(--color-primary)',
                    }
                  : {
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'transparent',
                      color: 'var(--color-text-primary)',
                      opacity: 0.65,
                    }
              }
            >
              {LOCALE_LABELS[locale]}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Header/Footer appearance
  return (
    <div className="relative" data-lang-switch>
      <button
        onClick={() => setLangOpen(!langOpen)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold tracking-wide transition-all"
        style={{ color: 'var(--color-text-primary)', opacity: 0.72 }}
        aria-haspopup="listbox"
        aria-expanded={langOpen}
      >
        {LOCALE_LABELS[currentLocale]}
        <ChevronDown
          size={11}
          className={`transition-transform ${langOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {langOpen && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[500] min-w-[120px] rounded-xl border p-1.5 shadow-2xl"
          style={{
            backgroundColor: 'var(--color-background-alt)',
            borderColor: 'var(--color-border)',
          }}
        >
          {supportedLocales.map((locale) => (
            <button
              key={locale}
              onClick={() => switchLocale(locale)}
              className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                color: locale === currentLocale ? 'var(--color-primary)' : 'var(--color-text-primary)',
                fontWeight: locale === currentLocale ? 700 : 500,
                opacity: locale === currentLocale ? 1 : 0.75,
              }}
            >
              {LOCALE_NATIVE_NAMES[locale]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
