/**
 * Contrast utilities for the design system.
 *
 * These exist because a token that is *correct* in one theme can be unreadable
 * in the other. The footer is the worst offender: it painted itself with the
 * brand colour (`--color-secondary`) and then wrote on top of it with
 * `--color-text-primary` at an arbitrary opacity — tokens tuned against the
 * page background, not against the brand colour. Every tenant's footer failed
 * WCAG AA in both themes, some as low as 1.03:1.
 *
 * Rather than hand-pick a colour per tenant (which is the hard-coding we are
 * trying to remove), we resolve the surface from the design system and then
 * *compute* the text colours that sit on it. Any brand colour, any theme, and
 * the result is legible by construction.
 *
 * Everything here is pure and synchronous: it runs once per request inside
 * buildCssVars(), and the numbers it produces are emitted as CSS custom
 * properties.
 */

export type Rgb = readonly [number, number, number]

/** WCAG 2.1 minimum contrast for normal-size body text. */
export const AA_NORMAL = 4.5
/** WCAG 2.1 minimum contrast for large text (>=24px, or >=18.66px bold). */
export const AA_LARGE = 3

// ─── Parsing ─────────────────────────────────────────────────────────────────

/** Parsed colour plus its alpha channel (1 when the syntax carries none). */
export interface ParsedColor {
  rgb: Rgb
  alpha: number
}

const HEX = /^#([0-9a-f]{3,8})$/i
const RGB_FN = /^rgba?\(([^)]+)\)$/i
const OKLCH_FN = /^oklch\(([^)]+)\)$/i

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function parseHex(hex: string): ParsedColor | null {
  const h = hex.length === 3 || hex.length === 4 ? hex.split('').map((c) => c + c).join('') : hex
  if (h.length !== 6 && h.length !== 8) return null
  const n = Number.parseInt(h, 16)
  if (Number.isNaN(n)) return null
  if (h.length === 6) {
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 }
  }
  return {
    rgb: [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255],
    alpha: (n & 255) / 255,
  }
}

/** Splits `1 2 3 / 0.5` or `1, 2, 3, 0.5` into channel strings plus alpha. */
function splitArgs(body: string): { parts: string[]; alpha: number } {
  const [main, alphaPart] = body.split('/')
  const parts = main.trim().split(/[\s,]+/).filter(Boolean)
  let alpha = 1
  if (alphaPart !== undefined) {
    alpha = parseNumber(alphaPart.trim(), 1)
  } else if (parts.length === 4) {
    // legacy rgba(r, g, b, a)
    alpha = parseNumber(parts.pop() as string, 1)
  }
  return { parts, alpha: clamp01(alpha) }
}

function parseNumber(raw: string, fallback: number): number {
  const pct = raw.endsWith('%')
  const n = Number.parseFloat(pct ? raw.slice(0, -1) : raw)
  if (Number.isNaN(n)) return fallback
  return pct ? n / 100 : n
}

function parseRgbFn(body: string): ParsedColor | null {
  const { parts, alpha } = splitArgs(body)
  if (parts.length < 3) return null
  const ch = parts.slice(0, 3).map((p) => {
    const n = p.endsWith('%') ? (Number.parseFloat(p) / 100) * 255 : Number.parseFloat(p)
    return Number.isNaN(n) ? NaN : Math.max(0, Math.min(255, n))
  })
  if (ch.some(Number.isNaN)) return null
  return { rgb: [ch[0], ch[1], ch[2]], alpha }
}

/** OKLCH -> OKLab -> linear sRGB -> gamma-encoded sRGB. */
function parseOklchFn(body: string): ParsedColor | null {
  const { parts, alpha } = splitArgs(body)
  if (parts.length < 3) return null
  const L = parseNumber(parts[0], NaN)
  const C = parseNumber(parts[1], NaN)
  // Hue may carry a `deg` (or `rad`/`turn`) unit; the design system writes `deg`.
  const hueRaw = parts[2]
  let H: number
  if (hueRaw.endsWith('turn')) H = Number.parseFloat(hueRaw) * 360
  else if (hueRaw.endsWith('rad')) H = (Number.parseFloat(hueRaw) * 180) / Math.PI
  else H = Number.parseFloat(hueRaw)
  if ([L, C, H].some(Number.isNaN)) return null

  const hr = (H * Math.PI) / 180
  const a = C * Math.cos(hr)
  const b = C * Math.sin(hr)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const enc = lin.map((v) => {
    const c = clamp01(v)
    const g = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return clamp01(g) * 255
  })
  return { rgb: [enc[0], enc[1], enc[2]], alpha }
}

