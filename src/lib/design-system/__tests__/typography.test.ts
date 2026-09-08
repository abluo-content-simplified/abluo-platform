import { describe, it, expect } from 'vitest'
import {
  fluidHeadingSize,
  fluidMinPx,
  headingVars,
  isTypographyLegacyTenant,
  MIN_VW,
  MAX_VW,
} from '@/lib/design-system/typography'

/** Evaluate `clamp(<a>rem, <b>rem + <c>vw, <d>rem)` at a viewport width, in px. */
function evalClamp(css: string, vw: number): number {
  const plain = /^([\d.]+)rem$/.exec(css)
  if (plain) return parseFloat(plain[1]) * 16
  const m = /^clamp\(([\d.-]+)rem, ([\d.-]+)rem \+ ([\d.-]+)vw, ([\d.-]+)rem\)$/.exec(css)
  if (!m) throw new Error(`unparseable clamp: ${css}`)
  const [min, intercept, slope, max] = [+m[1] * 16, +m[2] * 16, +m[3], +m[4] * 16]
  return Math.min(max, Math.max(min, intercept + (slope / 100) * vw))
}

describe('fluidHeadingSize', () => {
  it('equals the design-system size at and above the max viewport', () => {
    for (const size of [76, 68, 54, 34, 24]) {
      const css = fluidHeadingSize(size)
      expect(evalClamp(css, MAX_VW)).toBeCloseTo(size, 1)
      expect(evalClamp(css, 1920)).toBeCloseTo(size, 1)
    }
  })

  it('equals the computed mobile minimum at the min viewport and below', () => {
    const css = fluidHeadingSize(76)
    expect(evalClamp(css, MIN_VW)).toBeCloseTo(fluidMinPx(76), 1)
    expect(evalClamp(css, 320)).toBeCloseTo(fluidMinPx(76), 1)
  })

  it("lands near the old Tailwind mobile size at 375px", () => {
    // h1 was text-5xl (48px), h2 text-3xl (30px), h3 text-2xl (24px), h4 text-xl (20px)
    expect(evalClamp(fluidHeadingSize(76), 375)).toBeCloseTo(47, 0)
    expect(evalClamp(fluidHeadingSize(54), 375)).toBeCloseTo(33, 0)
    expect(evalClamp(fluidHeadingSize(34), 375)).toBeCloseTo(21, 0)
    expect(evalClamp(fluidHeadingSize(24), 375)).toBeCloseTo(18, 0)
  })

  it('increases monotonically across the fluid range', () => {
    const css = fluidHeadingSize(76)
    let prev = 0
    for (let vw = 320; vw <= 1600; vw += 40) {
      const v = evalClamp(css, vw)
      expect(v).toBeGreaterThanOrEqual(prev - 0.001)
      prev = v
    }
  })

  it('never renders below the 18px floor', () => {
    expect(fluidMinPx(20)).toBe(18)
    expect(fluidMinPx(24)).toBe(18)
  })

  it('collapses to a plain rem when the floor meets the size', () => {
    expect(fluidHeadingSize(18)).toBe('1.125rem')
    expect(fluidHeadingSize(14)).toBe('0.875rem')
  })

  it('emits nothing for a missing or nonsense size', () => {
    expect(fluidHeadingSize(0)).toBe('')
    expect(fluidHeadingSize(NaN)).toBe('')
  })

  it('produces the exact No!Logo h1 clamp', () => {
    expect(fluidHeadingSize(76)).toBe('clamp(2.9375rem, 2.1865rem + 3.2044vw, 4.75rem)')
  })
})

