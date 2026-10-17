/**
 * The pure halves of Button, IconButton, TextInput and SegmentedControl
 * (component audit D1/D2/D5). The class strings are the contract the screens
 * migrated onto, so a change here is a visible change everywhere.
 */
import { describe, expect, it } from 'vitest'
import { buttonClass, iconButtonClass } from '../button-styles'
import { inputClass, textAreaClass } from '../field-styles'
import { nextSegmentIndex } from '../segmented-keys'

describe('buttonClass', () => {
  it('defaults to a 44px secondary button', () => {
    const c = buttonClass()
    expect(c).toContain('h-11')
    expect(c).toContain('border-border')
    expect(c).not.toContain('bg-action')
  })
  it('primary uses the action colour; one disabled style for all variants', () => {
    expect(buttonClass({ variant: 'primary' })).toContain('bg-action')
    for (const variant of ['primary', 'secondary', 'quiet', 'destructive'] as const) {
      expect(buttonClass({ variant })).toContain('disabled:opacity-40')
    }
  })
  it('lg is 48px; fullWidth spans; className is appended', () => {
    const c = buttonClass({ size: 'lg', fullWidth: true, className: 'mt-4' })
    expect(c).toContain('h-12')
    expect(c).toContain('w-full')
    expect(c.endsWith('mt-4')).toBe(true)
  })
})

describe('iconButtonClass', () => {
  it('is a 44px square with a fainter disabled state', () => {
    expect(iconButtonClass()).toContain('size-11')
    expect(iconButtonClass()).toContain('disabled:opacity-30')
    expect(iconButtonClass('cursor-grab')).toMatch(/ cursor-grab$/)
  })
})

describe('field classes', () => {
  it('input: lg 48px under a label by default, md 44px flush for inline rows', () => {
    expect(inputClass()).toMatch(/\bmt-1\.5\b.*\bh-12\b/)
    const inline = inputClass({ controlSize: 'md', flush: true })
    expect(inline).toContain('h-11')
    expect(inline).not.toContain('mt-1.5')
  })
  it('textarea keeps the minimum height', () => {
    expect(textAreaClass()).toContain('min-h-28')
  })
})

describe('nextSegmentIndex (radiogroup keys)', () => {
  const none = [false, false, false]
  it('arrows move and wrap', () => {
    expect(nextSegmentIndex('ArrowRight', 0, none)).toBe(1)
    expect(nextSegmentIndex('ArrowRight', 2, none)).toBe(0)
    expect(nextSegmentIndex('ArrowLeft', 0, none)).toBe(2)
  })
  it('skips disabled options', () => {
    expect(nextSegmentIndex('ArrowRight', 0, [false, true, false])).toBe(2)
  })
  it('Home/End jump; other keys do nothing', () => {
    expect(nextSegmentIndex('End', 0, none)).toBe(2)
    expect(nextSegmentIndex('Home', 2, none)).toBe(0)
    expect(nextSegmentIndex('a', 1, none)).toBeNull()
  })
})
