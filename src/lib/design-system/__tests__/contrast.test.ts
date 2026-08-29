import { describe, expect, it } from 'vitest'
import {
  AA_LARGE,
  AA_NORMAL,
  accentOn,
  bestTextOn,
  borderOn,
  compositeOver,
  contrastRatio,
  mutedOn,
  parseColor,
  relativeLuminance,
  toCssRgb,
  type Rgb,
} from '../contrast'

const rgbOf = (css: string): Rgb => {
  const p = parseColor(css)
  if (!p) throw new Error(`could not parse ${css}`)
  return p.rgb
}
const round = (c: Rgb) => c.map((n) => Math.round(n))

describe('parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(round(rgbOf('#ff6832'))).toEqual([255, 104, 50])
  })

  it('parses 3-digit hex by doubling each nibble', () => {
    expect(round(rgbOf('#f63'))).toEqual([255, 102, 51])
  })

  it('parses 8-digit hex and keeps the alpha channel', () => {
    const p = parseColor('#ff683280')
    expect(round(p!.rgb)).toEqual([255, 104, 50])
    expect(p!.alpha).toBeCloseTo(0.502, 2)
  })

  it('parses rgb() with spaces and with commas', () => {
    expect(round(rgbOf('rgb(255 138 92)'))).toEqual([255, 138, 92])
    expect(round(rgbOf('rgb(255, 138, 92)'))).toEqual([255, 138, 92])
  })

  it('parses legacy rgba() alpha and slash alpha alike', () => {
    expect(parseColor('rgba(0, 0, 0, 0.4)')!.alpha).toBeCloseTo(0.4)
    expect(parseColor('rgb(0 0 0 / 40%)')!.alpha).toBeCloseTo(0.4)
  })

  it('parses oklch() as the design system writes it, with a deg hue', () => {
    // oklch(1 0 0) is pure white.
    expect(round(rgbOf('oklch(1 0 0)'))).toEqual([255, 255, 255])
    // Zero chroma, so all three channels agree.
    const grey = round(rgbOf('oklch(0.5 0 0deg)'))
    expect(grey[0]).toBe(grey[1])
    expect(grey[1]).toBe(grey[2])
    // OKLab lightness is perceptual, not sRGB: L=0.5 lands near #636363, and
    // sRGB mid-grey #808080 sits up at L~0.60. Guarding the exact value keeps
    // an accidental "L * 255" shortcut from ever passing.
    expect(grey[0]).toBe(99)
    expect(round(rgbOf('oklch(0.5987 0 0)'))[0]).toBe(128)
  })

  it('parses the oklch alpha syntax used by the text tokens', () => {
    const p = parseColor('oklch(0.9612 0.0000 89.88deg / 0.55)')
    expect(p).not.toBeNull()
    expect(p!.alpha).toBeCloseTo(0.55)
  })

  it('accepts a percentage lightness', () => {
    expect(round(rgbOf('oklch(100% 0 0)'))).toEqual([255, 255, 255])
  })

  it('returns null for syntaxes it cannot resolve, rather than guessing', () => {
    expect(parseColor('color-mix(in oklch, red 50%, blue)')).toBeNull()
    expect(parseColor('var(--color-primary)')).toBeNull()
    expect(parseColor('rebeccapurple')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor(null)).toBeNull()
    expect(parseColor(undefined)).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
  })

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio([120, 30, 200], [120, 30, 200])).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    const a: Rgb = [255, 138, 92]
    const b: Rgb = [16, 15, 20]
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('reproduces the failures this module was written to fix', () => {
    // The nologo footer: near-white text on the brand orange surface.
    expect(contrastRatio(rgbOf('#edecf4'), rgbOf('#ff8a5c'))).toBeLessThan(2)
    // The wordmark accent on that same surface.
    expect(contrastRatio(rgbOf('#ff6832'), rgbOf('#ff8a5c'))).toBeLessThan(1.5)
  })

  it('confirms white on the brand orange fails AA (the original report)', () => {
    expect(contrastRatio([255, 255, 255], rgbOf('#ff6832'))).toBeLessThan(3)
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6)
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6)
  })
})

