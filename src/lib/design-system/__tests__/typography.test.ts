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
