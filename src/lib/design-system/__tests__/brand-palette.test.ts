import { describe, it, expect } from 'vitest'
import { brandColourVar, brandPaletteCssVars, emittableBrandColours } from '../brand-palette'

describe('brand palette CSS variables (ADR-036 S2)', () => {
  it('emits one variable per valid colour, in order', () => {
    const css = brandPaletteCssVars({
      brandPalette: [
        { key: 'orange', value: 'oklch(0.7886 0.1630 66.32deg)' },
        { key: 'logo-red', value: '#FF3454' },
      ],
    }, '')
    expect(css).toBe('--color-brand-orange: oklch(0.7886 0.1630 66.32deg);\n--color-brand-logo-red: #FF3454;\n')
  })

  it('skips unsafe keys, unparseable or injected values and duplicates — never fixes them', () => {
    const kept = emittableBrandColours({
      brandPalette: [
        { key: 'Orange', value: '#FFA22B' },
        { key: 'ok', value: 'not a colour' },
        { key: 'evil', value: 'red; } body { display:none' },
        { key: 'navy', value: '#363366' },
        { key: 'navy', value: '#000000' },
      ],
    })
    expect(kept.map((c) => [c.key, c.value])).toEqual([['navy', '#363366']])
  })

  it('empty or missing palette emits nothing', () => {
    expect(brandPaletteCssVars(null)).toBe('')
    expect(brandPaletteCssVars({ brandPalette: [] })).toBe('')
    expect(brandColourVar('orange')).toBe('--color-brand-orange')
  })
})
