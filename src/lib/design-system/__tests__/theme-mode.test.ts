import { describe, it, expect } from 'vitest'
import { lightThemeSelector } from '@/lib/design-system/theme-mode'

// The bug this locks out: `themeMode` used to gate ONLY the ThemeSwitcher, so a
// "Light Only" site still followed the visitor's OS preference — dark palette on
// a dark-mode machine, and no switcher left to escape with.

describe('lightThemeSelector', () => {
  it('leaves toggle sites exactly as they were — the class decides', () => {
    expect(lightThemeSelector('toggle')).toBe('html.light')
  })

  it('treats system the same as toggle: the boot script still chooses', () => {
    expect(lightThemeSelector('system')).toBe('html.light')
  })

  it('defaults to the toggle selector when themeMode is absent', () => {
    expect(lightThemeSelector()).toBe('html.light')
    expect(lightThemeSelector(undefined)).toBe('html.light')
  })

  it('lightOnly puts light on :root too, so it wins WITHOUT the class', () => {
    expect(lightThemeSelector('lightOnly')).toBe(':root, html.light')
  })

  it('lightOnly still covers html.light, so the class cannot un-light the site', () => {
    expect(lightThemeSelector('lightOnly')).toContain('html.light')
  })

  it('darkOnly emits NO light block — :root dark survives a stray .light class', () => {
    expect(lightThemeSelector('darkOnly')).toBeNull()
  })

  it('never returns a bare :root — that would beat the dark block for everyone', () => {
    for (const mode of ['toggle', 'system', 'lightOnly', 'darkOnly'] as const) {
      expect(lightThemeSelector(mode)).not.toBe(':root')
    }
  })
})
