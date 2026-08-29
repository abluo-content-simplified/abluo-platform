import { describe, expect, it } from 'vitest'
import { buildHeroMediaFilter, resolveHeroCtaColors, resolveHeroMediaLayout } from '../HeroSection'

describe('buildHeroMediaFilter', () => {
  it('returns no filter when blur and brightness are null (GROQ unset-field shape)', () => {
    // Regression: GROQ returns `null` (not `undefined`) for unset numeric
    // fields, which previously bypassed destructuring defaults and produced
    // `brightness(0)` — rendering the media pure black.
    expect(buildHeroMediaFilter(null, null)).toBeUndefined()
  })

  it('returns no filter when blur and brightness are undefined', () => {
    expect(buildHeroMediaFilter(undefined, undefined)).toBeUndefined()
  })

  it('returns no filter for explicit defaults (blur 0, brightness 100)', () => {
    expect(buildHeroMediaFilter(0, 100)).toBeUndefined()
  })

  it('builds a blur clause when blur is greater than 0', () => {
    expect(buildHeroMediaFilter(8, 100)).toBe('blur(8px)')
  })

  it('builds a brightness clause when brightness is not 100', () => {
    expect(buildHeroMediaFilter(0, 50)).toBe('brightness(0.5)')
  })

  it('never produces brightness(0) from a null brightness value', () => {
    const result = buildHeroMediaFilter(null, null)
    expect(result ?? '').not.toContain('brightness(0)')
  })

  it('combines blur and brightness clauses when both are set', () => {
    expect(buildHeroMediaFilter(4, 150)).toBe('blur(4px) brightness(1.5)')
  })
})

describe('resolveHeroMediaLayout', () => {
  it('defaults to fullBleed when mediaLayout is null (GROQ unset-field shape)', () => {
    // Every hero created before this field existed has no `mediaLayout` in
    // storage — GROQ resolves that to `null`, not `undefined`. Falling back
    // to fullBleed here is what makes the field a no-op for existing heroes.
    expect(resolveHeroMediaLayout(null)).toBe('fullBleed')
  })

  it('defaults to fullBleed when mediaLayout is undefined', () => {
    expect(resolveHeroMediaLayout(undefined)).toBe('fullBleed')
  })

  it('passes through an explicit fullBleed value', () => {
    expect(resolveHeroMediaLayout('fullBleed')).toBe('fullBleed')
  })

  it('passes through an explicit boxed value', () => {
    expect(resolveHeroMediaLayout('boxed')).toBe('boxed')
  })
})

describe('resolveHeroCtaColors', () => {
  it('keeps the white-on-media button when ctaStyle is null (GROQ unset-field shape)', () => {
    // Every hero authored before this field exists has no `ctaStyle` in
    // storage — GROQ resolves that to `null`, not `undefined`. These are the
    // exact literals the component hardcoded before the field existed, so
    // Livener / Studio Martegani render unchanged.
    expect(resolveHeroCtaColors(null, true)).toEqual({ ctaBg: '#ffffff', ctaText: '#000000' })
  })

  it('keeps the white-on-media button when ctaStyle is undefined', () => {
    expect(resolveHeroCtaColors(undefined, true)).toEqual({ ctaBg: '#ffffff', ctaText: '#000000' })
  })

  it('keeps the white-on-media button for an explicit onMedia value', () => {
    expect(resolveHeroCtaColors('onMedia', true)).toEqual({ ctaBg: '#ffffff', ctaText: '#000000' })
  })

  it('uses the design-system button tokens for brand over full-bleed media', () => {
    expect(resolveHeroCtaColors('brand', true)).toEqual({
      ctaBg: 'var(--btn-primary-bg)',
      ctaText: 'var(--btn-primary-text)',
    })
  })

  it('uses the surface CTA colours without full-bleed media, whatever ctaStyle says', () => {
    const expected = { ctaBg: 'var(--color-primary)', ctaText: 'var(--color-background)' }
    expect(resolveHeroCtaColors(null, false)).toEqual(expected)
    expect(resolveHeroCtaColors(undefined, false)).toEqual(expected)
    expect(resolveHeroCtaColors('onMedia', false)).toEqual(expected)
    expect(resolveHeroCtaColors('brand', false)).toEqual(expected)
  })
})
