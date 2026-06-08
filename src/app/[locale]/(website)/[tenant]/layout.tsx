export const dynamic = 'force-dynamic'

import { tenantClient } from '@/lib/sanity/client'
import { localeConfigQuery, websiteSiteConfigQuery, designSystemQuery } from '@/lib/sanity/queries'
import type { LocaleConfig, SupportedLocale, DesignSystem, FontDefinition } from '@/lib/sanity/types'
import { Nav } from '@/components/livener/Nav'
import { Footer } from '@/components/livener/Footer'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ tenant: string; locale: string }>
}

// ─── CSS variable generation ───────────────────────────────────────────────────

/** Convert px number to rem string. Line height stays unitless — do not pass it here. */
function pxToRem(px: number | undefined): string | undefined {
  if (px === undefined || px === null) return undefined
  const val = px / 16
  return `${parseFloat(val.toFixed(4))}rem`
}

/** Extract font family name from a FontDefinition object. */
function getFontName(font: FontDefinition | undefined, fallback: string): string {
  if (!font) return fallback
  if (font.source === 'google' && font.googleFont) return font.googleFont.trim()
  if (font.source === 'library' && font.libraryFont) return font.libraryFont.trim()
  return fallback
}

/** Map of fonts that need non-standard weight/style variants on Google Fonts. */
const FONT_WEIGHT_PARAMS: Record<string, string> = {
  'Geist': 'wght@100;200;300;400;500;600;700;800;900',
  'Barlow Condensed': 'ital,wght@0,400;0,500;0,600;0,700;1,400',
  'Poppins': 'wght@300;400;500;600;700',
  'Playfair Display': 'ital,wght@0,400;0,600;0,700;1,400',
  'Lora': 'ital,wght@0,400;0,600;0,700;1,400',
}

function fontToGoogleParam(name: string): string {
  const params = FONT_WEIGHT_PARAMS[name] ?? 'wght@400;500;600;700'
  return `${name.replace(/ /g, '+')}:${params}`
}

