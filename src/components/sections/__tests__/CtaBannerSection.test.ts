import { describe, expect, it } from 'vitest'
import { buildGlowBackground, hasRenderableCta } from '../CtaBannerSection'

describe('buildGlowBackground', () => {
  it('returns a gradient when showGlow is null (GROQ unset-field shape)', () => {
    // Regression guard: GROQ returns `null` (not `undefined`) for a boolean
    // that was never set, which bypasses destructuring defaults. The schema
    // default is true, so a null must still light the glow.
    expect(buildGlowBackground(null)).toBeDefined()
  })

  it('returns a gradient when showGlow is undefined', () => {
    expect(buildGlowBackground(undefined)).toBeDefined()
  })

  it('returns a gradient for an explicit true', () => {
    expect(buildGlowBackground(true)).toBeDefined()
  })

  it('returns nothing only for an explicit false', () => {
    expect(buildGlowBackground(false)).toBeUndefined()
  })

  it('derives the glow from the accent token, never a hardcoded colour', () => {
    const result = buildGlowBackground(true) ?? ''
    expect(result).toContain('var(--color-primary)')
    expect(result).not.toMatch(/rgba?\(/)
    expect(result).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})

describe('hasRenderableCta', () => {
  it('is false when neither CTA is authored', () => {
    expect(hasRenderableCta(null, null)).toBe(false)
  })

  it('is false when both CTAs resolve to none (half-filled in Studio)', () => {
    // resolveCta() returns { type: 'none' } for a CTA whose action is chosen
    // but whose target is still blank. CtaButton renders nothing for those,
    // so the row must not reserve its margin either.
    expect(hasRenderableCta({ type: 'none' }, { type: 'none' })).toBe(false)
  })

  it('is true when only the primary CTA resolves', () => {
    expect(hasRenderableCta({ type: 'link' }, null)).toBe(true)
  })

  it('is true when only the secondary CTA resolves', () => {
    expect(hasRenderableCta(null, { type: 'form' })).toBe(true)
  })

  it('is true when a resolvable CTA sits beside an unresolvable one', () => {
    expect(hasRenderableCta({ type: 'none' }, { type: 'download' })).toBe(true)
  })
})
