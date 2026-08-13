'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from '@/i18n/navigation'
import { Menu, X } from 'lucide-react'
import type { ResolvedNavLink, SupportedLocale } from '@/lib/sanity/types'
import { LanguageSwitcher } from '@/components/SiteControls/LanguageSwitcher'
import { ThemeSwitcher } from '@/components/SiteControls/ThemeSwitcher'
import { getThemeSwitcherMessages } from '@/lib/i18n/theme-switcher-messages'
import { useEarlyAccess } from '@/components/forms/EarlyAccessContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavClientProps {
  logoSrc: string | undefined
  logoLightSrc: string | undefined
  logoAlt: string
  /** When provided, renders the practice/site name next to the logo as part of the same clickable link. */
  siteName?: string
  navLinks: ResolvedNavLink[]
  /** When omitted the CTA button is hidden entirely. */
  ctaLabel?: string
  ctaHref?: string
  /**
   * 'link' (default) renders <Link href={ctaHref}>.
   * 'modal' renders a <button> that opens the EarlyAccessModal via context.
   * Requires EarlyAccessProvider to be present in the tree.
   */
  ctaMode?: 'link' | 'modal'
  currentLocale: SupportedLocale
  supportedLocales: SupportedLocale[]
  showLangSwitcherInNav: boolean
  tenantId: string
  themeMode?: 'lightOnly' | 'darkOnly' | 'toggle' | 'system'
  variant?: 'full' | 'landing'
}


// ─── Component ────────────────────────────────────────────────────────────────

export function NavClient({
  logoSrc,
  logoLightSrc,
  logoAlt,
  siteName,
  navLinks,
  ctaLabel,
  ctaHref,
  ctaMode = 'link',
  currentLocale,
  supportedLocales,
  showLangSwitcherInNav,
  tenantId,
  themeMode = 'toggle',
  variant = 'full',
}: NavClientProps) {
  // When ctaMode='modal', we use EarlyAccessContext to open the modal.
  // useEarlyAccess() throws if the provider isn't present, so we only call
  // it when ctaMode='modal' — but hooks can't be conditional. Instead we
  // call it and handle the error gracefully below.
  let earlyAccessCtx: ReturnType<typeof useEarlyAccess> | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    earlyAccessCtx = useEarlyAccess()
  } catch {
    // Provider not in tree — ctaMode='modal' won't work but won't crash
  }

  const handleCtaClick = () => {
    if (ctaMode === 'modal' && earlyAccessCtx) {
      earlyAccessCtx.open({ source: 'header_cta' })
    }
  }
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isLight, setIsLight] = useState(false)
  const pathname = usePathname()

  // Track light mode for logo switching
  useEffect(() => {
    const update = () => setIsLight(document.documentElement.classList.contains('light'))
    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])


  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

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
              key={`${link.label}-${link.href}`}
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

        {/* Shared Language Switcher */}
        <LanguageSwitcher currentLocale={currentLocale} supportedLocales={supportedLocales} tenantId={tenantId} appearance="drawer" />

        <div className="mx-6 my-4 h-px" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* Shared Theme Switcher */}
        <ThemeSwitcher themeMode={themeMode} appearance="drawer" messages={getThemeSwitcherMessages(currentLocale)} />

        {/* CTA — hidden when ctaLabel is not set */}
        {ctaLabel && (
          <div className="mt-auto px-6 pb-10">
            {ctaMode === 'modal' ? (
              <button
                onClick={() => { handleCtaClick(); closeDrawer() }}
                className="block w-full rounded-xl px-6 py-3.5 text-center text-[15px] font-semibold transition-colors"
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {ctaLabel}
              </button>
            ) : (
              <Link
                href={ctaHref ?? '#'}
                onClick={closeDrawer}
                className="block rounded-xl px-6 py-3.5 text-center text-[15px] font-semibold transition-colors"
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                }}
              >
                {ctaLabel}
              </Link>
            )}
          </div>
        )}
      </div>

      {/* ── Nav inner content ────────────────────────────────────── */}
      <div className="flex w-full max-w-[1200px] items-center mx-auto gap-4">

        {/* Logo (+ optional practice name) */}
        <Link href={`/${currentLocale}/${tenantId}`} className="flex shrink-0 items-center gap-3">
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
              {siteName && (
                <>
                  <span
                    className="hidden h-5 w-px shrink-0 sm:block"
                    style={{ backgroundColor: 'var(--color-border)' }}
                    aria-hidden="true"
                  />
                  <span
                    className="hidden text-[13px] font-medium leading-tight tracking-wide sm:block md:text-[14px]"
                    style={{ fontFamily: 'var(--font-heading)', color: 'var(--color-text-primary)', opacity: 0.85 }}
                  >
                    {siteName}
                  </span>
                </>
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
                    <li key={`${link.label}-${link.href}`}>
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

          {/* Shared Language Switcher — visibility depends only on locale config, not CTA mode */}
          {(showLangSwitcherInNav || variant === 'landing') && (
            <>
              <LanguageSwitcher currentLocale={currentLocale} supportedLocales={supportedLocales} tenantId={tenantId} appearance="header" />
              <div className="h-5 w-px mx-1" style={{ backgroundColor: 'var(--color-border)' }} />
            </>
          )}

          {/* Shared Theme Switcher */}
          <ThemeSwitcher themeMode={themeMode} appearance="header" messages={getThemeSwitcherMessages(currentLocale)} />

          {/* CTA — hidden when ctaLabel is not set */}
          {ctaLabel && (ctaMode === 'modal' ? (
            <button
              onClick={handleCtaClick}
              className="ml-2 rounded-[var(--radius-btn)] px-5 py-2 text-sm font-semibold transition-all"
              style={{
                backgroundColor: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {ctaLabel}
            </button>
          ) : (
            <Link
              href={ctaHref ?? '#'}
              className="ml-2 rounded-[var(--radius-btn)] px-5 py-2 text-sm font-semibold transition-all"
              style={{
                backgroundColor: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
              }}
            >
              {ctaLabel}
            </Link>
          ))}
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
