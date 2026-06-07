'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from '@/i18n/navigation'
import { Menu, X, ChevronDown, Sun, Moon, MonitorCog } from 'lucide-react'
import type { NavLink, SupportedLocale } from '@/lib/sanity/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavClientProps {
  logoSrc: string | undefined
  logoLightSrc: string | undefined
  logoAlt: string
  navLinks: NavLink[]
  ctaLabel: string
  ctaHref: string
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
  showLangSwitcherInNav: boolean
  variant?: 'full' | 'landing'
}

type Theme = 'light' | 'dark' | 'system'

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'EN',
  it: 'IT',
  de: 'DE',
}

const LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  it: 'Italiano',
  de: 'Deutsch',
}

// ─── Theme hook ───────────────────────────────────────────────────────────────
// Livener is dark-first: dark is the default (no class), light gets html.light

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
    const stored = (localStorage.getItem('livener-theme') as Theme) ?? 'dark'
    setThemeState(stored)
    applyTheme(stored)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if ((localStorage.getItem('livener-theme') as Theme) === 'system') applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function setTheme(t: Theme) {
    localStorage.setItem('livener-theme', t)
    setThemeState(t)
    applyTheme(t)
  }

  return { theme, setTheme }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NavClient({
  logoSrc,
  logoLightSrc,
  logoAlt,
  navLinks,
  ctaLabel,
  ctaHref,
  currentLocale,
  supportedLocales,
  showLangSwitcherInNav,
  variant = 'full',
}: NavClientProps) {
  // usePathname from next/navigation gives the raw pathname (with locale prefix)
  // useRouter from next-intl handles locale switching correctly
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [isLight, setIsLight] = useState(false)

  // Track light mode for logo switching
  useEffect(() => {
    const update = () => setIsLight(document.documentElement.classList.contains('light'))
    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-lang-switch]')) setLangOpen(false)
      if (!target.closest('[data-theme-switch]')) setThemeOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // next-intl's useRouter handles locale prefix correctly
  function switchLocale(locale: SupportedLocale) {
    router.replace(pathname, { locale })
    setLangOpen(false)
    closeDrawer()
  }

  const themeIcon = theme === 'light' ? <Sun size={15} /> : theme === 'dark' ? <Moon size={15} /> : <MonitorCog size={15} />

  return (
    <>
      {/* ── Overlay ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[300] bg-black/45 backdrop-blur-sm"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile Drawer ────────────────────────────────────────── */}
      <div
        className={[
          'fixed top-0 right-0 z-[350] flex h-dvh w-[min(320px,85vw)] flex-col',
          'border-l shadow-2xl backdrop-blur-[24px] saturate-150',
          'transition-transform duration-350 ease-[cubic-bezier(0.4,0,0.2,1)]',
          drawerOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        style={{
          backgroundColor: 'color-mix(in oklch, var(--color-background) 90%, transparent)',
          borderColor: 'var(--color-border)',
        }}
        aria-hidden={!drawerOpen}
      >
        <div className="flex flex-col gap-1 px-6 pt-[88px]">
          {variant === 'full' && navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              onClick={closeDrawer}
              className="rounded-xl px-4 py-3 text-base font-medium transition-colors"
              style={{ color: 'var(--color-text-primary)', opacity: 0.8 }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="mx-6 my-4 h-px" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* Language in drawer */}
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

        <div className="mx-6 my-4 h-px" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* Theme in drawer */}
        <div className="px-6">
          <p
            className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-text-primary)', opacity: 0.3 }}
          >
            Appearance
          </p>
          <div className="flex flex-col gap-1">
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className="flex w-full items-center gap-3 rounded-[9px] border px-4 py-2.5 text-sm font-medium capitalize transition-all"
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
                {t === 'light' ? <Sun size={15} /> : t === 'dark' ? <Moon size={15} /> : <MonitorCog size={15} />}
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-auto px-6 pb-10">
          <Link
            href={ctaHref}
            onClick={closeDrawer}
            className="block rounded-xl px-6 py-3.5 text-center text-[15px] font-semibold transition-colors"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
            }}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>

      {/* ── Nav inner content ────────────────────────────────────── */}
      <div className="flex w-full max-w-[1200px] items-center mx-auto gap-4">

        {/* Logo */}
        <Link href={`/${currentLocale}`} className="flex shrink-0 items-center">
          {logoSrc ? (
            <>
              {!isLight && (
                <img src={logoSrc} alt={logoAlt} height={36} className="h-9 w-auto" />
              )}
              {isLight && logoLightSrc && (
                <img src={logoLightSrc} alt={logoAlt} height={36} className="h-9 w-auto" />
              )}
              {isLight && !logoLightSrc && (
                <img src={logoSrc} alt={logoAlt} height={36} className="h-9 w-auto" />
              )}
            </>
          ) : (
            <span
              className="text-2xl font-bold tracking-wide"
              style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)' }}
            >
              {logoAlt}
            </span>
          )}
        </Link>

        {/* Desktop right group */}
        <div className="ml-auto hidden items-center gap-1.5 md:flex">

          {variant === 'full' && (
            <>
              <ul className="mr-2 flex items-center gap-0.5 list-none">
                {navLinks.map((link) => {
                  const isActive = pathname.includes(link.href)
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        target={link.external ? '_blank' : undefined}
                        rel={link.external ? 'noopener noreferrer' : undefined}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
                        style={{
                          backgroundColor: isActive
                            ? 'color-mix(in oklch, var(--color-text-primary) 10%, transparent)'
                            : 'transparent',
                          color: 'var(--color-text-primary)',
                          opacity: isActive ? 1 : 0.72,
                        }}
                      >
                        {link.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <div className="h-5 w-px mx-1.5" style={{ backgroundColor: 'var(--color-border)' }} />
            </>
          )}

          {/* Language switcher */}
          {(showLangSwitcherInNav || variant === 'landing') && supportedLocales.length > 1 && (
            <>
              <div className="relative" data-lang-switch>
                <button
                  onClick={() => { setLangOpen(!langOpen); setThemeOpen(false) }}
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
                          color: locale === currentLocale
                            ? 'var(--color-primary)'
                            : 'var(--color-text-primary)',
                          fontWeight: locale === currentLocale ? 700 : 500,
                          opacity: locale === currentLocale ? 1 : 0.75,
                        }}
                      >
                        {LOCALE_NAMES[locale]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="h-5 w-px mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            </>
          )}

          {/* Theme switcher */}
          <div className="relative" data-theme-switch>
            <button
              onClick={() => { setThemeOpen(!themeOpen); setLangOpen(false) }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all"
              style={{ color: 'var(--color-text-primary)', opacity: 0.72 }}
              aria-label="Colour scheme"
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
                {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTheme(t); setThemeOpen(false) }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors"
                    style={{
                      color: theme === t ? 'var(--color-primary)' : 'var(--color-text-primary)',
                      fontWeight: theme === t ? 600 : 500,
                      opacity: theme === t ? 1 : 0.75,
                    }}
                  >
                    {t === 'light' ? <Sun size={13} /> : t === 'dark' ? <Moon size={13} /> : <MonitorCog size={13} />}
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CTA */}
          <Link
            href={ctaHref}
            className="ml-2 rounded-xl border-2 px-5 py-2 text-sm font-semibold transition-all"
            style={{
              borderColor: 'var(--color-primary)',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
            }}
          >
            {ctaLabel}
          </Link>
        </div>

        {/* Hamburger — mobile only */}
        <button
          className="ml-auto flex flex-col items-center justify-center rounded-lg p-2 transition-colors md:hidden"
          onClick={() => setDrawerOpen(!drawerOpen)}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
        >
          <span
            className="block h-0.5 w-[22px] rounded-full transition-all duration-300"
            style={{ backgroundColor: 'var(--color-text-primary)', transform: drawerOpen ? 'translateY(7px) rotate(45deg)' : '' }}
          />
          <span
            className="my-[5px] block h-0.5 rounded-full transition-all duration-300"
            style={{
              backgroundColor: 'var(--color-text-primary)',
              width: drawerOpen ? 0 : '22px',
              opacity: drawerOpen ? 0 : 1,
            }}
          />
          <span
            className="block h-0.5 w-[22px] rounded-full transition-all duration-300"
            style={{ backgroundColor: 'var(--color-text-primary)', transform: drawerOpen ? 'translateY(-7px) rotate(-45deg)' : '' }}
          />
        </button>
      </div>
    </>
  )
}
