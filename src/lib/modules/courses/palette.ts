// ── Courses module — the course colour palette (ADR-045, Tom 2026-11-08) ──────
//
// A course is marked with one of six colours (or none). The colours are never
// stored: a course stores a stable, meaning-free KEY ('c1' … 'c6'), and the
// actual colours are DERIVED from the site's design system — its primary
// colour and hue-rotated companions — so every site gets six colours that sit
// with its brand. One pure function computes them for every reader:
//
//   · the dashboard (the colour dot in the Courses list, the editor's swatches)
//   · the website timetable (ClassCard / ClassPanel tint), via CSS variables
//     emitted by the tenant layout (`coursePaletteCssVars`)
//
// Each colour has three shades for one surface (light or dark theme):
//   bg   a soft tint of the surface (card background)
//   dot  the colour itself (marker, swatch) — lightness varies from colour to
//        colour so they differ for people who cannot tell the hues apart
//   fg   a text shade of the colour, ≥ 4.5:1 on both `bg` and the surface
//
// The course name is always shown next to a colour, so colours may repeat.
// Print stays black and white (the CSS block turns the tint off for print).
//
// Pure and browser-safe (no React, no I/O).

import { compositeOver, contrastRatio, parseColor, roundRgb, toCssRgb, type Rgb } from '@/lib/design-system/contrast'

export const COURSE_PALETTE_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const
export type CoursePaletteKey = (typeof COURSE_PALETTE_KEYS)[number]

/** What a course stores: a palette key, or 'none' (no colour). */
export const COURSE_COLORS = ['none', ...COURSE_PALETTE_KEYS] as const
export type CourseColor = (typeof COURSE_COLORS)[number]
export const DEFAULT_COURSE_COLOR: CourseColor = 'none'

/**
 * The two values of the first version (design-system tokens). Still accepted on
 * READ so stored courses keep their marking without a data migration:
 * accent (the primary colour) → c1 (the primary hue), muted → c6.
 */
export const LEGACY_COURSE_COLORS: Readonly<Record<string, CourseColor>> = { accent: 'c1', muted: 'c6' }

/** A stored value (current or legacy) → the colour key; anything else → 'none'. */
export function normalizeCourseColor(value: unknown): CourseColor {
  if (typeof value !== 'string') return DEFAULT_COURSE_COLOR
  if ((COURSE_COLORS as readonly string[]).includes(value)) return value as CourseColor
  return LEGACY_COURSE_COLORS[value] ?? DEFAULT_COURSE_COLOR
}

/** A value a course may be SAVED with (legacy values are not written any more). */
export function isCourseColor(value: unknown): value is CourseColor {
  return typeof value === 'string' && (COURSE_COLORS as readonly string[]).includes(value)
}

export type CourseSwatch = { bg: string; fg: string; dot: string }
export type CoursePalette = Record<CoursePaletteKey, CourseSwatch>
export type PaletteTheme = 'light' | 'dark'

/** WCAG AA for normal text. */
export const COURSE_TEXT_CONTRAST = 4.5

// ── Colour maths (OKLab / OKLCH ↔ sRGB) ──────────────────────────────────────

type Lch = { l: number; c: number; h: number }

const toLinear = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

export function rgbToOklch([r, g, b]: Rgb): Lch {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.sqrt(A * A + B * B)
  const h = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: L, c, h }
}

/** Linear sRGB of an OKLCH colour (may lie outside [0, 1] = out of gamut). */
function oklchToLinear({ l, c, h }: Lch): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const b = c * Math.sin(hr)
  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3)
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const inGamut = (lin: readonly number[]) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** The colour in sRGB; chroma is reduced (hue and lightness kept) until it is displayable. */
export function oklchToRgb(lch: Lch): Rgb {
  let { c } = lch
  let lin = oklchToLinear({ ...lch, c })
  if (!inGamut(lin)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ ...lch, c: mid }))) lo = mid
      else hi = mid
    }
    c = lo
    lin = oklchToLinear({ ...lch, c })
  }
  const enc = lin.map((v) => Math.max(0, Math.min(1, toGamma(Math.max(0, Math.min(1, v))))) * 255)
  return roundRgb([enc[0], enc[1], enc[2]])
}

/** OKLab distance (ΔE OK) between two colours — ~0.02 is barely visible, 0.1 clearly different. */
export function oklabDistance(a: Rgb, b: Rgb): number {
  const x = rgbToOklch(a)
  const y = rgbToOklch(b)
  const ax = x.c * Math.cos((x.h * Math.PI) / 180)
  const ay = x.c * Math.sin((x.h * Math.PI) / 180)
  const bx = y.c * Math.cos((y.h * Math.PI) / 180)
  const by = y.c * Math.sin((y.h * Math.PI) / 180)
  return Math.sqrt((x.l - y.l) ** 2 + (ax - bx) ** 2 + (ay - by) ** 2)
}

// ── The palette ──────────────────────────────────────────────────────────────

