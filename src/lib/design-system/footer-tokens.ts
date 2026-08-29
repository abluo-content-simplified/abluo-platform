import {
  AA_LARGE,
  AA_NORMAL,
  accentOn,
  bestTextOn,
  borderOn,
  mutedOn,
  parseColor,
  toCssRgb,
  type Rgb,
} from './contrast'
import type { FooterSurfaceToken } from '@/lib/sanity/types'

/**
 * The palette values buildCssVars() has already resolved for one theme. Only
 * the entries the footer needs are listed; the caller passes its own `D`/`L`
 * object, which is a superset.
 */
export interface FooterPalette {
  bg: string
  bgAlt: string
  surface: string
  primary: string
  secondary: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  border: string
}

const SURFACE_KEYS: Record<FooterSurfaceToken, keyof FooterPalette> = {
  secondary: 'secondary',
  primary: 'primary',
  background: 'bg',
  backgroundAlt: 'bgAlt',
  surface: 'surface',
}

/** What every footer hard-coded before the design system could express it. */
export const DEFAULT_FOOTER_SURFACE: FooterSurfaceToken = 'secondary'

/**
 * Head-room added to every contrast target before solving.
 *
 * We convert the surface from `oklch()` to sRGB ourselves, and the browser does
 * the same conversion with its own gamut mapping. The two agree to within about
 * one unit per channel — Studio Martegani's teal is 51,187,182 here and
 * 50,187,182 in Chrome — and one unit is enough to turn a solved 4.50 into a
 * measured 4.49, which is a failure. Solving a shade stricter absorbs that
 * without being visible.
 */
const SOLVE_MARGIN = 0.1

/**
 * Emits the `--color-footer-*` custom properties for one theme.
 *
 * The footer is the one region that paints itself with a colour chosen
 * independently of the page background, so the page's text tokens cannot be
 * trusted on it — `--color-text-primary` on a brand-orange footer measured
 * 1.98:1, and Livener's light theme bottomed out at 1.03:1. Here the surface is
 * resolved first and the ink is derived from it:
 *
 *   --color-footer-bg           the chosen surface, verbatim
 *   --color-footer-text         maximum-contrast ink for that surface
 *   --color-footer-text-muted   faded, but solved to still clear AA (4.5:1)
 *   --color-footer-border       a hairline, held to a decorative 1.6:1
 *   --color-footer-accent       the brand accent, nudged toward the ink only
 *                               as far as AA-large (3:1) requires
 *
 * The muted tier replaces the old `color: text-primary; opacity: 0.45` pattern,
 * where the opacity was picked by eye and silently destroyed the ratio. These
 * values are already composited, so consumers set `color` and no `opacity`.
 *
 * If the surface uses a colour syntax we cannot parse (`color-mix()`, a bare
 * `var()`), we emit the theme's own tokens unchanged rather than guessing —
 * the footer then behaves exactly as it did before this function existed.
 */
export function footerThemeVars(
  surfaceToken: FooterSurfaceToken | undefined,
  palette: FooterPalette,
  indent = '',
): string {
  const key = SURFACE_KEYS[surfaceToken ?? DEFAULT_FOOTER_SURFACE] ?? 'secondary'
  const surfaceCss = palette[key]

  const parsed = parseColor(surfaceCss)
  const line = (name: string, value: string) => `${indent}--color-footer-${name}: ${value};`

  if (!parsed) {
    return [
      line('bg', surfaceCss),
      line('text', palette.textPrimary),
      line('text-muted', palette.textMuted),
      line('border', palette.border),
      line('accent', palette.primary),
    ].join('\n')
  }

  const bg: Rgb = parsed.rgb
  const ink = bestTextOn(bg)
  const accentSource = parseColor(palette.primary)?.rgb ?? ink

  return [
    line('bg', surfaceCss),
    line('text', toCssRgb(ink)),
    line('text-muted', toCssRgb(mutedOn(ink, bg, AA_NORMAL + SOLVE_MARGIN))),
    line('border', toCssRgb(borderOn(bg))),
    line('accent', toCssRgb(accentOn(accentSource, bg, AA_LARGE + SOLVE_MARGIN))),
  ].join('\n')
}
