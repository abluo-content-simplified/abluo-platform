/**
 * Sidebar preferences (ADR-042 N3, N4a, section 4): per-layout collapsed state,
 * per-group open state, first-use defaults, tolerant parsing, auto-open.
 */
import { describe, expect, it } from 'vitest'
import {
  APP_NAV_COOKIE,
  appNavCookie,
  effectiveGroupOpen,
  isNavGroupOpen,
  navModeFor,
  parseNavPreferences,
  serializeNavPreferences,
  withActiveGroupOpen,
  withNavGroupOpen,
  withNavMode,
} from '../app-nav-preferences'

describe('first-use defaults (N4a)', () => {
  it('desktop expanded, tablet rail, every group open', () => {
    const p = parseNavPreferences(undefined)
    expect(navModeFor(p, 'desktop')).toBe('expanded')
    expect(navModeFor(p, 'tablet')).toBe('rail')
    expect(isNavGroupOpen(p, 'content')).toBe(true)
  })
})

describe('per-layout persistence', () => {
  it('changing one layout never touches the other', () => {
    const p0 = parseNavPreferences(undefined)
    const p1 = withNavMode(p0, 'tablet', 'expanded')
    expect(navModeFor(p1, 'tablet')).toBe('expanded')
    expect(navModeFor(p1, 'desktop')).toBe('expanded')
    const p2 = withNavMode(p1, 'desktop', 'rail')
    expect(navModeFor(p2, 'desktop')).toBe('rail')
    expect(navModeFor(p2, 'tablet')).toBe('expanded')
  })

  it('round-trips through the cookie value; the person\'s choice wins over the default', () => {
    const saved = withNavGroupOpen(withNavMode(withNavMode(parseNavPreferences(undefined), 'desktop', 'rail'), 'tablet', 'expanded'), 'catalogue', false)
    const back = parseNavPreferences(serializeNavPreferences(saved))
    expect(back).toEqual(saved)
    expect(navModeFor(back, 'desktop')).toBe('rail')
    expect(navModeFor(back, 'tablet')).toBe('expanded')
    expect(isNavGroupOpen(back, 'catalogue')).toBe(false)
    expect(appNavCookie(saved).startsWith(`${APP_NAV_COOKIE}=`)).toBe(true)
  })

  it('ignores garbage, unknown modes and unknown or removed groups', () => {
    expect(parseNavPreferences('%7Bnot json')).toEqual({ groups: {} })
    expect(parseNavPreferences(encodeURIComponent(JSON.stringify({ d: 'sideways', t: 3, g: { content: false, gone: false, library: 'no' } })))).toEqual({ groups: { content: false } })
  })
})

describe('group open state (N3)', () => {
  it('remembers each group independently', () => {
    let p = parseNavPreferences(undefined)
    p = withNavGroupOpen(p, 'content', false)
    expect(isNavGroupOpen(p, 'content')).toBe(false)
    expect(isNavGroupOpen(p, 'catalogue')).toBe(true)
  })

  it('the group with the current destination opens automatically', () => {
    const closed = withNavGroupOpen(parseNavPreferences(undefined), 'catalogue', false)
    expect(effectiveGroupOpen(closed, 'catalogue', 'catalogue', false)).toBe(true)
    expect(effectiveGroupOpen(closed, 'catalogue', 'content', false)).toBe(false)
    expect(withActiveGroupOpen(closed, 'catalogue').groups.catalogue).toBe(true)
  })

  it('a group the person just closed stays closed until they navigate elsewhere', () => {
    const closed = withNavGroupOpen(parseNavPreferences(undefined), 'catalogue', false)
    expect(effectiveGroupOpen(closed, 'catalogue', 'catalogue', true)).toBe(false)
  })

  it('auto-open ignores no destination and unknown groups, and leaves open groups untouched', () => {
    const p = parseNavPreferences(undefined)
    expect(withActiveGroupOpen(p, null)).toBe(p)
    expect(withActiveGroupOpen(p, 'bottom')).toBe(p)
    expect(withActiveGroupOpen(p, 'content')).toBe(p)
  })
})
