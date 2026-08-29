import { describe, expect, it } from 'vitest'
import { AA_LARGE, AA_NORMAL, contrastRatio, parseColor, type Rgb } from '../contrast'
import { DEFAULT_FOOTER_SURFACE, footerThemeVars, type FooterPalette } from '../footer-tokens'
import type { FooterSurfaceToken } from '@/lib/sanity/types'

/** The three palettes the platform actually ships, dark and light. */
const PALETTES: Record<string, FooterPalette> = {
  nologoDark: {
    bg: '#08070b',
    bgAlt: '#100f14',
    surface: '#18171e',
    primary: '#ff6832',
    secondary: '#ff8a5c',
    textPrimary: '#edecf4',
    textSecondary: '#b9b7c6',
    textMuted: '#8a8899',
    border: '#2c2b36',
  },
  nologoLight: {
    bg: '#ffffff',
    bgAlt: '#f3f2f7',
    surface: '#ebeaf0',
    primary: '#c2410c',
    secondary: '#9a3412',
    textPrimary: '#111114',
    textSecondary: '#3f3f46',
    textMuted: '#6f6f73',
    border: '#d8d7de',
  },
  livenerDark: {
    bg: 'oklch(0.2309 0.0292 263.75deg)',
    bgAlt: 'oklch(0.2626 0.0223 288.58deg)',
    surface: 'oklch(0.2626 0.0223 288.58deg)',
    primary: 'oklch(0.7886 0.1630 66.32deg)',
    secondary: 'oklch(0.3515 0.0866 283.66deg)',
    textPrimary: 'oklch(0.9612 0.0000 89.88deg)',
    textSecondary: 'oklch(0.9612 0.0000 89.88deg / 0.55)',
    textMuted: 'oklch(0.9612 0.0000 89.88deg / 0.4)',
    border: 'oklch(1 0 0 / 0.1)',
  },
  martegani: {
    bg: 'oklch(0.1549 0.0224 254.80deg)',
    bgAlt: 'oklch(0.1549 0.0224 254.80deg)',
    surface: 'oklch(0.1549 0.0224 254.80deg)',
    primary: 'oklch(0.7215 0.1128 191.01deg)',
    secondary: 'oklch(0.7215 0.1128 191.01deg)',
    textPrimary: 'oklch(0.96 0 0)',
    textSecondary: 'oklch(0.96 0 0 / 0.55)',
    textMuted: 'oklch(0.96 0 0 / 0.4)',
    border: 'oklch(1 0 0 / 0.1)',
  },
}

const SURFACES: FooterSurfaceToken[] = ['secondary', 'primary', 'background', 'backgroundAlt', 'surface']

/** Pulls one emitted declaration back out of the CSS block. */
function tokenOf(css: string, name: string): string {
  const m = new RegExp(`--color-footer-${name}:\\s*([^;]+);`).exec(css)
  if (!m) throw new Error(`--color-footer-${name} was not emitted`)
  return m[1].trim()
}
const rgbOf = (css: string): Rgb => {
  const p = parseColor(css)
  if (!p) throw new Error(`unparsable: ${css}`)
  return p.rgb
}

