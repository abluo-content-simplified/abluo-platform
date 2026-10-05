import { describe, it, expect } from 'vitest'
import { THEME_BOOT_SCRIPT, FORCED_THEME_ATTR } from '../theme-boot'

/** Runs the boot script against a tiny fake DOM. */
function boot(url: string, stored: string | null = null, prefersDark = true) {
  const classes = new Set<string>()
  const attrs: Record<string, string> = {}
  const writes: string[] = []
  const documentElement = {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    setAttribute: (k: string, v: string) => (attrs[k] = v),
  }
  const u = new URL(url, 'https://site.test')
  const run = new Function('document', 'location', 'localStorage', 'window', 'URLSearchParams', THEME_BOOT_SCRIPT)
  run(
    { documentElement },
    { pathname: u.pathname, search: u.search },
    { getItem: () => stored, setItem: (k: string) => writes.push(k) },
    { matchMedia: () => ({ matches: prefersDark }) },
    URLSearchParams
  )
  return { light: classes.has('light'), forced: attrs[FORCED_THEME_ATTR] ?? null, writes }
}

describe('theme boot script', () => {
  it('keeps the normal behaviour on every other page', () => {
    expect(boot('/it/hoffmann/blog/x', 'light')).toEqual({ light: true, forced: null, writes: [] })
    expect(boot('/it/hoffmann/blog/x', 'dark')).toEqual({ light: false, forced: null, writes: [] })
    expect(boot('/it/hoffmann', null, false).light).toBe(true)
    // ?theme= on a public page is ignored.
    expect(boot('/it/hoffmann/blog/x?theme=light', 'dark')).toEqual({ light: false, forced: null, writes: [] })
  })

  it('forces the theme on a draft preview without saving it', () => {
    expect(boot('/it/hoffmann/preview/post/abc?t=x&theme=light', 'dark')).toEqual({ light: true, forced: 'light', writes: [] })
    expect(boot('/it/preview/post/abc?theme=dark', 'light')).toEqual({ light: false, forced: 'dark', writes: [] })
  })

  it('falls back to the saved preference for an unknown forced value', () => {
    expect(boot('/it/hoffmann/preview/post/abc?theme=blue', 'light')).toEqual({ light: true, forced: null, writes: [] })
  })
})
