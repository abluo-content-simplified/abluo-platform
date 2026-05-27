'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const locales = ['it', 'en'] as const

interface Props {
  currentLocale: string
}

export function LanguageSwitcher({ currentLocale }: Props) {
  const pathname = usePathname()

  const switchLocale = (locale: string) => {
    const segments = pathname.split('/')
    // segments[0] is '', segments[1] is the locale
    segments[1] = locale
    return segments.join('/')
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
