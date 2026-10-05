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

describe('app text size', () => {
  it('parses, defaults and builds the attribute/cookie', async () => {
    const m = await import('../app-theme')
    expect(m.parseAppTextSize('xl')).toBe('xl')
    expect(m.parseAppTextSize('huge')).toBe('md')
    expect(m.parseAppTextSize(undefined)).toBe('md')
    expect(m.appTextSizeAttribute('md')).toBeUndefined()
    expect(m.appTextSizeAttribute('lg')).toBe('lg')
    expect(m.appTextSizeCookie('sm')).toMatch(/^abluo-app-text=sm; path=\/; max-age=\d+; SameSite=Lax$/)
  })
})
