'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { INTERFACE_LOCALES, LOCALE_NATIVE_NAMES, type InterfaceLocale } from '@/lib/i18n/locales'

/**
 * Interface language for the Abluo App (client dashboard + admin), first row
 * of Preferences (Tom, 2026-10-22). Lists INTERFACE_LOCALES — the languages
 * the dashboards are translated into — each in its own language ("Italiano",
 * "Deutsch"), so a person can find theirs whatever the current language is.
 *
 * Switching re-opens the same page under the new locale prefix; next-intl
 * writes the NEXT_LOCALE cookie (one year, routing.ts), which the proxy and
 * post-login use next time. Never touches a website's content language.
 *
 * Same segmented look as AppThemeSwitch / AppTextSizeSwitch.
 */
export function AppLanguageSwitch() {
  const t = useTranslations('app.language')
  const current = useLocale()
  const router = useRouter()
  const pathname = usePathname() // locale-stripped
  const [pending, startTransition] = useTransition()

  function choose(next: InterfaceLocale) {
    if (next === current) return
    const search = typeof window !== 'undefined' ? window.location.search : ''
    startTransition(() => {
      router.replace(`${pathname}${search}`, { locale: next })
    })
  }

  return (
    <div>
      <p id="app-language-label" className="text-xs text-muted-foreground">
        {t('label')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="app-language-label"
        aria-busy={pending}
        className="mt-1.5 grid gap-0.5 rounded-lg bg-secondary p-0.5"
        style={{ gridTemplateColumns: `repeat(${INTERFACE_LOCALES.length}, minmax(0, 1fr))` }}
      >
        {INTERFACE_LOCALES.map((code) => {
          const on = code === current
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              lang={code}
              disabled={pending}
              onClick={() => choose(code)}
              className={`h-11 rounded-md md:h-8 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
                on
                  ? 'bg-background font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {LOCALE_NATIVE_NAMES[code]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
