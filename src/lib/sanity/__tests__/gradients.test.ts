import { describe, it, expect } from 'vitest'
import { buildGradientCss, gradientCssVars, isSafeColor, hasPageGradient, pageGradientCssVars } from '../gradients'
import { getSurfaceStyles, computeSectionSurface } from '../surfaces'

describe('buildGradientCss', () => {
  it('returns null for unset or single-colour gradients', () => {
    expect(buildGradientCss(undefined)).toBeNull()
    expect(buildGradientCss({ colors: [] })).toBeNull()
    expect(buildGradientCss({ colors: ['#fff'] })).toBeNull()
  })

  it('builds a linear gradient with the angle (default 135deg)', () => {
    expect(buildGradientCss({ colors: ['#a', '#b'] })).toEqual({ base: '#a', image: 'linear-gradient(135deg, #a, #b)' })
    expect(buildGradientCss({ style: 'linear', angle: 450, colors: ['#a', '#b', '#c'] })?.image).toBe('linear-gradient(90deg, #a, #b, #c)')
  })

  it('builds a radial gradient from the top-left', () => {
    const css = buildGradientCss({ style: 'radial', colors: ['#a', '#b'] })
    expect(css?.image).toBe('radial-gradient(120% 120% at 0% 0%, #a, #b)')
    expect(css?.base).toBe('#b')
  })

  it('builds a mesh: first colour is the field, the rest are blobs', () => {
    const css = buildGradientCss({ style: 'mesh', colors: ['oklch(0.97 0 0)', '#b', '#c'] })
    expect(css?.base).toBe('oklch(0.97 0 0)')
    expect(css?.image.match(/radial-gradient/g)).toHaveLength(2)
    expect(css?.image).toContain('#b 0px, transparent 55%')
  })

  it('drops unsafe colour values that could break out of the CSS variable', () => {
    expect(isSafeColor('red; } body { display:none')).toBe(false)
    expect(isSafeColor('var(--color-primary)')).toBe(true)
    expect(buildGradientCss({ colors: ['#a', 'red;}'] })).toBeNull()
  })
})

describe('gradientCssVars', () => {
  it('emits both gradients, falling back to Surface 2 when unset', () => {
    const out = gradientCssVars({ lightTheme: { gradient1: { colors: ['#a', '#b'] } } }, 'lightTheme', '')
    expect(out).toContain('--section-gradient-1-base: #a;')
    expect(out).toContain('--section-gradient-1: linear-gradient(135deg, #a, #b);')
    expect(out).toContain('--section-gradient-2-base: var(--color-section-surface2);')
    expect(out).toContain('--section-gradient-2: none;')
  })
})

describe('gradient surfaces in the surface system', () => {
  it('an explicit gradient background wins over the page pattern', () => {
    expect(computeSectionSurface('gradient1', 'alternate1-2', 1)).toBe('gradient1')
  })

  it('getSurfaceStyles uses longhands pointing at the gradient vars', () => {
    expect(getSurfaceStyles(null, 'gradient2')).toEqual({
      backgroundColor: 'var(--section-gradient-2-base)',
      backgroundImage: 'var(--section-gradient-2)',
    })
  })
})

describe('page background gradient', () => {
  const ds = (light?: object, dark?: object) => ({ sectionSurfaces: { lightTheme: { pageGradient: light }, darkTheme: { pageGradient: dark } } }) as any

  it('hasPageGradient is true only with a usable gradient in either theme', () => {
    expect(hasPageGradient(null)).toBe(false)
    expect(hasPageGradient(ds({ colors: ['#a'] }))).toBe(false)
    expect(hasPageGradient(ds(undefined, { colors: ['#a', '#b'] }))).toBe(true)
  })

  it('page mesh spreads blobs from top to bottom on alternating sides', () => {
    const css = buildGradientCss({ style: 'mesh', colors: ['#f', '#a', '#b', '#c'] }, 'page')
    expect(css?.base).toBe('#f')
    expect(css?.image).toContain('at 10% 0%, #a')
    expect(css?.image).toContain('at 90% 50%, #b')
    expect(css?.image).toContain('at 10% 100%, #c')
  })

  it('pageGradientCssVars falls back to the page background colour', () => {
    expect(pageGradientCssVars(null, 'lightTheme', '')).toBe('--page-gradient-base: var(--color-background);\n--page-gradient: none;')
  })

  it("sections default to transparent under a page gradient, explicit choices win", () => {
    expect(computeSectionSurface(undefined, 'none', 0, 'transparent')).toBe('transparent')
    expect(computeSectionSurface('usePagePattern', undefined, 3, 'transparent')).toBe('transparent')
    expect(computeSectionSurface('surface2', 'none', 0, 'transparent')).toBe('surface2')
    expect(computeSectionSurface(undefined, 'alternate1-2', 1, 'transparent')).toBe('surface2')
    expect(computeSectionSurface(undefined, 'none', 0)).toBe('surface1')
  })
})
