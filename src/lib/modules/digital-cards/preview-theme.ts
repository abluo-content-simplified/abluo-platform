// ── Digital Cards — the editor's live preview, in the site's design system ────
//
// ADR-049 Amendment A (2026-11-09): the editor shows the card beside the
// fields, rendered by the SAME component as the website (DigitalCardView).
// The website gets its design-system variables from the tenant layout
// (buildCssVars, on :root). In the dashboard they must not leak onto the
// dashboard itself, so this builds the subset a card reads — colours, button
// colours, radii, fonts — as CSS SCOPED to one attribute selector.
//
// The colour chains are resolveColours() (the same source as buildCssVars and
// the Brand Hub), so the preview cannot drift from the site. Theme: like the
// site — dark on the base selector, light under `html.light` (the dashboard's
// own light class), only one of them for a site locked to one theme.
//
// Pure: no React, no Sanity.

import type { DesignSystem } from '@/lib/sanity/types'
import { resolveColours } from '@/lib/design-system/resolved-colours'
import { FALLBACK_FONTS, FALLBACK_RADIUS } from '@/lib/design-system/fallback-tokens'
import { buildGoogleFontsUrl } from '@/lib/google-fonts'

export type CardPreviewThemeMode = 'lightOnly' | 'darkOnly' | 'toggle' | 'system'

export interface CardPreviewTheme {
  /** Scoped CSS: `[data-card-preview="<scope>"] { --color-… }`. */
  css: string
  /** Self-hosted font stylesheet of the design system's faces ('' = none). */
  fontsUrl: string
}

/** The attribute the preview container carries; the CSS is scoped to it. */
export const CARD_PREVIEW_ATTRIBUTE = 'data-card-preview'

type FontDef = { source?: string; googleFont?: string; libraryFont?: string } | undefined

function fontName(font: FontDef, fallback: string): string {
  if (font?.source === 'google' && font.googleFont) return font.googleFont.trim()
  if (font?.source === 'library' && font.libraryFont) return font.libraryFont.trim()
  return fallback
}

/** A design-system value inside a declaration: nothing that could close the rule or the style element. */
export function cssValue(v: unknown): string {
  return String(v ?? '')
    .replace(/[<>{};\\]/g, '')
    .replace(/\/\*|\*\//g, '')
    .trim()
}

/** A font family inside quotes. */
const family = (name: string) => `'${name.replace(/[^A-Za-z0-9 _-]/g, '')}'`

export function cardPreviewTheme(ds: DesignSystem | null | undefined, themeMode: CardPreviewThemeMode | null | undefined, scope: string): CardPreviewTheme {
  const RC = resolveColours(ds)
  const typo = ds?.typography as { headingFont?: FontDef; bodyFont?: FontDef } | undefined
  const heading = fontName(typo?.headingFont, FALLBACK_FONTS.heading)
  const body = fontName(typo?.bodyFont, FALLBACK_FONTS.body)
  const radiusMd = ds?.radius?.medium ?? FALLBACK_RADIUS.medium
  const btn = ds?.buttons?.primary as { darkTheme?: { borderRadius?: number }; lightTheme?: { borderRadius?: number } } | undefined
  const radiusBtn = btn?.darkTheme?.borderRadius ?? btn?.lightTheme?.borderRadius ?? radiusMd

  const palette = (t: 'dark' | 'light') => {
    const th = RC[t]
    const v = (c: { value: string } | null | undefined) => cssValue(c?.value)
    return [
      `--color-background: ${v(th.background)}`,
      `--color-background-alt: ${v(th.backgroundAlt)}`,
      `--color-surface: ${v(th.surface)}`,
      `--color-primary: ${v(th.primary)}`,
      `--color-secondary: ${v(th.secondary)}`,
      `--color-text-primary: ${v(th.textPrimary)}`,
      `--color-text-secondary: ${v(th.textSecondary)}`,
      `--color-text-muted: ${v(th.textMuted)}`,
      `--color-border: ${v(th.border)}`,
      `--btn-primary-bg: ${v(RC.buttons.primary[t].background)}`,
      `--btn-primary-text: ${v(RC.buttons.primary[t].text)}`,
      `--btn-secondary-bg: ${v(RC.buttons.secondary[t].background)}`,
      `--btn-secondary-text: ${v(RC.buttons.secondary[t].text)}`,
      `background-color: var(--color-background)`,
      `color: var(--color-text-primary)`,
    ].join('; ')
  }
  const shared = [
    `--font-heading: ${family(heading)}, sans-serif`,
    `--font-body: ${family(body)}, sans-serif`,
    `--radius-md: ${Number(radiusMd) || FALLBACK_RADIUS.medium}px`,
    `--radius-btn: ${Number(radiusBtn) || FALLBACK_RADIUS.medium}px`,
  ].join('; ')

  const sel = `[${CARD_PREVIEW_ATTRIBUTE}="${scope.replace(/[^A-Za-z0-9_-]/g, '')}"]`
  const mode = themeMode ?? 'toggle'
  const rules = [`${sel} { ${shared}; ${palette(mode === 'lightOnly' ? 'light' : 'dark')}; }`]
  if (mode !== 'lightOnly' && mode !== 'darkOnly') rules.push(`html.light ${sel} { ${palette('light')}; }`)
  return { css: rules.join('\n'), fontsUrl: buildGoogleFontsUrl(heading, body) }
}
