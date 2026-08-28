import { describe, expect, it } from 'vitest'
import { resolveFeatureGridColumns, resolveFeatureGridVariant } from '../FeatureGridSection'

describe('resolveFeatureGridVariant', () => {
  it('defaults to icon when variant is null (GROQ unset-field shape)', () => {
    // Every feature grid saved before this field existed has no `variant` in
    // storage — GROQ resolves that to `null`, not `undefined`. Falling back to
    // 'icon' here is what makes the field a no-op for existing content.
    expect(resolveFeatureGridVariant(null)).toBe('icon')
  })

  it('defaults to icon when variant is undefined', () => {
    expect(resolveFeatureGridVariant(undefined)).toBe('icon')
  })

  it('passes through an explicit number variant', () => {
    expect(resolveFeatureGridVariant('number')).toBe('number')
  })

  it('passes through an explicit none variant', () => {
    expect(resolveFeatureGridVariant('none')).toBe('none')
  })

  it('falls back to icon for an unknown variant value', () => {
    expect(resolveFeatureGridVariant('watermark')).toBe('icon')
  })
})

describe('resolveFeatureGridColumns', () => {
  it('uses an auto-fit track when columns is auto', () => {
    const { className, style } = resolveFeatureGridColumns('auto')
    expect(className).toBe('')
    expect(style?.gridTemplateColumns).toBe('repeat(auto-fit, minmax(280px, 1fr))')
  })

  it('falls back to the auto-fit track when columns is null (GROQ unset-field shape)', () => {
    expect(resolveFeatureGridColumns(null).style?.gridTemplateColumns).toBe(
      'repeat(auto-fit, minmax(280px, 1fr))',
    )
  })

  it('never emits an inline track for a fixed column count', () => {
    for (const columns of ['2', '3', '4']) {
      expect(resolveFeatureGridColumns(columns).style).toBeUndefined()
    }
  })

  it('stacks to a single column on mobile for every fixed count', () => {
    for (const columns of ['2', '3', '4']) {
      expect(resolveFeatureGridColumns(columns).className).toContain('grid-cols-1')
    }
  })

  it('builds responsive classes for a fixed column count', () => {
    expect(resolveFeatureGridColumns('3').className).toBe(
      'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    )
  })
})
