// ── Brand Hub — view model contract (ADR-036) ─────────────────────────────────
//
// The hub pages render ONLY from this model. It is built by the pure
// buildBrandHubModel() (model.ts) from the resolved design system, the site's
// branding assets and the project's brandGuide document. Nothing in here is
// stored anywhere: every design value is read live from its owner (ADR-036 D2).
//
// Components never touch Sanity shapes directly — if a page needs something,
// it is added here first.

import type { PortableTextContent } from '@/lib/sanity/types'

/**
 * Where a displayed design value comes from (ADR-036 D3). Written guide
 * content needs no label.
 *  - designSystem    — set in the project's design system (own or inherited parent)
 *  - calculated      — derived from a design-system value (HEX from OKLCH, a ratio)
 *  - platformDefault — not set; the value shown is what the website actually renders
 *  - notSet          — not set and no single platform value exists
 */
export type ValueSource = 'designSystem' | 'calculated' | 'platformDefault' | 'notSet'

export type ThemeKey = 'light' | 'dark'

/** Hub pages, in navigation order. 'overview' is served at /brand itself. */
export const BRAND_HUB_PAGES = ['overview', 'colour', 'typography', 'shape', 'layout', 'logo', 'motion'] as const
export type BrandHubPageId = (typeof BRAND_HUB_PAGES)[number]

/** A plain (non-colour) design value. */
export interface DesignValue<T = number | string> {
  value: T | null
  source: ValueSource
}

/** One colour as the hub shows it. */
export interface ColourValue {
  /** Exactly as stored (or the platform default's literal). Null when notSet. */
  stored: string | null
  source: ValueSource
  /** When the website falls back to ANOTHER role of this design system (e.g. surface → backgroundAlt). */
  sameAs: ColourRoleKey | null
  /** Calculated #RRGGBB of what is actually seen (composited when alpha < 1). Null when unparseable / notSet. */
  hex: string | null
  /** Calculated `rgb(r g b)` of the same colour. */
  rgb: string | null
  /** 0–1. 1 for opaque colours. */
  alpha: number
  /** For alpha < 1: the role it was composited on to produce hex/rgb (the theme's background). */
  compositedOn: ColourRoleKey | null
  /** True when the OKLCH value lies outside sRGB and hex/rgb are the nearest displayable colour. */
  approximate: boolean
  /** CSS colour to paint a swatch with (the stored value when parseable by browsers, else hex). */
  swatch: string | null
}

export const COLOUR_ROLE_KEYS = [
  'background', 'backgroundAlt', 'surface',
  'primary', 'secondary', 'accent',
  'textPrimary', 'textSecondary', 'textMuted',
  'border',
  'success', 'warning', 'danger',
] as const
export type ColourRoleKey = (typeof COLOUR_ROLE_KEYS)[number]

export interface ColourRole {
  key: ColourRoleKey
  light: ColourValue
  dark: ColourValue
}

export interface ButtonThemeSpec {
  background: ColourValue
  text: ColourValue
  hoverBackground: ColourValue
  /** px; 9999-ish values mean "pill". */
  borderRadius: DesignValue<number>
}
export interface ButtonSpec {
  variant: 'primary' | 'secondary'
  light: ButtonThemeSpec
  dark: ButtonThemeSpec
}

/** One measured foreground/background pair (WCAG 2.x relative luminance). */
export interface ContrastCheck {
  theme: ThemeKey
  /** A colour role, or 'buttonPrimary' / 'buttonSecondary' (their text on their background). */
  foreground: ColourRoleKey | 'buttonPrimaryText' | 'buttonSecondaryText'
  background: ColourRoleKey | 'buttonPrimaryBackground' | 'buttonSecondaryBackground'
  foregroundHex: string
  backgroundHex: string
  /** Rounded to 2 decimals. */
  ratio: number
  /** ≥ 4.5 */
  passNormal: boolean
  /** ≥ 3.0 */
  passLarge: boolean
}

export type TypeLevelKey = 'h1' | 'h2' | 'h3' | 'h4' | 'bodyLarge' | 'body' | 'small'
export const TYPE_LEVEL_KEYS: readonly TypeLevelKey[] = ['h1', 'h2', 'h3', 'h4', 'bodyLarge', 'body', 'small']

export interface TypeLevel {
  key: TypeLevelKey
  /** Which family renders this level. */
  family: 'heading' | 'body'
  /** px */
  size: DesignValue<number>
  /** px — smallest fluid size on narrow screens (headings only). */
  minSize: DesignValue<number>
  weight: DesignValue<number>
  /** unitless */
  lineHeight: DesignValue<number>
  /** px */
  letterSpacing: DesignValue<number>
}

export interface FontFamily {
  role: 'heading' | 'body' | 'accent'
  /** Family name as rendered, e.g. "Inter"; the platform default stack name when not set. */
  name: string | null
  /** 'library' | 'google' when set by the design system. */
  provider: 'library' | 'google' | null
  source: ValueSource
}

export interface ScaleStep {
  key: string
  /** px */
  value: DesignValue<number>
}

export interface BrandAsset {
  key: 'logo' | 'logoLight' | 'faviconSvg' | 'faviconPng' | 'openGraphImage' | `background:${string}`
  /** Which background the asset is meant for, when it has one. */
  intendedFor: ThemeKey | null
  /** Human name for background graphics (from the design system); null for the fixed keys. */
  name: string | null
  /** Original file URL (download). */
  url: string
  /** Preview URL (resized for raster images; same as url for SVG). */
  previewUrl: string
  originalFilename: string | null
  extension: string | null
  mimeType: string | null
  /** bytes */
  size: number | null
  width: number | null
  height: number | null
}

/** Do / don't example from the guide. */
export interface DoDontItem {
  key: string
  kind: 'do' | 'dont'
  imageUrl: string | null
  imageAlt: string | null
  caption: string | null
}

/** The written part of one page (from the brandGuide document). */
export interface WrittenContent {
  body: PortableTextContent | null
  doDont: DoDontItem[]
}

export interface BrandHubModel {
  projectName: string | null
  /** The guide's version number (manual, ADR-036 D7). Null when no guide document exists yet. */
  version: number | null
  /** ISO string — latest change across guide, design system (+ parents) and site settings. */
  lastUpdated: string | null
  /** IANA zone for formatting lastUpdated (siteConfig.timeZone), null → UTC. */
  timeZone: string | null

  intro: PortableTextContent | null
  written: Record<Exclude<BrandHubPageId, 'overview'>, WrittenContent>

  colours: ColourRole[]
  buttons: ButtonSpec[]
  contrast: ContrastCheck[]

  fonts: FontFamily[]
  typeLevels: TypeLevel[]

  spacing: ScaleStep[]
  radius: ScaleStep[]
  shadows: { key: 'card' | 'dropdown' | 'modal'; value: DesignValue<string> }[]

  layout: {
    maxContentWidth: DesignValue<number>
    maxTextWidth: DesignValue<number>
    sectionPaddingY: DesignValue<number>
    sectionPaddingYCompact: DesignValue<number>
    sectionPaddingYLarge: DesignValue<number>
  }

  motion: {
    durations: { key: 'durationFast' | 'durationBase' | 'durationSlow' | 'durationSlower'; value: DesignValue<number> }[]
    easings: { key: 'easingStandard' | 'easingDecelerate' | 'easingAccelerate' | 'easingEmphasized'; value: DesignValue<string> }[]
  }

  assets: BrandAsset[]
}
