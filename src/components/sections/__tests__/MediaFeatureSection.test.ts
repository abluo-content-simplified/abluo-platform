import { describe, expect, it } from 'vitest'
import {
  featureGridColsClass,
  hasMediaColumn,
  resolveMediaStyle,
} from '../MediaFeatureSection'

describe('featureGridColsClass', () => {
  // The two designs this section replaces (ProductShowcase, Qualification) both
  // hardcoded a desktop grid with no breakpoint, so they never collapsed on
  // mobile. Every class this helper can return must therefore be md:-prefixed.
  it('only ever emits md:-prefixed column classes', () => {
    const all = [
      featureGridColsClass(undefined, false),
      featureGridColsClass('50/50', false),
      featureGridColsClass('40/60', true),
      featureGridColsClass('40/60', false),
      featureGridColsClass('60/40', true),
      featureGridColsClass('60/40', false),
    ]
    for (const cls of all) {
      expect(cls.startsWith('md:')).toBe(true)
    }
  })

  it('defaults to an even split when contentRatio is unset (GROQ returns null)', () => {
    expect(featureGridColsClass(undefined, false)).toBe('md:grid-cols-2')
    // GROQ hands back null, not undefined, for a field the editor never touched
    expect(featureGridColsClass(null as unknown as undefined, true)).toBe('md:grid-cols-2')
  })

  it('treats 50/50 as the even split', () => {
    expect(featureGridColsClass('50/50', true)).toBe('md:grid-cols-2')
  })

  it('gives the media column the larger fraction for 40/60', () => {
    // contentRatio is content-first: 40 % content, 60 % media
    expect(featureGridColsClass('40/60', false)).toBe('md:grid-cols-[2fr_3fr]')
    expect(featureGridColsClass('40/60', true)).toBe('md:grid-cols-[3fr_2fr]')
  })

  it('gives the content column the larger fraction for 60/40', () => {
    expect(featureGridColsClass('60/40', false)).toBe('md:grid-cols-[3fr_2fr]')
    expect(featureGridColsClass('60/40', true)).toBe('md:grid-cols-[2fr_3fr]')
  })

  it('mirrors the fractions when the media moves to the left', () => {
    expect(featureGridColsClass('40/60', true)).not.toBe(featureGridColsClass('40/60', false))
    expect(featureGridColsClass('60/40', true)).not.toBe(featureGridColsClass('60/40', false))
  })
})

describe('hasMediaColumn', () => {
  it('is false when mediaPosition is none, even with an image set', () => {
    expect(hasMediaColumn('none', 'https://cdn.example/img.jpg')).toBe(false)
  })

  it('is false when no image resolved, even with a side chosen', () => {
    expect(hasMediaColumn('left', undefined)).toBe(false)
    expect(hasMediaColumn('right', undefined)).toBe(false)
  })

  it('is true for left or right with a resolved image', () => {
    expect(hasMediaColumn('left', 'https://cdn.example/img.jpg')).toBe(true)
    expect(hasMediaColumn('right', 'https://cdn.example/img.jpg')).toBe(true)
  })

  it('falls through to the media layout when mediaPosition is unset but an image exists', () => {
    // The component defaults mediaPosition to 'left'; an undefined value here
    // must not be mistaken for 'none'.
    expect(hasMediaColumn(undefined, 'https://cdn.example/img.jpg')).toBe(true)
  })
})

describe('resolveMediaStyle', () => {
  it('falls back to the default style when the key is unset', () => {
    expect(resolveMediaStyle(undefined, undefined).key).toBe('default')
  })

  it('falls back to the default style for a key the DS does not define', () => {
    expect(resolveMediaStyle('doesNotExist', undefined).key).toBe('default')
  })

  it('resolves a built-in key from the fallback table when the DS has no mediaStyles', () => {
    expect(resolveMediaStyle('landscape', undefined).aspectRatio).toBe('16/9')
    expect(resolveMediaStyle('circle', []).borderRadius).toBe(9999)
  })

  it('lets the Design System override what a named style means', () => {
    const ds = [{ key: 'rounded', borderRadius: 4, aspectRatio: '1/1' as const }]
    expect(resolveMediaStyle('rounded', ds).borderRadius).toBe(4)
  })

  it('falls back to the platform default when the DS defines styles but not this key', () => {
    const ds = [{ key: 'rounded', borderRadius: 4 }]
    expect(resolveMediaStyle('portrait', ds).key).toBe('default')
  })
})
