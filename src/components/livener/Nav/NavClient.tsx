'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, X, ChevronDown, Sun, Moon, MonitorCog } from 'lucide-react'
import type { NavLink, ResolvedImage, SupportedLocale } from '@/lib/sanity/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavClientProps {
  // Content from Sanity (already locale-resolved)
  logoSrc: string | undefined
  logoLightSrc: string | undefined
  logoAlt: string
  navLinks: NavLink[]
  ctaLabel: string
  ctaHref: string
  // Locale
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
  showLangSwitcherInNav: boolean
  // Layout variant
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

function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system')

  useEffect(() => {
    const stored = (localStorage.getItem('livener-theme') as Theme) ?? 'system'
    setThemeState(stored)
    applyTheme(stored)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if ((localStorage.getItem('livener-theme') as Theme) === 'system') applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function applyTheme(t: Theme) {
    const resolved =
      t === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : t
    document.documentElement.setAttribute('data-theme', resolved)
  }

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
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark')

  // Compute resolved theme whenever theme changes or system preference changes
  useEffect(() => {
    const updateResolvedTheme = () => {
      const resolved =
        theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : theme
      setResolvedTheme(resolved)
    }

    updateResolvedTheme()

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', updateResolvedTheme)
    return () => mq.removeEventListener('change', updateResolvedTheme)
  }, [theme])

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

  function switchLocale(locale: SupportedLocale) {
    // Replace the current locale segment in the URL
    const segments = pathname.split('/')
    segments[1] = locale
    router.push(segments.join('/'))
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
          'border-l shadow-2xl',
          // Glass effect with resolvedTheme-driven styling
          'backdrop-blur-[24px] saturate-150',
          'transition-transform duration-350 ease-[cubic-bezier(0.4,0,0.2,1)]',
          drawerOpen ? 'translate-x-0' : 'translate-x-full',
          // Theme-driven classes
          resolvedTheme === 'light'
            ? 'border-black/15 bg-[rgba(255,255,255,0.88)]'
            : 'border-white/15 bg-[rgba(22,29,43,0.88)]',
        ].join(' ')}
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
              className="rounded-xl px-4 py-3 text-base font-medium text-white/80 transition-colors hover:bg-white/8 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="mx-6 my-4 h-px bg-white/10" />

        {/* Language in drawer */}
        <div className="px-6">
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Language
          </p>
          <div className="flex gap-2">
            {supportedLocales.map((locale) => (
              <button
                key={locale}
                onClick={() => switchLocale(locale)}
                className={[
                  'flex-1 rounded-[9px] border py-2.5 text-sm font-semibold tracking-wide transition-all',
                  locale === currentLocale
                    ? 'border-[#ffa22b] bg-[#ffa22b]/10 text-[#ffa22b]'
                    : 'border-white/15 bg-transparent text-white/65 hover:bg-white/8 hover:text-white/90',
                ].join(' ')}
              >
                {LOCALE_LABELS[locale]}
              </button>
            ))}
          </div>
        </div>

        <div className="mx-6 my-4 h-px bg-white/10" />

        {/* Theme in drawer */}
        <div className="px-6">
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
            Appearance
          </p>
          <div className="flex flex-col gap-1">
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={[
                  'flex w-full items-center gap-3 rounded-[9px] border px-4 py-2.5 text-sm font-medium capitalize transition-all',
                  theme === t
                    ? 'border-[#ffa22b] bg-[#ffa22b]/8 text-[#ffa22b]'
                    : 'border-transparent bg-transparent text-white/65 hover:bg-white/8 hover:text-white/90',
                ].join(' ')}
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
            className="block rounded-xl bg-[#ffa22b] px-6 py-3.5 text-center text-[15px] font-semibold text-white transition-colors hover:bg-[#363366]"
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
              {/* Dark logo (shown in dark theme) */}
              {resolvedTheme === 'dark' && (
                <img
                  src={logoSrc}
                  alt={logoAlt}
                  height={36}
                  className="h-9 w-auto"
                />
              )}
              {/* Light logo (shown in light theme) */}
              {resolvedTheme === 'light' && logoLightSrc && (
                <img
                  src={logoLightSrc}
                  alt={logoAlt}
                  height={36}
                  className="h-9 w-auto"
                />
              )}
            </>
          ) : (
            <span className="font-['Barlow_Condensed'] text-2xl font-bold tracking-wide text-white">
              {logoAlt}
            </span>
          )}
        </Link>

        {/* Desktop right group */}
        <div className="ml-auto hidden items-center gap-1.5 md:flex">

          {/* Nav links (full variant only) */}
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
                        className={[
                          'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                          isActive
                            ? 'bg-white/10 text-white'
                            : 'text-white/72 hover:bg-white/8 hover:text-white',
                        ].join(' ')}
                      >
                        {link.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
              <div className="h-5 w-px bg-white/15 mx-1.5" />
            </>
          )}

          {/* Language switcher */}
          {(showLangSwitcherInNav || variant === 'landing') && supportedLocales.length > 1 && (
            <>
              <div className="relative" data-lang-switch>
                <button
                  onClick={() => { setLangOpen(!langOpen); setThemeOpen(false) }}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold tracking-wide text-white/72 transition-all hover:bg-white/8 hover:text-white"
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
                  <div className="absolute right-0 top-[calc(100%+8px)] z-[500] min-w-[120px] rounded-xl border border-white/15 bg-[#1a2035] p-1.5 shadow-2xl">
                    {supportedLocales.map((locale) => (
                      <button
                        key={locale}
                        onClick={() => switchLocale(locale)}
                        className={[
                          'flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          locale === currentLocale
                            ? 'font-bold text-[#ffa22b]'
                            : 'text-white/75 hover:bg-white/8 hover:text-white',
                        ].join(' ')}
                      >
                        {LOCALE_NAMES[locale]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="h-5 w-px bg-white/15 mx-1" />
            </>
          )}

          {/* Theme switcher */}
          <div className="relative" data-theme-switch>
            <button
              onClick={() => { setThemeOpen(!themeOpen); setLangOpen(false) }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/72 transition-all hover:bg-white/8 hover:text-white"
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
              <div className="absolute right-0 top-[calc(100%+8px)] z-[500] min-w-[140px] rounded-xl border border-white/15 bg-[#1a2035] p-1.5 shadow-2xl">
                {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTheme(t); setThemeOpen(false) }}
                    className={[
                      'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors',
                      theme === t
                        ? 'font-semibold text-[#ffa22b]'
                        : 'text-white/75 hover:bg-white/8 hover:text-white',
                    ].join(' ')}
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
            className="ml-2 rounded-xl border-2 border-[#ffa22b] bg-[#ffa22b] px-5 py-2 text-sm font-semibold text-white transition-all hover:border-[#363366] hover:bg-[#363366]"
          >
            {ctaLabel}
          </Link>
        </div>

        {/* Hamburger — mobile only, always above overlay/drawer via nav z-index */}
        <button
          className="ml-auto flex flex-col items-center justify-center rounded-lg p-2 transition-colors hover:bg-white/8 md:hidden"
          onClick={() => setDrawerOpen(!drawerOpen)}
          aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={drawerOpen}
        >
          <span
            className={`block h-0.5 w-[22px] rounded-full bg-white transition-all duration-300 ${drawerOpen ? 'translate-y-[7px] rotate-45' : ''}`}
          />
          <span
            className={`my-[5px] block h-0.5 rounded-full bg-white transition-all duration-300 ${drawerOpen ? 'w-0 opacity-0' : 'w-[22px]'}`}
          />
          <span
            className={`block h-0.5 w-[22px] rounded-full bg-white transition-all duration-300 ${drawerOpen ? '-translate-y-[7px] -rotate-45' : ''}`}
          />
        </button>
      </div>
    </>
  )
}
