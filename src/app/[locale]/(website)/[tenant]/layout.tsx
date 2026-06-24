export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { tenantClient, tenantToProjectSlug, fetchDesignSystemById } from '@/lib/sanity/client'
import { localeConfigQuery, websiteSiteConfigQuery, designSystemQuery } from '@/lib/sanity/queries'
import type { LocaleConfig, SupportedLocale, DesignSystem, FontDefinition, WebsiteSiteConfig, BackgroundGraphic } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { resolveNavLinks } from '@/lib/sanity/nav-links'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { Footer } from '@/components/livener/Footer'
import { NavClient } from '@/components/livener/Nav/NavClient'
import { LanguageSwitcher } from '@/components/SiteControls/LanguageSwitcher'
import { ThemeSwitcher } from '@/components/SiteControls/ThemeSwitcher'
import { getThemeSwitcherMessages } from '@/lib/i18n/theme-switcher-messages'
import { HeaderAppearanceWrapper } from '@/components/HeaderAppearanceWrapper'
import { DevBadge } from '@/components/DevBadge'
import { isProduction } from '@/lib/deployment'
import { EarlyAccessWrapper } from '@/components/forms/EarlyAccessWrapper'
import { SlugMapRoot } from '@/components/SlugMapContext'

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
  const sectionSurfaces = ds?.sectionSurfaces
  const motion = ds?.motion
  const formTypo = ds?.forms?.typography
  const formGeo = ds?.forms?.geometry
  const fDark = ds?.forms   // form input dark theme (used via .input?.darkTheme etc.)
  const fLight = ds?.forms  // form input light theme

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

  // ─── Form input helpers ────────────────────────────────────────────────────
  // Emit per-element-type CSS vars for a given theme (dark = :root, light = html.light)
  function formInputVars(
    prefix: string,
    theme: import('@/lib/sanity/types').FormInputTheme | undefined,
    defaults: {
      bg: string; border: string; text: string; placeholder: string
      focusBorder: string; errorBorder: string; successBorder: string
    }
  ): string {
    return [
      `      --form-${prefix}-bg: ${theme?.background ?? defaults.bg};`,
      `      --form-${prefix}-border: ${theme?.border ?? defaults.border};`,
      `      --form-${prefix}-text: ${theme?.text ?? defaults.text};`,
      `      --form-${prefix}-placeholder: ${theme?.placeholder ?? defaults.placeholder};`,
      `      --form-${prefix}-focus-border: ${theme?.focusBorder ?? defaults.focusBorder};`,
      `      --form-${prefix}-error-border: ${theme?.errorBorder ?? defaults.errorBorder};`,
      `      --form-${prefix}-success-border: ${theme?.successBorder ?? defaults.successBorder};`,
      `      --form-${prefix}-disabled-opacity: ${theme?.disabledOpacity ?? 0.4};`,
    ].join('\n')
  }

  const darkFormDefaults = {
    bg:            D.surface,
    border:        D.border,
    text:          D.textPrimary,
    placeholder:   D.textMuted,
    focusBorder:   D.primary,
    errorBorder:   'oklch(0.6 0.22 25)',
    successBorder: 'oklch(0.62 0.18 145)',
  }

  const lightFormDefaults = {
    bg:            L.surface,
    border:        L.border,
    text:          L.textPrimary,
    placeholder:   L.textMuted,
    focusBorder:   L.primary,
    errorBorder:   'oklch(0.55 0.22 25)',
    successBorder: 'oklch(0.55 0.18 145)',
  }

  const darkFormVars = [
    formInputVars('input',    fDark?.input?.darkTheme,    darkFormDefaults),
    formInputVars('textarea', fDark?.textarea?.darkTheme, darkFormDefaults),
    formInputVars('select',   fDark?.select?.darkTheme,   darkFormDefaults),
    formInputVars('check',    fDark?.checkbox?.darkTheme, darkFormDefaults),
    formInputVars('radio',    fDark?.radio?.darkTheme,    darkFormDefaults),
  ].join('\n')

  const lightFormVars = [
    formInputVars('input',    fLight?.input?.lightTheme,    lightFormDefaults),
    formInputVars('textarea', fLight?.textarea?.lightTheme, lightFormDefaults),
    formInputVars('select',   fLight?.select?.lightTheme,   lightFormDefaults),
    formInputVars('check',    fLight?.checkbox?.lightTheme, lightFormDefaults),
    formInputVars('radio',    fLight?.radio?.lightTheme,    lightFormDefaults),
  ].join('\n')

  // ─── Form typography + geometry — theme-independent ────────────────────────
  const formMetaVars = [
    // Typography (colors are CSS strings — no unit conversion)
    `      --form-label-color: ${formTypo?.labelColor ?? D.textSecondary};`,
    `      --form-label-size: ${pxToRem(formTypo?.labelSize ?? 12)};`,
    `      --form-label-weight: ${formTypo?.labelWeight ?? 500};`,
    `      --form-help-color: ${formTypo?.helpTextColor ?? D.textMuted};`,
    `      --form-help-size: ${pxToRem(formTypo?.helpTextSize ?? 12)};`,
    `      --form-error-color: ${formTypo?.errorTextColor ?? 'oklch(0.6 0.22 25)'};`,
    `      --form-error-size: ${pxToRem(formTypo?.errorTextSize ?? 12)};`,
    `      --form-required-color: ${formTypo?.requiredColor ?? 'oklch(0.6 0.22 25)'};`,
    // Geometry
    `      --form-input-height: ${formGeo?.inputHeight ?? 44}px;`,
    `      --form-padding-x: ${pxToRem(formGeo?.paddingX ?? 14)};`,
    `      --form-padding-y: ${pxToRem(formGeo?.paddingY ?? 10)};`,
    `      --form-label-gap: ${formGeo?.labelGap ?? 6}px;`,
    `      --form-field-gap: ${formGeo?.fieldGap ?? 20}px;`,
    `      --form-border-radius: ${formGeo?.borderRadius ?? D.radiusMd}px;`,
  ].join('\n')

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
      --color-success: ${dark?.success ?? 'oklch(0.62 0.18 145)'};
      --color-warning: ${dark?.warning ?? 'oklch(0.75 0.15 80)'};
      --color-danger: ${dark?.danger ?? 'oklch(0.6 0.22 25)'};
      --radius-sm: ${D.radiusSm}px;
      --radius-md: ${D.radiusMd}px;
      --radius-lg: ${D.radiusLg}px;
      --radius-btn: 12px;
      --motion-duration-fast: ${motion?.durationFast ?? 120}ms;
      --motion-duration-base: ${motion?.durationBase ?? 200}ms;
      --motion-duration-slow: ${motion?.durationSlow ?? 350}ms;
      --motion-duration-slower: ${motion?.durationSlower ?? 600}ms;
      --motion-easing-standard: ${motion?.easingStandard ?? 'cubic-bezier(0.4, 0, 0.2, 1)'};
      --motion-easing-decelerate: ${motion?.easingDecelerate ?? 'cubic-bezier(0, 0, 0.2, 1)'};
      --motion-easing-accelerate: ${motion?.easingAccelerate ?? 'cubic-bezier(0.4, 0, 1, 1)'};
      --motion-easing-emphasized: ${motion?.easingEmphasized ?? 'cubic-bezier(0.2, 0, 0, 1)'};
      /* Bridge: wire Tailwind/shadcn tokens to our design system so bg-background etc. work */
      --background: ${D.bg};
      --foreground: ${D.textPrimary};
