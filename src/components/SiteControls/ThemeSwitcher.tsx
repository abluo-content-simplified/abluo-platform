'use client'

/**
 * ThemeSwitcher — Site Controls
 *
 * LOCALIZATION: all user-facing labels come from the `messages` prop.
 * Use `getThemeSwitcherMessages(locale)` from `@/lib/i18n/theme-switcher-messages`
 * to build a localized messages object before rendering this component.
 * Defaults to English via `defaultThemeSwitcherMessages` if the prop is omitted.
 */

import { useState, useEffect } from 'react'
import { Sun, Moon, MonitorCog, ChevronDown } from 'lucide-react'
import {
  defaultThemeSwitcherMessages,
  type ThemeSwitcherMessages,
} from '@/lib/i18n/theme-switcher-messages'

type Theme = 'light' | 'dark' | 'system'
type ThemeMode = 'lightOnly' | 'darkOnly' | 'toggle' | 'system'

interface ThemeSwitcherProps {
  themeMode?: ThemeMode
  appearance?: 'header' | 'footer' | 'drawer'
  /**
   * Localized UI labels.
   * Defaults to English. Pass `getThemeSwitcherMessages(locale)` for full i18n.
   */
  messages?: ThemeSwitcherMessages
}

function applyTheme(t: Theme) {
  const resolved =
    t === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : t
  document.documentElement.classList.toggle('light', resolved === 'light')
}

function useTheme() {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    const stored = (localStorage.getItem('abluo-theme') as Theme) ?? 'dark'
    setThemeState(stored)
    applyTheme(stored)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if ((localStorage.getItem('abluo-theme') as Theme) === 'system') applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function setTheme(t: Theme) {
    localStorage.setItem('abluo-theme', t)
    setThemeState(t)
    applyTheme(t)
  }

  return { theme, setTheme }
}

export function ThemeSwitcher({
  themeMode = 'toggle',
  appearance = 'header',
  messages = defaultThemeSwitcherMessages,
}: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme()
  const [themeOpen, setThemeOpen] = useState(false)

  // Hide if lightOnly or darkOnly
  if (themeMode === 'lightOnly' || themeMode === 'darkOnly' || themeMode === 'system') {
    return null
  }

  const getThemeIcon = (t: Theme) => {
    return t === 'light' ? <Sun size={15} /> : t === 'dark' ? <Moon size={15} /> : <MonitorCog size={15} />
  }

  const availableThemes: Theme[] = ['light', 'dark', 'system']
  const themeIcon = getThemeIcon(theme)

  // Close dropdown on outside click
  useEffect(() => {
    if (appearance !== 'header') return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-theme-switch]')) setThemeOpen(false)
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
          {messages.appearanceLabel}
        </p>
        <div className="flex flex-col gap-1">
          {availableThemes.map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className="flex w-full items-center gap-3 rounded-[9px] border px-4 py-2.5 text-sm font-medium transition-all"
              style={
                theme === t
                  ? {
                      borderColor: 'var(--color-primary)',
                      backgroundColor: 'color-mix(in oklch, var(--color-primary) 8%, transparent)',
                      color: 'var(--color-primary)',
                    }
                  : {
                      borderColor: 'transparent',
                      backgroundColor: 'transparent',
                      color: 'var(--color-text-primary)',
                      opacity: 0.65,
                    }
              }
            >
              {getThemeIcon(t)}
              {messages.themes[t]}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Header/Footer appearance
  return (
    <div className="relative" data-theme-switch>
      <button
        onClick={() => setThemeOpen(!themeOpen)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all"
        style={{ color: 'var(--color-text-primary)', opacity: 0.72 }}
        aria-label={messages.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={themeOpen}
      >
        {themeIcon}
        <ChevronDown
          size={11}
          className={`transition-transform ${themeOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {themeOpen && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[500] min-w-[140px] rounded-xl border p-1.5 shadow-2xl"
          style={{
            backgroundColor: 'var(--color-background-alt)',
            borderColor: 'var(--color-border)',
          }}
        >
          {availableThemes.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTheme(t)
                setThemeOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{
                color: theme === t ? 'var(--color-primary)' : 'var(--color-text-primary)',
                fontWeight: theme === t ? 600 : 500,
                opacity: theme === t ? 1 : 0.75,
              }}
            >
              {getThemeIcon(t)}
              {messages.themes[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
