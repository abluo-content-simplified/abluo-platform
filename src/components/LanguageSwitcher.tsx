'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const locales = ['it', 'en'] as const

interface Props {
  currentLocale: string
  tenant: string
}

export function LanguageSwitcher({ currentLocale, tenant }: Props) {
  const pathname = usePathname()

  const switchLocale = (locale: string) => {
    // Always build URL from the tenant slug — works on any domain or URL
    // structure (preview.abluo.app/slug, studiomartegani.com, /it/slug, etc.)
    const segments = pathname.split('/').filter(Boolean)
    const tenantIndex = segments.findIndex(s => s === tenant)
    const afterTenant = tenantIndex >= 0
      ? segments.slice(tenantIndex + 1).join('/')
      : ''
    return `/${locale}/${tenant}${afterTenant ? '/' + afterTenant : ''}`
  }

  return (
    <div className="flex items-center gap-1">
      {locales.map((locale, i) => (
        <span key={locale} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-zinc-200 select-none">/</span>
          )}
          <Link
            href={switchLocale(locale)}
            className={`text-xs font-medium tracking-widest uppercase transition-colors ${
              currentLocale === locale
                ? 'text-zinc-900'
                : 'text-zinc-400 hover:text-zinc-600'
            }`}
          >
            {locale}
          </Link>
        </span>
      ))}
    </div>
  )
}