describe('compositeOver', () => {
  it('returns the foreground at alpha 1 and the background at alpha 0', () => {
    const fg: Rgb = [255, 0, 0]
    const bg: Rgb = [0, 0, 255]
    expect(round(compositeOver(fg, 1, bg))).toEqual([255, 0, 0])
    expect(round(compositeOver(fg, 0, bg))).toEqual([0, 0, 255])
  })

  it('meets in the middle at alpha 0.5', () => {
    expect(round(compositeOver([255, 255, 255], 0.5, [0, 0, 0]))).toEqual([128, 128, 128])
  })

  it('clamps an out-of-range alpha instead of overshooting', () => {
    expect(round(compositeOver([255, 255, 255], 2, [0, 0, 0]))).toEqual([255, 255, 255])
    expect(round(compositeOver([255, 255, 255], -1, [0, 0, 0]))).toEqual([0, 0, 0])
  })
})

describe('bestTextOn', () => {
  it('picks dark ink on a light surface and light ink on a dark one', () => {
    expect(relativeLuminance(bestTextOn(rgbOf('#ffffff')))).toBeLessThan(0.1)
    expect(relativeLuminance(bestTextOn(rgbOf('#08070b')))).toBeGreaterThan(0.9)
  })

  it('picks dark ink on the brand orange, which is where white was failing', () => {
    const ink = bestTextOn(rgbOf('#ff8a5c'))
    expect(contrastRatio(ink, rgbOf('#ff8a5c'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('honours explicit candidates', () => {
    const ink = bestTextOn([128, 128, 128], [[0, 0, 0], [255, 255, 255]])
    expect(round(ink)).toEqual([0, 0, 0])
  })
})

describe('mutedOn', () => {
  const surfaces = ['#08070b', '#100f14', '#ff8a5c', '#9a3412', '#ffffff', '#f4f4f5', '#2c2b36']

  it('always clears AA on every surface the platform ships', () => {
    for (const s of surfaces) {
      const bg = rgbOf(s)
      const muted = mutedOn(bestTextOn(bg), bg)
      // No epsilon: the returned colour is already snapped to the integer
      // channels that reach the browser, so what we assert here is exactly
      // what a contrast checker measures on the page.
      expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it('returns integer channels, so rounding cannot drop it below the target', () => {
    for (const s of surfaces) {
      const bg = rgbOf(s)
      const muted = mutedOn(bestTextOn(bg), bg)
      expect(muted.map((c) => c % 1)).toEqual([0, 0, 0])
    }
  })

  it('actually mutes — the result sits closer to the surface than full ink', () => {
    const bg = rgbOf('#100f14')
    const ink = bestTextOn(bg)
    const muted = mutedOn(ink, bg)
    expect(contrastRatio(muted, bg)).toBeLessThan(contrastRatio(ink, bg))
  })

  it('respects a stricter target by muting less', () => {
    const bg = rgbOf('#100f14')
    const ink = bestTextOn(bg)
    const aa = contrastRatio(mutedOn(ink, bg, 4.5), bg)
    const aaa = contrastRatio(mutedOn(ink, bg, 7), bg)
    expect(aaa).toBeGreaterThan(aa)
  })

  it('returns the text unfaded when even full opacity cannot reach the target', () => {
    const bg: Rgb = [128, 128, 128]
    const text: Rgb = [130, 130, 130]
    expect(round(mutedOn(text, bg))).toEqual(round(text))
  })
})

describe('borderOn', () => {
  it('is visible against the surface but quieter than body text', () => {
    const bg = rgbOf('#100f14')
    const border = borderOn(bg)
    const r = contrastRatio(border, bg)
    expect(r).toBeGreaterThan(1.3)
    expect(r).toBeLessThan(AA_NORMAL)
  })
})

describe('accentOn', () => {
  it('leaves an accent alone when it already passes', () => {
    const bg = rgbOf('#08070b')
    const accent = rgbOf('#ff6832')
    expect(contrastRatio(accent, bg)).toBeGreaterThanOrEqual(AA_LARGE)
    expect(round(accentOn(accent, bg))).toEqual(round(accent))
  })

  it('rescues the wordmark accent on the brand orange surface', () => {
    const bg = rgbOf('#ff8a5c')
    const accent = rgbOf('#ff6832')
    expect(contrastRatio(accent, bg)).toBeLessThan(AA_LARGE)
    const fixed = accentOn(accent, bg)
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('clears AA large on every surface the platform ships', () => {
    for (const s of ['#08070b', '#100f14', '#ff8a5c', '#9a3412', '#ffffff']) {
      const bg = rgbOf(s)
      expect(contrastRatio(accentOn(rgbOf('#ff6832'), bg), bg)).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })
})

describe('toCssRgb', () => {
  it('emits rounded integer channels in modern space-separated syntax', () => {
    expect(toCssRgb([12.4, 200.6, 0])).toBe('rgb(12 201 0)')
  })
})
