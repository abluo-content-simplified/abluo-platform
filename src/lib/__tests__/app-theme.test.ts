import { describe, expect, it } from 'vitest'
import { appThemeAttribute, appThemeCookie, parseAppTheme } from '../app-theme'

describe('app theme preference (ADR-025 D7)', () => {
  it('keeps an explicit light or dark choice', () => {
    expect(parseAppTheme('light')).toBe('light')
    expect(parseAppTheme('dark')).toBe('dark')
  })

  it('falls back to following the device for anything else', () => {
    for (const v of [undefined, null, '', 'system', 'DARK', 'blue', 'dark; injected']) {
      expect(parseAppTheme(v)).toBe('system')
    }
  })

  it('sets data-theme only for an explicit choice', () => {
    expect(appThemeAttribute('system')).toBeUndefined()
    expect(appThemeAttribute('dark')).toBe('dark')
  })

  it('writes its own cookie, never the website theme key', () => {
    const c = appThemeCookie('dark')
    expect(c.startsWith('abluo-app-theme=dark;')).toBe(true)
    expect(c).not.toContain('abluo-theme=')
  })
})