${typoVars}
      /* ── Form tokens (dark theme / :root) ── */
${darkFormVars}
${formMetaVars}
      /* ── Section surface tokens (dark theme) ── */
      --color-section-surface1: ${sectionSurfaces?.darkTheme?.surface1 ?? D.bg};
      --color-section-surface2: ${sectionSurfaces?.darkTheme?.surface2 ?? D.bgAlt};
      --color-section-surface3: ${sectionSurfaces?.darkTheme?.surface3 ?? D.surface};
      --color-section-brand-surface: ${sectionSurfaces?.darkTheme?.brandSurface ?? D.primary};
      --color-section-glass-bg: ${sectionSurfaces?.darkTheme?.glass?.backgroundOklch ?? 'oklch(0.3 0.02 270 / 0.4)'};
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
      --color-success: ${light?.success ?? 'oklch(0.55 0.18 145)'};
      --color-warning: ${light?.warning ?? 'oklch(0.65 0.15 80)'};
      --color-danger: ${light?.danger ?? 'oklch(0.55 0.22 25)'};
      --background: ${L.bg};
      --foreground: ${L.textPrimary};
      /* ── Form tokens (light theme) ── */
${lightFormVars}
      --form-label-color: ${formTypo?.labelColor ?? L.textSecondary};
      --form-help-color: ${formTypo?.helpTextColor ?? L.textMuted};
      /* ── Section surface tokens (light theme) ── */
      --color-section-surface1: ${sectionSurfaces?.lightTheme?.surface1 ?? L.bg};
      --color-section-surface2: ${sectionSurfaces?.lightTheme?.surface2 ?? L.bgAlt};
      --color-section-surface3: ${sectionSurfaces?.lightTheme?.surface3 ?? L.surface};
      --color-section-brand-surface: ${sectionSurfaces?.lightTheme?.brandSurface ?? L.primary};
      --color-section-glass-bg: ${sectionSurfaces?.lightTheme?.glass?.backgroundOklch ?? 'oklch(0.97 0 0 / 0.6)'};
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