/**
 * Parses the colour syntaxes the design system actually stores: hex (3/4/6/8
 * digit), `rgb()`/`rgba()`, and `oklch()` with or without an alpha channel.
 *
 * Returns null for anything else — `color-mix()`, `var()`, named colours,
 * gradients. Callers must treat null as "leave the existing behaviour alone"
 * rather than substituting a guess.
 */
export function parseColor(input: string | null | undefined): ParsedColor | null {
  if (!input) return null
  const s = String(input).trim().toLowerCase()
  const hex = HEX.exec(s)
  if (hex) return parseHex(hex[1])
  const rgbFn = RGB_FN.exec(s)
  if (rgbFn) return parseRgbFn(rgbFn[1])
  const oklch = OKLCH_FN.exec(s)
  if (oklch) return parseOklchFn(oklch[1])
  return null
}

// ─── Contrast maths (WCAG 2.1) ───────────────────────────────────────────────

export function relativeLuminance([r, g, b]: Rgb): number {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Composites `fg` at `alpha` over an opaque `bg`. */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = clamp01(alpha)
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ]
}

export function toCssRgb([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
}

// ─── Deriving readable colours ───────────────────────────────────────────────

const NEAR_WHITE: Rgb = [255, 255, 255]
const NEAR_BLACK: Rgb = [17, 17, 20]

/**
 * The higher-contrast of the two candidates against `bg`. Candidates default to
 * near-white and near-black, which is what "ink on this surface" means when the
 * theme's own text token is the thing that turned out to be wrong.
 */
export function bestTextOn(bg: Rgb, candidates: readonly Rgb[] = [NEAR_WHITE, NEAR_BLACK]): Rgb {
  let best = candidates[0]
  let bestRatio = -1
  for (const c of candidates) {
    const r = contrastRatio(c, bg)
    if (r > bestRatio) {
      bestRatio = r
      best = c
    }
  }
  return best
}

/**
 * The dimmest version of `text` on `bg` that still clears `target`.
 *
 * This replaces the pattern the footer used — `color: text-primary` plus
 * `opacity: 0.45` — where the opacity was chosen by eye and silently destroyed
 * the contrast ratio. Here the fade is solved for: we binary-search the alpha
 * and stop at the last value that still passes, so "muted" stays muted without
 * becoming unreadable. Returns the fully-composited opaque colour, so no
 * `opacity` is needed at the call site.
 */
export function mutedOn(text: Rgb, bg: Rgb, target: number = AA_NORMAL): Rgb {
  // If even fully opaque cannot clear the target, return it unfaded: the caller
  // gets the best available rather than a silently worse colour.
  if (contrastRatio(text, bg) < target) return text
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    // Solve against the ROUNDED colour. These values are emitted as integer
    // rgb() channels, and solving against the float then rounding lands a
    // hair under the target — 4.49 against a 4.5 requirement, which is a fail.
    if (contrastRatio(roundRgb(compositeOver(text, mid, bg)), bg) >= target) hi = mid
    else lo = mid
  }
  return roundRgb(compositeOver(text, hi, bg))
}

/** Snaps to the integer channels that `toCssRgb` will emit. */
export function roundRgb([r, g, b]: Rgb): Rgb {
  return [Math.round(r), Math.round(g), Math.round(b)]
}

/**
 * A hairline border for `bg` — visible but not loud. Borders are decorative, so
 * they are held to 3:1 rather than 4.5:1.
 */
export function borderOn(bg: Rgb, target = 1.6): Rgb {
  const ink = bestTextOn(bg)
  return mutedOn(ink, bg, target)
}

/**
 * An accent colour that stays recognisably itself but is lightened or darkened
 * toward the surface's ink until it clears `target` against `bg`.
 *
 * Used for the wordmark accent character: `#ff6832` on the brand orange footer
 * was 1.24:1 — the "!" was effectively invisible.
 */
export function accentOn(accent: Rgb, bg: Rgb, target: number = AA_LARGE): Rgb {
  if (contrastRatio(accent, bg) >= target) return accent
  const ink = bestTextOn(bg)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    // mid = how far we have pushed the accent toward the ink. Rounded for the
    // same reason as mutedOn(): the emitted colour is what gets measured.
    if (contrastRatio(roundRgb(compositeOver(ink, mid, accent)), bg) >= target) hi = mid
    else lo = mid
  }
  return roundRgb(compositeOver(ink, hi, accent))
}
