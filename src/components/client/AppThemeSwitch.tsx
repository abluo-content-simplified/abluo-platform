'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { APP_THEMES, appThemeAttribute, appThemeCookie, type AppTheme } from '@/lib/app-theme'

/**
 * Light / Dark / Auto switch for the Abluo App (ADR-025 D7).
 *
 * Writes the `abluo-app-theme` cookie (read by `(client)/layout.tsx` on the
 * next request) and updates `data-theme` on the nearest `.abluo-app` right
 * away, so the change is instant and there is no reload. It never touches the
 * website theme switch (`abluo-theme`, `html.light`).
 *
 * Segments are 44px tall on phones (touch), 32px from md up.
 *
 * A segmented control, not a dropdown (wizard rule T3 applies app-wide in spirit).
 */
export function AppThemeSwitch({ initial }: { initial: AppTheme }) {
  const t = useTranslations('clientDashboard.theme')
  const [theme, setTheme] = useState<AppTheme>(initial)

  function choose(next: AppTheme, el: HTMLElement) {
    setTheme(next)
    writeCookie(appThemeCookie(next))
    const root = el.closest<HTMLElement>('.abluo-app')
    if (!root) return
    const attr = appThemeAttribute(next)
    if (attr) root.dataset.theme = attr
    else delete root.dataset.theme
  }

  return (
    <div>
      <p id="app-theme-label" className="text-xs text-muted-foreground">
        {t('label')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="app-theme-label"
        className="mt-1.5 grid grid-cols-3 gap-0.5 rounded-lg bg-secondary p-0.5"
      >
        {APP_THEMES.map((option) => {
          const on = option === theme
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={(e) => choose(option, e.currentTarget)}
              className={`h-11 rounded-md md:h-8 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                on
                  ? 'bg-background font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(option)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Module-level so the React compiler doesn't treat it as mutating render state. */
function writeCookie(value: string) {
  document.cookie = value
}
