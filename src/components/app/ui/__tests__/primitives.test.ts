/**
 * The pure halves of Button, IconButton, TextInput and SegmentedControl
 * (component audit D1/D2/D5). The class strings are the contract the screens
 * migrated onto, so a change here is a visible change everywhere.
 */
import { describe, expect, it } from 'vitest'
import { buttonClass, iconButtonClass } from '../button-styles'
import { inputClass, textAreaClass } from '../field-styles'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nextSegmentIndex } from '../segmented-keys'
import { TAB_LIST_CLASS, tabClass, tabIds } from '../tab-styles'
import { dropEdgeClass, dropIndex } from '../use-pointer-drag'

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
  it('textarea keeps the minimum height unless the caller sizes it with rows', () => {
    expect(textAreaClass()).toContain('min-h-28')
    expect(textAreaClass({ sized: true })).not.toContain('min-h-28')
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

describe('Tabs', () => {
  it('the row scrolls sideways and never wraps; a tab is a 44px tap target that does not shrink', () => {
    expect(TAB_LIST_CLASS).toContain('overflow-x-auto')
    expect(TAB_LIST_CLASS).not.toContain('flex-wrap')
    expect(tabClass(false)).toContain('min-h-11')
    expect(tabClass(false)).toContain('shrink-0')
    expect(tabClass(false)).toContain('whitespace-nowrap')
  })
  it('the selected tab is marked with the action colour, the others are quiet', () => {
    expect(tabClass(true)).toContain('border-action')
    expect(tabClass(false)).toContain('border-transparent')
    expect(tabClass(false)).not.toContain('border-action')
  })
  it('ties a tab to its panel by id', () => {
    expect(tabIds('x', 'tag')).toEqual({ tab: 'x-tab-tag', panel: 'x-panel-tag' })
  })
  it('uses WAI-ARIA tablist semantics with roving tabindex and the shared arrow-key model', () => {
    const src = readFileSync(path.join(__dirname, '../Tabs.tsx'), 'utf8')
    expect(src).toContain('role="tablist"')
    expect(src).toContain('role="tab"')
    expect(src).toContain('aria-selected')
    expect(src).toContain('tabIndex={i === stop ? 0 : -1}')
    expect(src).toContain('nextSegmentIndex')
  })
})

describe('dropIndex (drag to reorder)', () => {
  const keys = ['a', 'b', 'c', 'd']
  it('drops before or after the row it lands on', () => {
    expect(dropIndex(keys, 'a', { key: 'c', after: false })).toBe(1)
    expect(dropIndex(keys, 'a', { key: 'c', after: true })).toBe(2)
    expect(dropIndex(keys, 'd', { key: 'a', after: false })).toBe(0)
    expect(dropIndex(keys, 'd', { key: 'a', after: true })).toBe(1)
  })
  it('is null when nothing would change or a key is unknown', () => {
    expect(dropIndex(keys, 'b', { key: 'a', after: true })).toBeNull()
    expect(dropIndex(keys, 'b', { key: 'c', after: false })).toBeNull()
    expect(dropIndex(keys, 'x', { key: 'a', after: true })).toBeNull()
    expect(dropIndex(keys, 'a', { key: 'x', after: true })).toBeNull()
  })
  it('table rows show the drop edge as an inset rule', () => {
    expect(dropEdgeClass(null)).toBe('')
    expect(dropEdgeClass('before')).toContain('inset_0_2px')
    expect(dropEdgeClass('after')).toContain('inset_0_-2px')
  })
})

describe('DragGrip', () => {
  const src = readFileSync(path.join(__dirname, '../DragGrip.tsx'), 'utf8')
  it('is a button that spreads the pointer-drag props and reorders with ArrowUp / ArrowDown', () => {
    expect(src).toContain('<button')
    expect(src).toContain('{...drag}')
    expect(src).toContain("'ArrowUp'")
    expect(src).toContain("'ArrowDown'")
  })
  it('announces the new position and keeps focus on the grip', () => {
    expect(src).toContain('aria-live="polite"')
    expect(src).toContain('refocus')
  })
})
