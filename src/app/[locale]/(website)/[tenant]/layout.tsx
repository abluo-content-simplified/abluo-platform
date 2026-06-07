export const dynamic = 'force-dynamic'

import { tenantClient } from '@/lib/sanity/client'
import { localeConfigQuery, websiteSiteConfigQuery, designSystemQuery } from '@/lib/sanity/queries'
import type { LocaleConfig, SupportedLocale, DesignSystem } from '@/lib/sanity/types'
import { Nav } from '@/components/livener/Nav'
import { Footer } from '@/components/livener/Footer'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ tenant: string; locale: string }>
}

// ─── CSS variable generation ───────────────────────────────────────────────────

/**
 * Extract the primary font family name from a CSS font stack.
 * Handles both plain names ("Barlow Condensed") and full stacks
 * ("'Barlow Condensed', sans-serif") that Sanity might return.
 */
function parseFontName(value: string): string {
  return value.trim().replace(/'/g, '').split(',')[0].trim()
}

function buildCssVars(ds: DesignSystem | null): string {
  const dark = ds?.colors?.darkTheme
  const light = ds?.colors?.lightTheme
  const typo = ds?.typography
  const radius = ds?.radius

  // Livener brand defaults — used when Sanity values are absent
  const D = {
    bg: dark?.background ?? 'oklch(0.2309 0.0292 263.75deg)',
    bgAlt: dark?.backgroundAlt ?? 'oklch(0.2626 0.0223 288.58deg)',
    primary: dark?.primary ?? 'oklch(0.7886 0.1630 66.32deg)',
    secondary: dark?.secondary ?? 'oklch(0.3515 0.0866 283.66deg)',
    textPrimary: dark?.textPrimary ?? 'oklch(0.9612 0.0000 89.88deg)',
    textSecondary: dark?.textSecondary ?? 'oklch(0.9612 0.0000 89.88deg / 0.55)',
    border: dark?.border ?? 'oklch(1 0 0 / 0.1)',
    headingFont: parseFontName(typo?.headingFont ?? 'Barlow Condensed'),
    bodyFont: parseFontName(typo?.bodyFont ?? 'Poppins'),
    radiusSm: radius?.small ?? 4,
    radiusMd: radius?.medium ?? 8,
    radiusLg: radius?.large ?? 16,
  }

  const L = {
    bg: light?.background ?? 'oklch(0.98 0 0)',
    bgAlt: light?.backgroundAlt ?? 'oklch(0.95 0 0)',
    primary: light?.primary ?? D.primary,
    secondary: light?.secondary ?? D.secondary,
    textPrimary: light?.textPrimary ?? 'oklch(0.15 0 0)',
    textSecondary: light?.textSecondary ?? 'oklch(0.15 0 0 / 0.55)',
    border: light?.border ?? 'oklch(0 0 0 / 0.1)',
  }

  return `
    :root {
      --font-heading: '${D.headingFont}', sans-serif;
      --font-body: '${D.bodyFont}', sans-serif;
      --color-background: ${D.bg};
      --color-background-alt: ${D.bgAlt};
      --color-primary: ${D.primary};
      --color-secondary: ${D.secondary};
      --color-text-primary: ${D.textPrimary};
      --color-text-muted: ${D.textSecondary};
      --color-border: ${D.border};
      --radius-sm: ${D.radiusSm}px;
      --radius-md: ${D.radiusMd}px;
      --radius-lg: ${D.radiusLg}px;
      --radius-btn: 12px;
    }
    html.light {
      --color-background: ${L.bg};
      --color-background-alt: ${L.bgAlt};
      --color-primary: ${L.primary};
      --color-secondary: ${L.secondary};
      --color-text-primary: ${L.textPrimary};
      --color-text-muted: ${L.textSecondary};
      --color-border: ${L.border};
    }
  `.trim()
}

function buildGoogleFontsUrl(headingFont: string, bodyFont: string): string {
  const families: string[] = []

  const heading = parseFontName(headingFont)
  const body = parseFontName(bodyFont)

  if (heading === 'Barlow Condensed') {
    families.push('Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,400')
  } else if (heading) {
    families.push(`${heading.replace(/ /g, '+')}:wght@400;500;600;700`)
  }

  if (body === 'Poppins') {
    families.push('Poppins:wght@300;400;500;600;700')
  } else if (body && body !== heading) {
    families.push(`${body.replace(/ /g, '+')}:wght@400;500;600;700`)
  }

  if (!families.length) return ''
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default async function WebsiteLayout({ children, params }: LayoutProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  // Fetch locale config first — needed as $defaultLocale in all subsequent queries
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ── Livener ──────────────────────────────────────────────────────────────────
  if (tenantId === 'livener') {
    // Fetch design system for CSS variable injection
    const designSystem = await fetchForTenant<DesignSystem>(designSystemQuery, {})
    const cssVars = buildCssVars(designSystem)
    const headingFont = designSystem?.typography?.headingFont ?? 'Barlow Condensed'
    const bodyFont = designSystem?.typography?.bodyFont ?? 'Poppins'
    const fontsUrl = buildGoogleFontsUrl(headingFont, bodyFont)

    return (
      <>
        {/* Inject design system CSS variables for this tenant */}
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
        {/* Google Fonts — loaded dynamically from design system */}
        {fontsUrl && (
          <link rel="preconnect" href="https://fonts.googleapis.com" />
        )}
        {fontsUrl && (
          <link rel="stylesheet" href={fontsUrl} />
        )}
        <Nav tenantId={tenantId} locale={locale as SupportedLocale} defaultLocale={defaultLocale} />
        <main>{children}</main>
        <Footer tenantId={tenantId} locale={locale as SupportedLocale} defaultLocale={defaultLocale} />
      </>
    )
  }

  // ── Generic fallback (studiomartegani and future tenants) ─────────────────────
  const config = await fetchForTenant<any>(websiteSiteConfigQuery, { locale, defaultLocale })

  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between bg-white/90 px-6 backdrop-blur-sm md:px-16 lg:px-24">
        <span className="text-sm font-medium tracking-wide text-zinc-900">
          {config?.siteName ?? tenantId}
        </span>
        <div className="flex items-center gap-4">
          <LanguageSwitcher currentLocale={locale} tenant={tenantId} />
          {config?.phone && (
            <a
              href={`tel:${config.phone}`}
              className="text-xs font-medium tracking-wide text-zinc-500 transition-colors hover:text-zinc-900"
            >
              {config.phone}
            </a>
          )}
        </div>
      </header>
      <div className="h-16" />
      <main>{children}</main>
      <footer className="border-t border-zinc-100 bg-white px-6 py-10 md:px-16 lg:px-24">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-400">{config?.siteName}</p>
          {config?.address && <p className="text-xs text-zinc-400">{config.address}</p>}
          {config?.email && (
            <a href={`mailto:${config.email}`} className="text-xs text-zinc-400 transition-colors hover:text-zinc-900">
              {config.email}
            </a>
          )}
        </div>
      </footer>
    </>
  )
}
