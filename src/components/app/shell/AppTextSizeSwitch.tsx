'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { APP_TEXT_SIZES, appTextSizeAttribute, appTextSizeCookie, type AppTextSize } from '@/lib/app-theme'

/**
 * Text size for the Abluo App: Small / Default / Large / Extra large.
 * Writes the `abluo-app-text` cookie and updates `data-text-size` on the
 * nearest `.abluo-app` at once (no reload). Never touches the websites.
 */
export function AppTextSizeSwitch({ initial }: { initial: AppTextSize }) {
  const t = useTranslations('app.textSize')
  const [size, setSize] = useState<AppTextSize>(initial)

  function choose(next: AppTextSize, el: HTMLElement) {
    setSize(next)
    writeCookie(appTextSizeCookie(next))
    const root = el.closest<HTMLElement>('.abluo-app')
    if (!root) return
    const attr = appTextSizeAttribute(next)
    if (attr) root.dataset.textSize = attr
    else delete root.dataset.textSize
  }

  // Each option shows an "A" at its own size, so the choice is visible before reading.
  const glyph: Record<AppTextSize, string> = { sm: 'text-[11px]', md: 'text-[13px]', lg: 'text-[15px]', xl: 'text-[17px]' }

  return (
    <div>
      <p id="app-text-size-label" className="text-xs text-muted-foreground">
        {t('label')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="app-text-size-label"
        className="mt-1.5 grid grid-cols-4 gap-0.5 rounded-lg bg-secondary p-0.5"
      >
        {APP_TEXT_SIZES.map((option) => {
          const on = option === size
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(option)}
              title={t(option)}
              onClick={(e) => choose(option, e.currentTarget)}
              className={`h-11 rounded-md md:h-8 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${glyph[option]} ${
                on
                  ? 'bg-background font-semibold text-foreground shadow-sm'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              A
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
