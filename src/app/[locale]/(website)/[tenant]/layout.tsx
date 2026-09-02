export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { tenantClient, isKnownProjectSegment, fetchDesignSystemById } from '@/lib/sanity/client'
import { localeConfigQuery, websiteSiteConfigQuery, designSystemQuery, siteConfigFaviconQuery, projectIntegrationsQuery, projectModuleConfigQuery } from '@/lib/sanity/queries'
import { ogImageUrl } from '@/lib/sanity/image'
import type { LocaleConfig, SupportedLocale, DesignSystem, FontDefinition, WebsiteSiteConfig, BackgroundGraphic, ProjectIntegrations } from '@/lib/sanity/types'
import { imageUrl } from '@/lib/sanity/image'
import { resolveNavLinks } from '@/lib/sanity/nav-links'
import { isLocaleEnabledForProject } from '@/lib/i18n/locale-guard'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import { buildGoogleFontsUrl } from '@/lib/google-fonts'
import { headingVars, fluidHeadingSize, isTypographyLegacyTenant } from '@/lib/design-system/typography'
import { footerThemeVars } from '@/lib/design-system/footer-tokens'
import { Footer } from '@/components/livener/Footer'
import { NavClient } from '@/components/livener/Nav/NavClient'
import { HeaderAppearanceWrapper } from '@/components/HeaderAppearanceWrapper'
import { DevBadge } from '@/components/DevBadge'
import { isProduction } from '@/lib/deployment'
import { EarlyAccessWrapper } from '@/components/forms/EarlyAccessWrapper'
import { FormOverlayWrapper } from '@/components/forms/FormOverlayWrapper'
import { WhatsAppWidget } from '@/components/forms/WhatsAppWidget'
import { hasWhatsAppNumber } from '@/lib/forms/whatsapp'
// ADR-020 — WhatsApp and the header CTA are module configuration, not website
// settings. These readers resolve module config first and fall back to the
// deprecated siteConfig fields; see src/lib/modules/config.ts for why the
// fallback exists and when it goes away.
import { resolveWhatsAppConfig, resolveHeaderCtaConfig, isModuleEnabled, type ProjectModuleConfig } from '@/lib/modules/config'
import { SlugMapRoot } from '@/components/SlugMapContext'
import { TrackingScripts } from '@/components/TrackingScripts'
import { asUrlProjectSegment, type UrlProjectSegment } from '@/lib/tenancy/ids'
import { projectScopeSlugFromUrlSegment } from '@/lib/forms/render-mapping'

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


