'use client'

/**
 * @deprecated Use `@/components/SiteControls/ThemeSwitcher` instead.
 * This legacy file is unreferenced and will be removed in a future cleanup pass.
 */

import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'

// ─── Theme logic ──────────────────────────────────────────────────────────────
// Dark-first: `:root` = dark (no class), `html.light` = light override.

export type Theme = 'light' | 'dark' | 'system'
export const THEME_KEY = 'abluo-theme'

export function applyTheme(t: Theme) {
  const resolved =
    t === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : t
  document.documentElement.classList.toggle('light', resolved === 'light')
}

// ─── Options ──────────────────────────────────────────────────────────────────

const OPTIONS: { value: Theme; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function ThemeSwitcher() {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Read stored preference on mount and apply
  useEffect(() => {
    try {
      const stored = (localStorage.getItem(THEME_KEY) as Theme) ?? 'dark'
      setThemeState(stored)
      applyTheme(stored)
    } catch {}
  }, [])

  // Re-apply on system theme change when in system mode
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function select(t: Theme) {
    setThemeState(t)
    try { localStorage.setItem(THEME_KEY, t) } catch {}
    applyTheme(t)
    setOpen(false)
  }

  const current = OPTIONS.find(o => o.value === theme) ?? OPTIONS[1]
  const { Icon: CurrentIcon } = current

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
        style={{
          color: 'var(--color-text-muted)',
          backgroundColor: open ? 'var(--color-background-alt)' : 'transparent',
        }}
        aria-label="Theme switcher" /* TODO: localize via getThemeSwitcherMessages when this component is activated */
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrentIcon size={15} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[500] min-w-[140px] rounded-xl border p-1.5 shadow-2xl"
          style={{
            backgroundColor: 'var(--color-background-alt)',
            borderColor: 'var(--color-border)',
          }}
          role="listbox"
        >
          {OPTIONS.map(({ value, label, Icon }) => {
            const isActive = theme === value
            return (
              <button
                key={value}
                role="option"
                aria-selected={isActive}
                onClick={() => select(value)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors"
                style={{
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-primary)',
                  opacity: isActive ? 1 : 0.72,
                  backgroundColor: isActive
                    ? 'color-mix(in oklch, var(--color-primary) 8%, transparent)'
                    : 'transparent',
                }}
              >
                <Icon size={13} />
                <span>{label}</span>
                {isActive && (
                  <span
                    className="ml-auto h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