describe('footerThemeVars', () => {
  it('emits the full token set', () => {
    const css = footerThemeVars('backgroundAlt', PALETTES.nologoDark)
    for (const name of ['bg', 'text', 'text-muted', 'border', 'accent']) {
      expect(() => tokenOf(css, name)).not.toThrow()
    }
  })

  it('defaults to the secondary surface, which is what the footer hard-coded before', () => {
    const withDefault = footerThemeVars(undefined, PALETTES.livenerDark)
    const explicit = footerThemeVars(DEFAULT_FOOTER_SURFACE, PALETTES.livenerDark)
    expect(withDefault).toBe(explicit)
    expect(tokenOf(withDefault, 'bg')).toBe(PALETTES.livenerDark.secondary)
  })

  it('passes the chosen surface through verbatim, so authored colour syntax survives', () => {
    expect(tokenOf(footerThemeVars('backgroundAlt', PALETTES.nologoDark), 'bg')).toBe('#100f14')
    expect(tokenOf(footerThemeVars('primary', PALETTES.livenerDark), 'bg')).toBe(PALETTES.livenerDark.primary)
  })

  // The whole point of the module.
  it('clears WCAG AA for body text on every surface of every shipped palette', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const surface of SURFACES) {
        const css = footerThemeVars(surface, palette)
        const bg = rgbOf(tokenOf(css, 'bg'))
        const text = rgbOf(tokenOf(css, 'text'))
        const muted = rgbOf(tokenOf(css, 'text-muted'))
        expect(contrastRatio(text, bg), `${name}/${surface} text`).toBeGreaterThanOrEqual(AA_NORMAL)
        expect(contrastRatio(muted, bg), `${name}/${surface} muted`).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    }
  })

  it('leaves head-room above the target, so a one-unit colour-space difference cannot fail it', () => {
    for (const palette of Object.values(PALETTES)) {
      for (const surface of SURFACES) {
        const css = footerThemeVars(surface, palette)
        const bg = rgbOf(tokenOf(css, 'bg'))
        expect(contrastRatio(rgbOf(tokenOf(css, 'text-muted')), bg)).toBeGreaterThan(AA_NORMAL + 0.05)
      }
    }
  })

  it('clears AA-large for the accent on every surface of every shipped palette', () => {
    for (const [name, palette] of Object.entries(PALETTES)) {
      for (const surface of SURFACES) {
        const css = footerThemeVars(surface, palette)
        const bg = rgbOf(tokenOf(css, 'bg'))
        const accent = rgbOf(tokenOf(css, 'accent'))
        expect(contrastRatio(accent, bg), `${name}/${surface} accent`).toBeGreaterThanOrEqual(AA_LARGE)
      }
    }
  })

  it('reproduces the reported failure and shows it fixed', () => {
    // Before: the footer painted --color-secondary and wrote --color-text-primary on it.
    const before = contrastRatio(rgbOf(PALETTES.nologoDark.textPrimary), rgbOf(PALETTES.nologoDark.secondary))
    expect(before).toBeLessThan(2)
    // After: same surface, derived ink.
    const css = footerThemeVars('secondary', PALETTES.nologoDark)
    const after = contrastRatio(rgbOf(tokenOf(css, 'text')), rgbOf(tokenOf(css, 'bg')))
    expect(after).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('keeps the muted tier quieter than the primary tier', () => {
    const css = footerThemeVars('backgroundAlt', PALETTES.nologoDark)
    const bg = rgbOf(tokenOf(css, 'bg'))
    expect(contrastRatio(rgbOf(tokenOf(css, 'text-muted')), bg))
      .toBeLessThan(contrastRatio(rgbOf(tokenOf(css, 'text')), bg))
  })

  it('falls back to the theme tokens, unchanged, when the surface cannot be parsed', () => {
    const palette: FooterPalette = { ...PALETTES.nologoDark, secondary: 'color-mix(in oklch, red 50%, blue)' }
    const css = footerThemeVars('secondary', palette)
    expect(tokenOf(css, 'bg')).toBe('color-mix(in oklch, red 50%, blue)')
    expect(tokenOf(css, 'text')).toBe(palette.textPrimary)
    expect(tokenOf(css, 'text-muted')).toBe(palette.textMuted)
    expect(tokenOf(css, 'border')).toBe(palette.border)
    expect(tokenOf(css, 'accent')).toBe(palette.primary)
  })

  it('indents every line, so the emitted stylesheet stays readable', () => {
    const css = footerThemeVars('secondary', PALETTES.nologoDark, '      ')
    for (const line of css.split('\n')) expect(line.startsWith('      --color-footer-')).toBe(true)
  })
})