/** Hue steps from the primary hue: evenly spread, so neighbours never look alike. */
const HUE_STEPS = [0, 60, 120, 180, 240, 300] as const
/**
 * Lightness of each colour's dot, per theme. Alternating light / dark (not a
 * ramp) so two colours next to each other differ in lightness too — what
 * people with a colour-vision deficiency rely on.
 */
const DOT_L: Record<PaletteTheme, readonly number[]> = {
  light: [0.56, 0.42, 0.68, 0.48, 0.62, 0.36],
  dark: [0.74, 0.6, 0.84, 0.66, 0.79, 0.55],
}
const DOT_C = 0.15
/** How much of the dot colour tints the surface for `bg`. */
const BG_MIX: Record<PaletteTheme, number> = { light: 0.13, dark: 0.22 }
const FALLBACK_PRIMARY: Rgb = [10, 108, 255]
const FALLBACK_SURFACE: Record<PaletteTheme, Rgb> = { light: [255, 255, 255], dark: [30, 31, 36] }

const opaque = (value: string | null | undefined): Rgb | null => {
  const p = parseColor(value)
  return p && p.alpha > 0.99 ? p.rgb : null
}

/** The darkest (light theme) / lightest (dark theme) shade of `hue` needed for readable text on both backgrounds. */
function textShade(hue: number, theme: PaletteTheme, backgrounds: readonly Rgb[]): Rgb {
  const chroma = theme === 'light' ? 0.11 : 0.08
  const step = theme === 'light' ? -0.01 : 0.01
  let l = theme === 'light' ? 0.46 : 0.84
  let best = oklchToRgb({ l, c: chroma, h: hue })
  for (let i = 0; i < 60; i++) {
    best = oklchToRgb({ l, c: chroma, h: hue })
    if (backgrounds.every((bg) => contrastRatio(best, bg) >= COURSE_TEXT_CONTRAST)) return best
    l = Math.max(0, Math.min(1, l + step))
  }
  // Nothing coloured is readable here (an extreme surface): plain ink.
  return theme === 'light' ? [17, 17, 20] : [250, 250, 250]
}

/**
 * The six course colours for one theme of a site.
 *
 * @param primary  the design system's primary colour for that theme (hex, rgb() or oklch());
 *                 unset / unreadable → the platform blue
 * @param surface  the background the colours sit on (website: the theme's surface; dashboard: its card)
 */
export function coursePalette(input: { primary?: string | null; surface?: string | null; theme: PaletteTheme }): CoursePalette {
  const theme = input.theme
  const base = rgbToOklch(opaque(input.primary) ?? FALLBACK_PRIMARY)
  // A grey or black primary has no hue to start from: the platform blue's.
  const hue0 = base.c < 0.03 ? rgbToOklch(FALLBACK_PRIMARY).h : base.h
  const surface = opaque(input.surface) ?? FALLBACK_SURFACE[theme]
  const out = {} as CoursePalette
  COURSE_PALETTE_KEYS.forEach((key, i) => {
    const hue = (hue0 + HUE_STEPS[i]) % 360
    const dot = oklchToRgb({ l: DOT_L[theme][i], c: DOT_C, h: hue })
    const bg = roundRgb(compositeOver(dot, BG_MIX[theme], surface))
    const fg = textShade(hue, theme, [bg, surface])
    out[key] = { bg: toCssRgb(bg), fg: toCssRgb(fg), dot: toCssRgb(dot) }
  })
  return out
}

// ── CSS variables ────────────────────────────────────────────────────────────

/** `--course-c1-bg` … the variable names every reader uses. */
export const courseColorVar = (key: CoursePaletteKey, shade: keyof CourseSwatch) => `--course-${key}-${shade}`

/** One declaration per key and shade (`--course-c1-bg: rgb(…);`), for a CSS block. */
export function coursePaletteCssVars(palette: CoursePalette, indent = '      '): string {
  return COURSE_PALETTE_KEYS.map((key) =>
    (['bg', 'fg', 'dot'] as const).map((shade) => `${indent}${courseColorVar(key, shade)}: ${palette[key][shade]};\n`).join('')
  ).join('')
}

/** Print is black and white: the tint and the marker colour are switched off. */
export function coursePalettePrintCss(selector = ':root'): string {
  const decls = COURSE_PALETTE_KEYS.map((key) => `${courseColorVar(key, 'bg')}: transparent; ${courseColorVar(key, 'dot')}: currentColor; ${courseColorVar(key, 'fg')}: inherit;`).join(' ')
  return `@media print { ${selector} { ${decls} } }`
}

/**
 * The inline style of something marked with a course colour (a timetable card,
 * the class panel's title): the soft background and a left marker — CSS
 * variables only, so the theme (light / dark / print) decides the values.
 * `none` → no style at all.
 */
export function courseTintStyle(color: CourseColor, opts: { background?: boolean } = {}): Record<string, string> {
  if (color === 'none') return {}
  return {
    ...(opts.background !== false ? { backgroundColor: `var(${courseColorVar(color, 'bg')})` } : {}),
    borderLeft: `3px solid var(${courseColorVar(color, 'dot')})`,
  }
}
