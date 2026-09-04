import { describe, it, expect } from 'vitest'
import {
  FALLBACK_DARK, FALLBACK_LIGHT, FALLBACK_STATE, FALLBACK_FONTS,
  NEUTRAL_ACCENT, KNOWN_TENANT_BRAND_VALUES,
} from '@/lib/design-system/fallback-tokens'

// The defect this locks out: for months the platform's "unset" colours WERE
// Livener's brand, so any tenant with a gap in their design system silently
// rendered in someone else's amber, and nothing said so.

const paletteValues = [...Object.values(FALLBACK_DARK), ...Object.values(FALLBACK_LIGHT)]

/** oklch(L C H) -> C. Returns 0 for anything without a chroma term. */
function chromaOf(value: string): number {
  const m = /oklch\(\s*[\d.]+\s+([\d.]+)/.exec(value)
  return m ? Number(m[1]) : 0
}

describe('fallback tokens are nobody’s brand', () => {
  it('never uses a value belonging to a live tenant', () => {
    const all = [...paletteValues, ...Object.values(FALLBACK_STATE), ...Object.values(FALLBACK_FONTS)]
    for (const brand of KNOWN_TENANT_BRAND_VALUES) {
      expect(all, `fallback must not use tenant value ${brand}`).not.toContain(brand)
    }
  })

  it('keeps every palette fallback achromatic except the one neutral accent', () => {
    for (const value of paletteValues) {
      if (value === NEUTRAL_ACCENT) continue
      expect(chromaOf(value), `${value} should be grey`).toBeLessThanOrEqual(0.01)
    }
  })

  it('allows the neutral accent some chroma, but keeps it desaturated', () => {
    const c = chromaOf(NEUTRAL_ACCENT)
    expect(c).toBeGreaterThan(0)
    // Livener's primary is 0.163, Abluo Dental's 0.1385 — a real brand accent.
    // Anything at that strength is a design decision, not a fallback.
    expect(c).toBeLessThan(0.08)
  })

  it('falls back to system fonts, never to a chosen typeface', () => {
    expect(FALLBACK_FONTS.heading).toBe('system-ui')
    expect(FALLBACK_FONTS.body).toBe('system-ui')
  })

  it('leaves semantic state colours saturated — red must read as an error', () => {
    expect(chromaOf(FALLBACK_STATE.dangerDark)).toBeGreaterThan(0.1)
    expect(chromaOf(FALLBACK_STATE.successDark)).toBeGreaterThan(0.1)
  })

  it('records the tenant values it guards against, so the test cannot rot', () => {
    expect(KNOWN_TENANT_BRAND_VALUES.length).toBeGreaterThanOrEqual(10)
  })
})