describe('minSize: an explicit clamp minimum', () => {
  it('is used verbatim as the minimum at and below MIN_VW', () => {
    // tmz.it's hero: clamp(4rem, 11vw, 15rem) — 64px at 375, 240px at 1280.
    const css = fluidHeadingSize(240, 64)
    expect(evalClamp(css, MIN_VW)).toBeCloseTo(64, 1)
    expect(evalClamp(css, 320)).toBeCloseTo(64, 1)
    expect(evalClamp(css, MAX_VW)).toBeCloseTo(240, 1)
  })

  it('is what the 0.62 derivation could not express', () => {
    // The whole reason the field exists: derived would be 149px on a 375px
    // screen, which is roughly three times the viewport width.
    expect(fluidMinPx(240)).toBe(149)
    expect(fluidMinPx(240, 64)).toBe(64)
  })

  it('still interpolates linearly between the two ends', () => {
    const css = fluidHeadingSize(240, 64)
    const mid = (MIN_VW + MAX_VW) / 2
    expect(evalClamp(css, mid)).toBeCloseTo((64 + 240) / 2, 0)
  })

  it('is ignored when absent, zero, negative or not a number', () => {
    const derived = fluidHeadingSize(76)
    expect(fluidHeadingSize(76, undefined)).toBe(derived)
    expect(fluidHeadingSize(76, null)).toBe(derived)
    expect(fluidHeadingSize(76, 0)).toBe(derived)
    expect(fluidHeadingSize(76, -10)).toBe(derived)
    expect(fluidHeadingSize(76, NaN)).toBe(derived)
  })

  it('is clamped to the maximum — a min above the max is a typo, not a request', () => {
    // clamp(x, …, y) with x > y resolves to x at EVERY width, i.e. not fluid at
    // all. Collapsing to the plain max is the safer reading of the mistake.
    expect(fluidMinPx(40, 90)).toBe(40)
    expect(fluidHeadingSize(40, 90)).toBe('2.5rem')
  })

  it('may go below MIN_FLOOR_PX, which only guards the derivation', () => {
    // The 18px floor exists so the 0.62 ratio cannot accidentally produce
    // unreadable text. An author who types 12 meant 12.
    expect(fluidMinPx(30, 12)).toBe(12)
  })

  it('every existing site is byte-identical — no scale sets minSize yet', () => {
    for (const size of [76, 68, 54, 34, 24, 20, 18]) {
      expect(fluidHeadingSize(size, undefined)).toBe(fluidHeadingSize(size))
    }
  })

  it('headingVars threads minSize through from the scale', () => {
    const [line] = headingVars('h1', { size: 240, minSize: 64 }, '')
    expect(line).toBe(`--font-size-h1: ${fluidHeadingSize(240, 64)};`)
    expect(line).toContain('4rem')
    expect(line).toContain('15rem')
  })
})

describe('headingVars', () => {
  it('emits nothing when the level is absent — the component fallback survives', () => {
    expect(headingVars('h1', undefined)).toEqual([])
    expect(headingVars('h1', {})).toEqual([])
  })

  it('emits only the properties the design system defines', () => {
    expect(headingVars('h2', { weight: 700 }, '')).toEqual(['--font-weight-h2: 700;'])
  })

  it('emits size, weight, line height and letter spacing', () => {
    const out = headingVars('h1', { size: 76, weight: 700, lineHeight: 1.02, letterSpacing: -2.2 }, '')
    expect(out).toEqual([
      '--font-size-h1: clamp(2.9375rem, 2.1865rem + 3.2044vw, 4.75rem);',
      '--font-weight-h1: 700;',
      '--line-height-h1: 1.02;',
      '--letter-spacing-h1: -0.1375rem;',
    ])
  })

  it('keeps a zero letter spacing (0 is a real value, not "unset")', () => {
    expect(headingVars('h3', { letterSpacing: 0 }, '')).toEqual(['--letter-spacing-h3: 0rem;'])
  })
})

describe('isTypographyLegacyTenant', () => {
  it('pins livener to the pre-design-system rendering', () => {
    expect(isTypographyLegacyTenant('livener')).toBe(true)
  })

  it('lets every other tenant use the design system scale', () => {
    expect(isTypographyLegacyTenant('nologo')).toBe(false)
    expect(isTypographyLegacyTenant('studiomartegani')).toBe(false)
    expect(isTypographyLegacyTenant(undefined)).toBe(false)
  })
})