// ─── Background Graphic Utilities ─────────────────────────────────────────────

/** Map position presets to CSS background-position values. */
function getBackgroundPosition(preset?: string): string {
  switch (preset) {
    case 'topLeft':
      return '0% 0%'
    case 'topRight':
      return '100% 0%'
    case 'bottomLeft':
      return '0% 100%'
    case 'bottomRight':
      return '100% 100%'
    case 'center':
    default:
      return '50% 50%'
  }
}

/** Build CSS transform string from scale, rotation, and offsets. */
function buildBackgroundTransform(
  scale?: number,
  rotation?: number,
  offsetX?: number,
  offsetY?: number
): string {
  const transforms: string[] = []
  if (scale && scale !== 100) transforms.push(`scale(${scale / 100})`)
  if (rotation && rotation !== 0) transforms.push(`rotate(${rotation}deg)`)
  if (offsetX && offsetX !== 0) transforms.push(`translateX(${offsetX}%)`)
  if (offsetY && offsetY !== 0) transforms.push(`translateY(${offsetY}%)`)
  return transforms.length > 0 ? transforms.join(' ') : 'none'
}

/** Build inline styles for the background graphic wrapper. */
function buildBackgroundGraphicStyles(
  bg: BackgroundGraphic | undefined,
  imageUrl: string | undefined,
  isMobile: boolean
): React.CSSProperties | undefined {
  if (!bg?.enabled || !imageUrl) return undefined

  const scale = isMobile && bg.mobileScale ? bg.mobileScale : bg.scale ?? 100
  const offsetX = isMobile && bg.mobileOffsetX !== undefined ? bg.mobileOffsetX : bg.offsetX ?? 0
  const offsetY = isMobile && bg.mobileOffsetY !== undefined ? bg.mobileOffsetY : bg.offsetY ?? 0
  const opacity = (bg.opacity ?? 5) / 100
  const scrollBehavior = bg.scrollBehavior ?? 'scroll'

  // Determine positioning based on scroll behavior
  const isFixed = scrollBehavior === 'fixed' || scrollBehavior === 'parallax'

  return {
    position: (isFixed ? 'fixed' : 'absolute') as 'fixed' | 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none' as const,
    zIndex: 0,
    backgroundImage: `url('${imageUrl}')`,
    backgroundPosition: getBackgroundPosition(bg.positionPreset),
    backgroundSize: 'contain',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: scrollBehavior === 'scroll' ? 'scroll' : 'fixed',
    opacity,
    transform: buildBackgroundTransform(scale, bg.rotation, offsetX, offsetY),
  } as React.CSSProperties
}

// ─── Shared design system tokens ──────────────────────────────────────────────

function DesignSystemHead({ cssVars, fontsUrl }: { cssVars: string; fontsUrl: string }) {
  return (
    <>
      {/* Design system CSS variables — applies to all tenants */}
      <style dangerouslySetInnerHTML={{ __html: cssVars }} />
      {fontsUrl && <link rel="preconnect" href="https://fonts.googleapis.com" />}
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} />}
    </>
  )
}

