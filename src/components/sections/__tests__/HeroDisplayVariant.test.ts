import { describe, expect, it } from 'vitest'
import {
  resolveHeroVariant,
  displayLineDelay,
  DISPLAY_LINE_STEP,
  DISPLAY_LINE_CAP,
} from '../HeroSection'

describe('resolveHeroVariant', () => {
  it('recognises the display treatment', () => {
    expect(resolveHeroVariant('display')).toBe('display')
  })

  it('treats unset as standard — every hero authored before the field existed', () => {
    // GROQ returns null for an unset field. Both null and undefined must land
    // on the hero this component has always rendered, or adding the option
    // silently restyles every existing site.
    expect(resolveHeroVariant(null)).toBe('standard')
    expect(resolveHeroVariant(undefined)).toBe('standard')
    expect(resolveHeroVariant('standard')).toBe('standard')
  })

  it('falls back rather than trusting a value the schema no longer offers', () => {
    expect(resolveHeroVariant('displays')).toBe('standard')
    expect(resolveHeroVariant('DISPLAY')).toBe('standard')
    expect(resolveHeroVariant('')).toBe('standard')
  })
})

describe('displayLineDelay', () => {
  it('starts every line from the headline base delay', () => {
    // Line one arrives when the headline would have arrived as a block, so
    // turning the variant on does not delay the first thing you read.
    expect(displayLineDelay(0, 0.1)).toBe(0.1)
    expect(displayLineDelay(0, 0)).toBe(0)
  })

  it('steps each subsequent line by a fixed interval', () => {
    expect(displayLineDelay(1, 0.1)).toBeCloseTo(0.1 + DISPLAY_LINE_STEP, 5)
    expect(displayLineDelay(2, 0.1)).toBeCloseTo(0.1 + 2 * DISPLAY_LINE_STEP, 5)
  })

  it('steps faster than the gap between the eyebrow and the headline', () => {
    // The lines belong to each other. A step as long as the gap between two
    // different elements makes them read as separate thoughts rather than as
    // one name landing.
    expect(DISPLAY_LINE_STEP).toBeLessThan(0.2)
  })

  it('caps, so a pasted eight-line headline does not take seconds to arrive', () => {
    expect(displayLineDelay(20, 0)).toBe(DISPLAY_LINE_CAP)
    expect(displayLineDelay(50, 0)).toBe(DISPLAY_LINE_CAP)
  })

  it('reaches the cap only past a plausible headline length', () => {
    // Three lines is the shape this was built for; the cap must not bite there.
    expect(displayLineDelay(2, 0)).toBeLessThan(DISPLAY_LINE_CAP)
  })

  it('never goes backwards as the index grows', () => {
    let previous = -1
    for (let i = 0; i < 12; i++) {
      const delay = displayLineDelay(i, 0.1)
      expect(delay).toBeGreaterThanOrEqual(previous)
      previous = delay
    }
  })
})