// NOTE — ds.eyebrowAccent ('none' | 'dot' | 'square' | 'brandMark'),
// ds.eyebrowColor ('muted' | 'accent'), ds.heroEyebrowVariant ('plain' | 'pill') and
// ds.navigation?.dropdownStyle ('solid' | 'glass' | 'surface') are both enums
// consumed by component render logic (which marker/panel style to draw), not
// CSS values — following the existing dropdownStyle precedent, they are read
// directly from the resolved `designSystem` prop by the consuming component
// (e.g. `designSystem.eyebrowAccent`) rather than emitted as a CSS var/data
// attribute here. No entry added to buildCssVars() for either field.
// `tenantId` is only used to honour TYPOGRAPHY_LEGACY_TENANTS — see
// src/lib/design-system/typography.ts. Everything else is tenant-agnostic.
function buildCssVars(
  ds: DesignSystem | null,
  logoHeightOverride?: { desktop?: number; mobile?: number },
  tenantId?: string
): string {
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
    if (scale.size !== undefined) parts.push(`font-size: ${fluidHeadingSize(scale.size) || pxToRem(scale.size)}`)
    if (scale.weight !== undefined) parts.push(`font-weight: ${scale.weight}`)
    if (scale.lineHeight !== undefined) parts.push(`line-height: ${scale.lineHeight}`)
    if (scale.letterSpacing !== undefined) parts.push(`letter-spacing: ${pxToRem(scale.letterSpacing)}`)
    return parts.join('; ')
  }

  // Headings are emitted per property (--font-size-h1, --font-weight-h1, …) and
  // the size is a fluid clamp() rather than a fixed rem — see
  // src/lib/design-system/typography.ts for the formula and for why a level the
  // design system leaves empty is deliberately NOT emitted (the component's own
  // legacy Tailwind steps then render, unchanged).
  //
  // A tenant listed in TYPOGRAPHY_LEGACY_TENANTS is pinned to that legacy
  // rendering even when its design system does carry a scale.
  const useDsHeadings = !isTypographyLegacyTenant(tenantId)
  const headingScaleVars = useDsHeadings
    ? [
        ...headingVars('h1', t?.h1),
        ...headingVars('h2', t?.h2),
        ...headingVars('h3', t?.h3),
        ...headingVars('h4', t?.h4),
      ]
    : []

  const typoVars = [
    // Shorthand bundles — kept for backwards compatibility with any consumer
    // that wants the whole scale in one declaration.
    t?.h1 ? `      --typo-h1: ${typoVar(t.h1)};` : '',
    t?.h2 ? `      --typo-h2: ${typoVar(t.h2)};` : '',
    t?.h3 ? `      --typo-h3: ${typoVar(t.h3)};` : '',
    t?.h4 ? `      --typo-h4: ${typoVar(t.h4)};` : '',
    t?.bodyLarge ? `      --typo-body-large: ${typoVar(t.bodyLarge)};` : '',
    t?.body ? `      --typo-body: ${typoVar(t.body)};` : '',
    t?.small ? `      --typo-small: ${typoVar(t.small)};` : '',
    ...headingScaleVars,
    // Body levels stay at a fixed size — fluid body copy hurts readability.
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
      /* --radius-full is a constant, not a design-system token: it exists so
         genuinely-circular/pill geometry can be expressed through the same
         --radius-* vocabulary as everything else. The eyebrow pill already
         referenced it but nothing emitted it, so it silently computed to 0. */
      --radius-full: 9999px;
      --radius-sm: ${D.radiusSm}px;
      --radius-md: ${D.radiusMd}px;
      --radius-lg: ${D.radiusLg}px;
      --radius-btn: ${ds?.buttons?.primary?.darkTheme?.borderRadius ?? ds?.buttons?.primary?.lightTheme?.borderRadius ?? D.radiusMd}px;
      /* ── Button tokens (dark theme) ── */
      --btn-primary-bg: ${ds?.buttons?.primary?.darkTheme?.background ?? D.primary};
      --btn-primary-text: ${ds?.buttons?.primary?.darkTheme?.text ?? D.bg};
      --btn-primary-hover-bg: ${ds?.buttons?.primary?.darkTheme?.hover?.background ?? D.primary};
      --btn-secondary-bg: ${ds?.buttons?.secondary?.darkTheme?.background ?? 'transparent'};
      --btn-secondary-text: ${ds?.buttons?.secondary?.darkTheme?.text ?? D.textPrimary};
      --btn-secondary-hover-bg: ${ds?.buttons?.secondary?.darkTheme?.hover?.background ?? 'transparent'};
      --logo-height-desktop: ${logoHeightOverride?.desktop ?? ds?.branding?.logoHeightDesktop ?? 36}px;
      --logo-height-mobile: ${logoHeightOverride?.mobile ?? ds?.branding?.logoHeightMobile ?? 28}px;
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
      --color-section-surface1: ${sectionSurfaces?.darkTheme?.surface1 ?? 'transparent'};
      --color-section-surface2: ${sectionSurfaces?.darkTheme?.surface2 ?? 'transparent'};
      --color-section-surface3: ${sectionSurfaces?.darkTheme?.surface3 ?? 'transparent'};
      --color-section-brand-surface: ${sectionSurfaces?.darkTheme?.brandSurface ?? 'transparent'};
      --color-section-glass-bg: ${sectionSurfaces?.darkTheme?.glass?.backgroundOklch ?? 'oklch(0.3 0.02 270 / 0.4)'};
      /* ── Footer tokens (dark theme) ── */
${footerThemeVars(ds?.footer?.surface, D, '      ')}
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
      /* ── Button tokens (light theme overrides) ── */
      --btn-primary-bg: ${ds?.buttons?.primary?.lightTheme?.background ?? L.primary};
      --btn-primary-text: ${ds?.buttons?.primary?.lightTheme?.text ?? L.bg};
      --btn-primary-hover-bg: ${ds?.buttons?.primary?.lightTheme?.hover?.background ?? L.primary};
      --btn-secondary-bg: ${ds?.buttons?.secondary?.lightTheme?.background ?? 'transparent'};
      --btn-secondary-text: ${ds?.buttons?.secondary?.lightTheme?.text ?? L.textPrimary};
      --btn-secondary-hover-bg: ${ds?.buttons?.secondary?.lightTheme?.hover?.background ?? 'transparent'};
      /* ── Section surface tokens (light theme) ── */
      --color-section-surface1: ${sectionSurfaces?.lightTheme?.surface1 ?? 'transparent'};
      --color-section-surface2: ${sectionSurfaces?.lightTheme?.surface2 ?? 'transparent'};
      --color-section-surface3: ${sectionSurfaces?.lightTheme?.surface3 ?? 'transparent'};
      --color-section-brand-surface: ${sectionSurfaces?.lightTheme?.brandSurface ?? 'transparent'};
      --color-section-glass-bg: ${sectionSurfaces?.lightTheme?.glass?.backgroundOklch ?? 'oklch(0.97 0 0 / 0.6)'};
      /* ── Footer tokens (light theme) ── */
${footerThemeVars(ds?.footer?.surface, L, '      ')}
    }
  `.trim()
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
//
// Identity assets are owned per-site in Website Settings (siteConfig), never the
// shared Design System. Favicon precedence:
//   1. siteConfig.faviconSvg  — tenant brand favicon (SVG, preferred)
//   2. siteConfig.faviconPng  — tenant brand favicon (PNG fallback)
//   3. /favicon.ico           — Abluo platform default (implicit, no override needed)

export async function generateMetadata({ params }: { params: Promise<{ tenant: string; locale: string }> }): Promise<Metadata> {
  const { tenant: rawTenantId } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  // Fail closed to a clean 404 for an unknown tenant segment (retired flat
  // routes, typos, dead links falling through to this dynamic segment) instead
  // of rendering an empty page with a 200. This used to be the null branch of
  // `tryTenantToProjectSlug()`; `RENAME.md` Step 5 deleted that lookup, so the
  // check is now an explicit allow-list — see `isKnownProjectSegment`.
  if (!isKnownProjectSegment(tenantId)) notFound()
  const { fetchForTenant } = tenantClient(tenantId)

  const siteConfigFavicon = await fetchForTenant<{
    faviconSvg?:      { asset?: { _ref: string } }
    faviconPng?:      { asset?: { _ref: string } }
    openGraphImage?:  { asset?: { _ref: string } }
    appleTouchIcon?:  { asset?: { _ref: string } }
    googleSiteVerification?: string
    bingSiteVerification?:   string
  }>(siteConfigFaviconQuery, {})

  // ── Favicon — first available wins ──────────────────────────────────────────
  // Identity assets are owned per-site (Website Settings), never the design system.
  // Precedence: siteConfig.faviconSvg → siteConfig.faviconPng
  const faviconSrc =
    (siteConfigFavicon?.faviconSvg?.asset ? imageUrl(siteConfigFavicon.faviconSvg as any, 64) : null) ??
    (siteConfigFavicon?.faviconPng?.asset ? imageUrl(siteConfigFavicon.faviconPng as any, 64) : null) ??
    undefined

  // ── Open Graph image ─────────────────────────────────────────────────────────
  // Owned per-site (Website Settings → openGraphImage). Forced to JPG (1200×630) —
  // social crawlers (WhatsApp, LinkedIn, FB, X) may not accept WebP/AVIF returned
  // by auto('format'). This is the default for ALL pages in this tenant; page-level
  // metadata (events, blog posts) overrides it with their own specific image.
  const ogSrc =
    (siteConfigFavicon?.openGraphImage?.asset ? ogImageUrl(siteConfigFavicon.openGraphImage as any) : null) ??
    undefined

  const appleTouchIconSrc = siteConfigFavicon?.appleTouchIcon?.asset
    ? imageUrl(siteConfigFavicon.appleTouchIcon as any, 180)
    : undefined

  return {
    ...(faviconSrc || appleTouchIconSrc ? {
      icons: {
        ...(faviconSrc ? { icon: faviconSrc } : {}),
        ...(appleTouchIconSrc ? { apple: appleTouchIconSrc } : {}),
      },
    } : {}),
    ...(ogSrc ? {
      openGraph: { images: [{ url: ogSrc, width: 1200, height: 630 }] },
      twitter:   { card: 'summary_large_image', images: [ogSrc] },
    } : {}),
    // Suppress indexing on all non-production environments.
    // Vercel already sends x-robots-tag: noindex on preview deployments,
    // but this ensures the meta tag is also present for belt-and-suspenders.
    ...(!isProduction() ? { robots: { index: false, follow: false } } : {}),
    // Site-ownership verification meta tags — render in every environment
    // (unlike TrackingScripts, these are not production-gated: verifying
    // ownership on a preview/dev deployment is harmless and sometimes needed).
    ...(siteConfigFavicon?.googleSiteVerification || siteConfigFavicon?.bingSiteVerification
      ? {
          verification: {
            ...(siteConfigFavicon?.googleSiteVerification ? { google: siteConfigFavicon.googleSiteVerification } : {}),
            ...(siteConfigFavicon?.bingSiteVerification
              ? { other: { 'msvalidate.01': siteConfigFavicon.bingSiteVerification } }
              : {}),
          },
        }
      : {}),
  }
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/**
 * Site-wide floating WhatsApp button.
 *
 * ADR-020 — configuration comes from the WhatsApp module (with the deprecated
 * siteConfig fields as a transitional fallback). All three of number, form, and
 * the floating toggle must resolve: a button with no number cannot dial, and one
 * with no form has nothing to capture the lead with.
 */
function whatsAppFab(
  modules: ProjectModuleConfig,
  cfg: WebsiteSiteConfig | null | undefined,
  tenantSlug: UrlProjectSegment,
  locale: string
) {
  const whatsapp = resolveWhatsAppConfig(modules, cfg)
  if (!whatsapp.floating || !hasWhatsAppNumber(whatsapp.number)) return null
  // Capture mode needs a form to collect the subject and message; direct mode
  // opens WhatsApp straight away and needs none.
  if (whatsapp.mode === 'capture' && !whatsapp.form?.formId) return null
  return (
    <WhatsAppWidget
      definition={whatsapp.form}
      number={whatsapp.number as string}
      tenantSlug={tenantSlug}
      locale={locale}
      variant="fab"
    />
  )
}

export default async function WebsiteLayout({ children, params }: LayoutProps) {
  const { tenant: rawTenantId, locale } = await params
  // Trust boundary: the `[tenant]` segment is a URL project segment —
  // NOT a tenant slug and NOT a Supabase `projects.slug`. See ids.ts.
  const tenantId = asUrlProjectSegment(rawTenantId)
  // Fail closed to a clean 404 for an unknown tenant segment — see the matching
  // guard in generateMetadata() above for the full rationale.
  if (!isKnownProjectSegment(tenantId)) notFound()
  const { fetchForTenant } = tenantClient(tenantId)

  // ── Shared: locale config ────────────────────────────────────────────────────
  const localeConfig = await fetchForTenant<LocaleConfig>(localeConfigQuery, {})
  const defaultLocale: SupportedLocale = localeConfig?.defaultLocale ?? 'en'

  // Bug L-2 — the [locale] segment is validated against the PLATFORM registry in
  // src/app/[locale]/layout.tsx (the outer guard: is this a language Abluo knows
  // at all?). Nothing validated it against the PROJECT's own supportedLocales, so
  // every tenant served all seven platform locales — e.g. /de on a project whose
  // locales are [it, en] rendered German chrome over Italian content, indexable
  // and duplicated. This is the inner guard, and it is free: localeConfig is
  // already fetched above. See isLocaleEnabledForProject() for the deliberately
  // fail-open behaviour when no siteConfig document exists.
  if (!isLocaleEnabledForProject(locale, localeConfig)) notFound()

  // ── Shared: design system — runs for ALL tenants ─────────────────────────────
  // Fetched via project.designSystemRef -> design system document
  const rawDesignSystem = await fetchForTenant<DesignSystem>(designSystemQuery, {})
  const designSystem = await resolveDesignSystemInheritance(rawDesignSystem, fetchDesignSystemById)
  const headingFont = getFontName(designSystem?.typography?.headingFont, 'Geist')
  const bodyFont = getFontName(designSystem?.typography?.bodyFont, 'Geist')
  const fontsUrl = buildGoogleFontsUrl(headingFont, bodyFont)

  // ── Livener — header appearance system + nav client + footer ─────────────────
  if (tenantId === 'livener') {
    const livenerConfig = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale })
    // ADR-014 Phase C — runtime tracking/analytics config (project.integrationConfigs + project.privacy).
    const integrations = await fetchForTenant<ProjectIntegrations>(projectIntegrationsQuery, {})
    // ADR-020 — module-owned per-website configuration (WhatsApp, header CTA).
    const modules = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale })
    const cssVars = buildCssVars(designSystem, { desktop: livenerConfig?.logoHeightDesktop, mobile: livenerConfig?.logoHeightMobile }, tenantId)
    const livenerBgGraphic = livenerConfig?.backgroundGraphic
    const livenerBgImageUrl = livenerBgGraphic?.asset?.asset ? imageUrl(livenerBgGraphic.asset as any, 1920) : undefined
    const livenerBgStyles = buildBackgroundGraphicStyles(livenerBgGraphic, livenerBgImageUrl, false)

    // ADR-018 slice 7c + ADR-020 — when a header CTA form is configured, the CTA
    // opens a module-driven overlay (FormOverlayWrapper) instead of the bespoke
    // Early Access modal. EarlyAccessWrapper remains the fallback while no CTA
    // form is set. The form now comes from Forms module config, falling back to
    // the deprecated siteConfig.ctaForm.
    // Header button. resolveHeaderCtaConfig() owns the precedence between the
    // three configuration surfaces (Website Settings → Navigation, Forms module
    // config, and the original deprecated fields) so this layout does not have
    // to know there is more than one.
    const livenerCta = resolveHeaderCtaConfig(modules, livenerConfig)
    const livenerCtaForm = livenerCta.form
    const hasCtaForm = !!livenerCtaForm?.formId

    const livenerInner = (
      <>
        <DesignSystemHead cssVars={cssVars} fontsUrl={fontsUrl} />
        <TrackingScripts data={integrations} />
        {livenerBgStyles && livenerBgGraphic?.scope === 'entire' && (
          <div style={livenerBgStyles} aria-hidden="true" />
        )}
        <HeaderAppearanceWrapper config={livenerConfig?.headerAppearance}>
          <NavClient
            logoSrc={livenerConfig?.logo ? imageUrl(livenerConfig.logo as any, 480) : undefined}
            logoLightSrc={livenerConfig?.logoLight ? imageUrl(livenerConfig.logoLight as any, 480) : undefined}
            logoAlt={livenerConfig?.siteName ?? 'Livener'}
            navLinks={resolveNavLinks(livenerConfig?.navLinks, locale as SupportedLocale, 'livener')}
            ctaLabel={livenerCta.label ?? ''}
            ctaHref={livenerCta.href ?? '#'}
            ctaMode={hasCtaForm ? 'overlay' : 'modal'}
            ctaFormId={hasCtaForm ? livenerCtaForm!.formId : undefined}
            ctaInternalName={livenerCta.internalName}
            currentLocale={locale as SupportedLocale}
            supportedLocales={livenerConfig?.supportedLocales ?? [locale as SupportedLocale]}
            showLangSwitcherInNav={livenerConfig?.showLangSwitcherInNav ?? false}
            tenantId="livener"
            themeMode={livenerConfig?.themeMode}
            themeSwitcherPlacement={livenerConfig?.themeSwitcherPlacement}
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
        <TrackingScripts data={integrations} placement="bodyEnd" />
        <Footer tenantId={tenantId} locale={locale as SupportedLocale} defaultLocale={defaultLocale} />
        {whatsAppFab(modules, livenerConfig, tenantId, locale)}
        <DevBadge />
      </>
    )

    return (
      <SlugMapRoot>
        {hasCtaForm ? (
          <FormOverlayWrapper
            tenantSlug={tenantId}
            locale={locale}
            forms={[{ formId: livenerCtaForm!.formId, definition: livenerCtaForm! }]}
          >
            {livenerInner}
          </FormOverlayWrapper>
        ) : (
          <EarlyAccessWrapper
            tenantSlug={tenantId}
            /* The one named URL-segment -> project-slug crossing (Step 6 replaces
               it with the generated route table). It used to be
               `tenantToProjectSlug()`, which returned Sanity's separate name. */
            projectSlug={projectScopeSlugFromUrlSegment(tenantId)}
            locale={locale}
          >
            {livenerInner}
          </EarlyAccessWrapper>
        )}
      </SlugMapRoot>
    )
  }

  // ── Generic layout (studiomartegani and future tenants) ──────────────────────
  const config = await fetchForTenant<WebsiteSiteConfig>(websiteSiteConfigQuery, { locale, defaultLocale })
  // ADR-014 Phase C — runtime tracking/analytics config (project.integrationConfigs + project.privacy).
  const integrations = await fetchForTenant<ProjectIntegrations>(projectIntegrationsQuery, {})
  // ADR-020 — module-owned per-website configuration (WhatsApp, header CTA).
  const modules = await fetchForTenant<ProjectModuleConfig>(projectModuleConfigQuery, { locale, defaultLocale })

  // ── Branding assets — owned per-site (Website Settings), not the design system ─
  const logoSrc = config?.logo ? imageUrl(config.logo as any, 320) : undefined
  const logoLightSrc = config?.logoLight ? imageUrl(config.logoLight as any, 320) : logoSrc
  const cssVars = buildCssVars(designSystem, { desktop: config?.logoHeightDesktop, mobile: config?.logoHeightMobile }, tenantId)

  // ── Background graphic rendering ─────────────────────────────────────────────
  const bgGraphic = config?.backgroundGraphic
  const bgImageUrl = bgGraphic?.asset?.asset ? imageUrl(bgGraphic.asset as any, 1920) : undefined
  const bgStyles = buildBackgroundGraphicStyles(bgGraphic, bgImageUrl, false)

  // ── Header CTA + form overlay — platform behaviour, not one tenant's ─────────
  // ADR-018 slice 7c + ADR-020. resolveHeaderCtaConfig() owns the precedence
  // between Website Settings → Navigation and the deprecated ctaLabel/ctaHref
  // fields, so the label/href resolved here is a superset of the previous
  // `config?.ctaLabel` / `config?.ctaHref` reads.
  const cta = resolveHeaderCtaConfig(modules, config)
  const ctaForm = cta.form
  // ADR-020 — moduleInstallations is the only source of installed-module state;
  // isModuleEnabled() reads it via projectModuleConfigQuery. The overlay mounts
  // for ANY tenant with the Forms module installed, not for one named client.
  const formsModuleEnabled = isModuleEnabled(modules, 'forms')
  const hasCtaForm = formsModuleEnabled && !!ctaForm?.formId

  const genericInner = (
    <>
      <DesignSystemHead cssVars={cssVars} fontsUrl={fontsUrl} />
      <TrackingScripts data={integrations} />
      {bgStyles && bgGraphic?.scope === 'entire' && (
        <div style={bgStyles} aria-hidden="true" />
      )}
      <HeaderAppearanceWrapper config={config?.headerAppearance}>
        <NavClient
          logoSrc={logoSrc}
          logoLightSrc={logoLightSrc ?? logoSrc}
          logoAlt={config?.siteName ?? tenantId}
          siteName={logoSrc ? (config?.siteName ?? undefined) : undefined}
          // Text wordmark — only reaches NavClient via Nav.tsx on the landing
          // variant. The generic tenant header renders NavClient directly, so
          // without these two props every tenant without a logo IMAGE silently
          // fell through to the plain `logoAlt` text branch.
          wordmarkText={config?.wordmarkText}
          wordmarkAccent={config?.wordmarkAccent}
          navLinks={resolveNavLinks(config?.navLinks, locale as SupportedLocale, tenantId)}
          ctaLabel={cta.label ?? undefined}
          ctaHref={cta.href ?? undefined}
          ctaMode={hasCtaForm ? 'overlay' : 'link'}
          ctaFormId={hasCtaForm ? ctaForm!.formId : undefined}
          ctaInternalName={cta.internalName}
          currentLocale={locale as SupportedLocale}
          supportedLocales={config?.supportedLocales ?? [locale as SupportedLocale]}
          showLangSwitcherInNav={config?.showLangSwitcherInNav ?? false}
          tenantId={tenantId}
          themeMode={config?.themeMode}
          themeSwitcherPlacement={config?.themeSwitcherPlacement}
          variant="full"
        />
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
      <TrackingScripts data={integrations} placement="bodyEnd" />
      {/* Shared Footer — the same component the Livener branch mounts. It
          fetches websiteSiteConfigQuery itself, so no props beyond identity.
          `showContact` keeps the home link + address + email this branch used
          to render inline; everything else the shared footer adds (copyright,
          footer links, legal lines, language switcher) is additive and only
          appears where the tenant has authored it. */}
      <Footer
        tenantId={tenantId}
        locale={locale as SupportedLocale}
        defaultLocale={defaultLocale}
        variant="full"
        showContact
      />
      {whatsAppFab(modules, config, tenantId, locale)}
      <DevBadge />
    </>
  )

  // Mounting the overlay is additive: with no seeded forms the host is inert,
  // so any tenant with the Forms module installed gets a working form modal and
  // every other tenant renders exactly as before.
  return (
    <SlugMapRoot>
      {formsModuleEnabled ? (
        <FormOverlayWrapper
          tenantSlug={tenantId}
          locale={locale}
          forms={hasCtaForm ? [{ formId: ctaForm!.formId, definition: ctaForm! }] : []}
        >
          {genericInner}
        </FormOverlayWrapper>
      ) : (
        genericInner
      )}
    </SlugMapRoot>
  )
}