// ─── Metadata (favicon) ───────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ tenant: string; locale: string }> }): Promise<Metadata> {
  const { tenant: tenantId } = await params
  const { fetchForTenant } = tenantClient(tenantId)
  const rawDesignSystem = await fetchForTenant<DesignSystem>(designSystemQuery, {})
  const designSystem = await resolveDesignSystemInheritance(rawDesignSystem, fetchDesignSystemById)
  const faviconAsset = designSystem?.branding?.favicon
  const faviconSrc = faviconAsset?.asset ? imageUrl(faviconAsset as any, 64) : undefined
  return {
    ...(faviconSrc ? { icons: { icon: faviconSrc } } : {}),
    // Suppress indexing on all non-production environments.
    // Vercel already sends x-robots-tag: noindex on preview deployments,
    // but this ensures the meta tag is also present for belt-and-suspenders.
    ...(!isProduction() ? { robots: { index: false, follow: false } } : {}),
  }
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export default async function WebsiteLayout({ children, params }: LayoutProps) {
  const { tenant: tenantId, locale } = await params
  const { fetchForTenant } = tenantClient(tenantId)

  // ── Shared: locale config ────────────────────────────────────────────────────
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // ── Shared: design system — runs for ALL tenants ─────────────────────────────
  // Fetched via project.designSystemRef -> design system document
  const rawDesignSystem = await fetchForTenant<DesignSystem>(designSystemQuery, {})
  const designSystem = await resolveDesignSystemInheritance(rawDesignSystem, fetchDesignSystemById)
  const cssVars = buildCssVars(designSystem)
  const headingFont = getFontName(designSystem?.typography?.headingFont, 'Geist')
  const bodyFont = getFontName(designSystem?.typography?.bodyFont, 'Geist')
  const fontsUrl = buildGoogleFontsUrl(headingFont, bodyFont)

  // ── Branding assets from design system ───────────────────────────────────────
  const logoAsset = designSystem?.branding?.logo
  const logoLightAsset = designSystem?.branding?.logoLight
  const logoDarkSrc = logoAsset?.asset ? imageUrl(logoAsset as any, 320) : undefined
  const logoLightSrc = logoLightAsset?.asset ? imageUrl(logoLightAsset as any, 320) : logoDarkSrc

  // ── Livener — header appearance system + nav client + footer ─────────────────
  if (tenantId === 'livener') {
    const livenerConfig = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale })
    const livenerBgGraphic = livenerConfig?.backgroundGraphic
    const livenerBgImageUrl = livenerBgGraphic?.asset?.asset ? imageUrl(livenerBgGraphic.asset as any, 1920) : undefined
    const livenerBgStyles = buildBackgroundGraphicStyles(livenerBgGraphic, livenerBgImageUrl, false)

    return (
      <SlugMapRoot>
      <EarlyAccessWrapper tenantSlug={tenantId} projectSlug={tenantToProjectSlug(tenantId)} locale={locale}>
        <DesignSystemHead cssVars={cssVars} fontsUrl={fontsUrl} />
        {livenerBgStyles && livenerBgGraphic?.scope === 'entire' && (
          <div style={livenerBgStyles} aria-hidden="true" />
        )}
        <HeaderAppearanceWrapper config={livenerConfig?.headerAppearance}>
          <NavClient
            logoSrc={livenerConfig?.logo ? imageUrl(livenerConfig.logo as any, 480) : undefined}
            logoLightSrc={livenerConfig?.logoLight ? imageUrl(livenerConfig.logoLight as any, 480) : undefined}
            logoAlt={livenerConfig?.siteName ?? 'Livener'}
            navLinks={resolveNavLinks(livenerConfig?.navLinks, locale as SupportedLocale, 'livener')}
            ctaLabel={livenerConfig?.ctaLabel || (locale === 'it' ? 'Richiedi accesso anticipato' : 'Get Early Access')}
            ctaHref={livenerConfig?.ctaHref ?? '#'}
            ctaMode="modal"
            currentLocale={locale as SupportedLocale}
            supportedLocales={livenerConfig?.supportedLocales ?? [locale as SupportedLocale]}
            showLangSwitcherInNav={livenerConfig?.showLangSwitcherInNav ?? false}
            tenantId="livener"
            themeMode={livenerConfig?.themeMode}
            variant="full"
          />
        </HeaderAppearanceWrapper>
        <div
          style={{
            height: livenerConfig?.headerAppearance?.customHeight
              ? `${livenerConfig.headerAppearance.customHeight}px`
              : undefined,
          }}
          className={
            livenerConfig?.headerAppearance?.customHeight
              ? undefined
              : {
                  compact: 'h-12',
                  normal: 'h-16',
                  large: 'h-20',
                }[livenerConfig?.headerAppearance?.headerHeight ?? 'normal']
          }
        />
        <main>{children}</main>
        <Footer tenantId={tenantId} locale={locale as SupportedLocale} defaultLocale={defaultLocale} />
        <DevBadge />
      </EarlyAccessWrapper>
      </SlugMapRoot>
    )
  }

  // ── Generic layout (studiomartegani and future tenants) ──────────────────────
  const config = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale })

  // ── Background graphic rendering ─────────────────────────────────────────────
  const bgGraphic = config?.backgroundGraphic
  const bgImageUrl = bgGraphic?.asset?.asset ? imageUrl(bgGraphic.asset as any, 1920) : undefined
  const bgStyles = buildBackgroundGraphicStyles(bgGraphic, bgImageUrl, false)

  return (
    <SlugMapRoot>
    <>
      <DesignSystemHead cssVars={cssVars} fontsUrl={fontsUrl} />
      {bgStyles && bgGraphic?.scope === 'entire' && (
        <div style={bgStyles} aria-hidden="true" />
      )}
      <HeaderAppearanceWrapper config={config?.headerAppearance}>
        {/* Logo — dark version by default, light version shown in light theme via CSS */}
        {logoDarkSrc ? (
          <a href={`/${locale}/${tenantId}`} className="flex items-center" style={{ lineHeight: 0 }}>
            {logoLightSrc && logoLightSrc !== logoDarkSrc && (
              <img
                src={logoLightSrc}
                alt={config?.siteName ?? tenantId}
                height={36}
                style={{ height: '36px', width: 'auto', display: 'none' }}
                className="logo-light"
              />
            )}
            <img
              src={logoDarkSrc}
              alt={config?.siteName ?? tenantId}
              height={36}
              style={{ height: '36px', width: 'auto' }}
              className="logo-dark"
            />
          </a>
        ) : (
          <span
            className="text-sm font-medium tracking-wide"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
          >
            {config?.siteName ?? tenantId}
          </span>
        )}
        <div className="flex items-center gap-3">
          {config?.phone && (
            <a
              href={`tel:${config.phone}`}
              className="hidden text-xs font-medium tracking-wide transition-opacity hover:opacity-100 md:block"
              style={{ color: 'var(--color-text-muted)', opacity: 0.75 }}
            >
              {config.phone}
            </a>
          )}
          {(config?.languageSwitcherPlacement === 'header' || config?.languageSwitcherPlacement === 'both') && (
            <LanguageSwitcher
              currentLocale={locale as SupportedLocale}
              supportedLocales={config?.supportedLocales ?? []}
              tenantId={tenantId}
              appearance="header"
            />
          )}
          {(config?.themeSwitcherPlacement === 'header' || config?.themeSwitcherPlacement === 'both') && (
            <ThemeSwitcher themeMode={config?.themeMode} appearance="header" messages={getThemeSwitcherMessages(locale)} />
          )}
        </div>
      </HeaderAppearanceWrapper>
      <div
        style={{
          height: config?.headerAppearance?.customHeight
            ? `${config.headerAppearance.customHeight}px`
            : undefined,
        }}
        className={
          config?.headerAppearance?.customHeight
            ? undefined
            : {
                compact: 'h-12',
                normal: 'h-16',
                large: 'h-20',
              }[config?.headerAppearance?.headerHeight ?? 'normal']
        }
      />
      <main>{children}</main>
      <footer
        className="px-6 py-10 md:px-16 lg:px-24"
        style={{
          backgroundColor: 'var(--color-background-alt)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          {/* Logo in footer */}
          {logoDarkSrc ? (
            <a href={`/${locale}/${tenantId}`} className="transition-opacity hover:opacity-100">
              <img
                src={logoDarkSrc}
                alt={config?.siteName ?? tenantId}
                height={28}
                style={{ height: '28px', width: 'auto', opacity: 0.6 }}
              />
            </a>
          ) : (
            <a href={`/${locale}/${tenantId}`} className="text-xs transition-opacity hover:opacity-100" style={{ color: 'var(--color-text-muted)' }}>
              {config?.siteName}
            </a>
          )}
          <div className="flex flex-col gap-1 sm:items-end">
            {config?.address && (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{config.address}</p>
            )}
            {config?.email && (
              <a
                href={`mailto:${config.email}`}
                className="text-xs transition-opacity hover:opacity-100"
                style={{ color: 'var(--color-text-muted)', opacity: 0.75 }}
              >
                {config.email}
              </a>
            )}
          </div>
        </div>
      </footer>
      <DevBadge />
    </>
    </SlugMapRoot>
  )
}