function buildCssVars(ds: DesignSystem | null): string {
  const dark = ds?.colors?.darkTheme
  const light = ds?.colors?.lightTheme
  const typo = ds?.typography
  const radius = ds?.radius

  const D = {
    bg: dark?.background ?? 'oklch(0.2309 0.0292 263.75deg)',
    bgAlt: dark?.backgroundAlt ?? 'oklch(0.2626 0.0223 288.58deg)',
    surface: dark?.surface ?? dark?.backgroundAlt ?? 'oklch(0.2626 0.0223 288.58deg)',
    primary: dark?.primary ?? 'oklch(0.7886 0.1630 66.32deg)',
    secondary: dark?.secondary ?? 'oklch(0.3515 0.0866 283.66deg)',
    textPrimary: dark?.textPrimary ?? 'oklch(0.9612 0.0000 89.88deg)',
    textSecondary: dark?.textSecondary ?? 'oklch(0.9612 0.0000 89.88deg / 0.55)',
    textMuted: dark?.textMuted ?? dark?.textSecondary ?? 'oklch(0.9612 0.0000 89.88deg / 0.4)',
    border: dark?.border ?? 'oklch(1 0 0 / 0.1)',
    headingFont: getFontName(typo?.headingFont, 'Barlow Condensed'),
    bodyFont: getFontName(typo?.bodyFont, 'Poppins'),
    radiusSm: radius?.small ?? 4,
    radiusMd: radius?.medium ?? 8,
    radiusLg: radius?.large ?? 16,
  }

  const L = {
    bg: light?.background ?? 'oklch(0.98 0 0)',
    bgAlt: light?.backgroundAlt ?? 'oklch(0.95 0 0)',
    surface: light?.surface ?? light?.backgroundAlt ?? 'oklch(0.95 0 0)',
    primary: light?.primary ?? D.primary,
    secondary: light?.secondary ?? D.secondary,
    textPrimary: light?.textPrimary ?? 'oklch(0.15 0 0)',
    textSecondary: light?.textSecondary ?? 'oklch(0.15 0 0 / 0.55)',
    textMuted: light?.textMuted ?? light?.textSecondary ?? 'oklch(0.15 0 0 / 0.4)',
    border: light?.border ?? 'oklch(0 0 0 / 0.1)',
  }

  // Typography scale — sizes in rem, line height unitless, letter spacing in rem
  const t = typo
  function typoVar(scale: { size?: number; weight?: number; lineHeight?: number; letterSpacing?: number } | undefined): string {
    if (!scale) return ''
    const parts: string[] = []
    if (scale.size !== undefined) parts.push(`font-size: ${pxToRem(scale.size)}`)
    if (scale.weight !== undefined) parts.push(`font-weight: ${scale.weight}`)
    if (scale.lineHeight !== undefined) parts.push(`line-height: ${scale.lineHeight}`)
    if (scale.letterSpacing !== undefined) parts.push(`letter-spacing: ${pxToRem(scale.letterSpacing)}`)
    return parts.join('; ')
  }

  const typoVars = [
    t?.h1 ? `      --typo-h1: ${typoVar(t.h1)};` : '',
    t?.h2 ? `      --typo-h2: ${typoVar(t.h2)};` : '',
    t?.h3 ? `      --typo-h3: ${typoVar(t.h3)};` : '',
    t?.h4 ? `      --typo-h4: ${typoVar(t.h4)};` : '',
    t?.bodyLarge ? `      --typo-body-large: ${typoVar(t.bodyLarge)};` : '',
    t?.body ? `      --typo-body: ${typoVar(t.body)};` : '',
    t?.small ? `      --typo-small: ${typoVar(t.small)};` : '',
    t?.h1?.size ? `      --font-size-h1: ${pxToRem(t.h1.size)};` : '',
    t?.h2?.size ? `      --font-size-h2: ${pxToRem(t.h2.size)};` : '',
    t?.h3?.size ? `      --font-size-h3: ${pxToRem(t.h3.size)};` : '',
    t?.h4?.size ? `      --font-size-h4: ${pxToRem(t.h4.size)};` : '',
    t?.bodyLarge?.size ? `      --font-size-body-large: ${pxToRem(t.bodyLarge.size)};` : '',
    t?.body?.size ? `      --font-size-body: ${pxToRem(t.body.size)};` : '',
    t?.small?.size ? `      --font-size-small: ${pxToRem(t.small.size)};` : '',
  ].filter(Boolean).join('\n')

  return `
    :root {
      --font-heading: '${D.headingFont}', sans-serif;
      --font-body: '${D.bodyFont}', sans-serif;
      --color-background: ${D.bg};
      --color-background-alt: ${D.bgAlt};
      --color-surface: ${D.surface};
      --color-primary: ${D.primary};
      --color-secondary: ${D.secondary};
      --color-text-primary: ${D.textPrimary};
      --color-text-secondary: ${D.textSecondary};
      --color-text-muted: ${D.textMuted};
      --color-border: ${D.border};
      --radius-sm: ${D.radiusSm}px;
      --radius-md: ${D.radiusMd}px;
      --radius-lg: ${D.radiusLg}px;
      --radius-btn: 12px;
${typoVars}
    }
    html.light {
      --color-background: ${L.bg};
      --color-background-alt: ${L.bgAlt};
      --color-surface: ${L.surface};
      --color-primary: ${L.primary};
      --color-secondary: ${L.secondary};
      --color-text-primary: ${L.textPrimary};
      --color-text-secondary: ${L.textSecondary};
      --color-text-muted: ${L.textMuted};
      --color-border: ${L.border};
    }
  `.trim()
}

function buildGoogleFontsUrl(headingFont: string, bodyFont: string): string {
  const families: string[] = []
  families.push(fontToGoogleParam(headingFont))
  if (bodyFont !== headingFont) families.push(fontToGoogleParam(bodyFont))
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
    const headingFont = getFontName(designSystem?.typography?.headingFont, 'Barlow Condensed')
    const bodyFont = getFontName(designSystem?.typography?.bodyFont, 'Poppins')
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
