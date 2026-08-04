import { describe, expect, it } from 'vitest'
import { buildHeroMediaFilter } from '../HeroSection'

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
