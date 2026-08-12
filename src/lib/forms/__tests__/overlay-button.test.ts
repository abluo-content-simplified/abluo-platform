/**
 * Form overlay button — ADR-018 slice 7b. Pure class-mapping helpers.
 */
import { describe, it, expect } from 'vitest'
import { overlayButtonAlignClass, overlayButtonClass, overlayButtonWidthClass } from '../overlay-button'

describe('overlayButtonAlignClass', () => {
  it('maps left/right/center', () => {
    expect(overlayButtonAlignClass('left')).toBe('justify-start')
    expect(overlayButtonAlignClass('right')).toBe('justify-end')
    expect(overlayButtonAlignClass('center')).toBe('justify-center')
  })
  it('defaults to centered for null/undefined', () => {
    expect(overlayButtonAlignClass(null)).toBe('justify-center')
    expect(overlayButtonAlignClass(undefined)).toBe('justify-center')
  })
})

describe('overlayButtonWidthClass', () => {
  it('is w-full when true, empty otherwise', () => {
    expect(overlayButtonWidthClass(true)).toBe('w-full')
    expect(overlayButtonWidthClass(false)).toBe('')
    expect(overlayButtonWidthClass(undefined)).toBe('')
  })
})

describe('overlayButtonClass', () => {
  it('primary is the filled default (null/undefined included)', () => {
    expect(overlayButtonClass('primary')).toContain('bg-[var(--color-primary)]')
    expect(overlayButtonClass(undefined)).toContain('bg-[var(--color-primary)]')
    expect(overlayButtonClass(null)).toContain('bg-[var(--color-primary)]')
  })
  it('secondary is bordered + transparent', () => {
    const c = overlayButtonClass('secondary')
    expect(c).toContain('bg-transparent')
    expect(c).toContain('border')
    expect(c).not.toContain('bg-[var(--color-primary)]')
  })
})
