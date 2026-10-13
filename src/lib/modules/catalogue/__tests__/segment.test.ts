import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADR_RESERVED_SEGMENTS,
  CATALOGUE_RESERVED_SEGMENTS,
  applySegmentChange,
  dispatchCatalogue,
  pageSlugShadowsSegment,
  validateSegment,
} from '../segment'

describe('validateSegment', () => {
  it('accepts a lowercase url-safe single segment', () => {
    expect(validateSegment('menu')).toEqual({ ok: true, segment: 'menu', revert: false })
    expect(validateSegment('wine-list')).toMatchObject({ ok: true })
    expect(validateSegment('menu-2026')).toMatchObject({ ok: true })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['Menu', 'invalidSyntax'],
    ['a/b', 'invalidSyntax'],
    ['/menu', 'invalidSyntax'],
    ['caffè', 'invalidSyntax'],
    ['my menu', 'invalidSyntax'],
    ['-menu', 'invalidSyntax'],
    ['menu--x', 'invalidSyntax'],
  ])('rejects %j as %s', (value, kind) => {
    expect(validateSegment(value)).toEqual(expect.objectContaining({ ok: false, clash: expect.objectContaining({ kind }) }))
  })

  it('rejects an over-long segment', () => {
    expect(validateSegment('a'.repeat(65))).toMatchObject({ ok: false, clash: { kind: 'tooLong' } })
  })

  it.each(ADR_RESERVED_SEGMENTS)('refuses ADR D11 reserved word %s', (w) => {
    expect(validateSegment(w)).toEqual({ ok: false, clash: { kind: 'reserved', value: w } })
  })

  it('refuses the existing website route folders', () => {
    for (const w of ['blog', 'category', 'news', 'live', 'preview', 'events']) {
      expect(validateSegment(w)).toMatchObject({ ok: false, clash: { kind: 'reserved' } })
    }
  })

  it('names a page-slug first-segment clash', () => {
    expect(validateSegment('carta', { pageFirstSegments: ['about', 'carta'] })).toEqual({
      ok: false,
      clash: { kind: 'pageSlug', value: 'carta' },
    })
  })

  it('allows a historic value as a revert, flagged', () => {
    expect(validateSegment('menu', { history: ['menu'] })).toEqual({ ok: true, segment: 'menu', revert: true })
  })

  it('honours an injected reserved list', () => {
    expect(validateSegment('menu', { reserved: ['menu'] })).toMatchObject({ ok: false })
  })
})

describe('reserved list vs the website route tree', () => {
  it('reserves every static folder directly under (website)/[tenant]', () => {
    const dir = path.join(process.cwd(), 'src/app/[locale]/(website)/[tenant]')
    const folders = readdirSync(dir).filter(
      (n) => statSync(path.join(dir, n)).isDirectory() && !n.startsWith('[') && !n.startsWith('(') && n !== '__tests__',
    )
    expect(folders.length).toBeGreaterThan(0)
    const missing = folders.filter((f) => !CATALOGUE_RESERVED_SEGMENTS.includes(f))
    expect(missing, `add to RESERVED_SLUGS: ${missing.join(', ')}`).toEqual([])
  })
})

describe('applySegmentChange', () => {
  it('AC 15a: menu → carta → menu-2026 keeps both old segments; reverting to carta retires it', () => {
    const a = applySegmentChange('menu', [], 'carta')
    expect(a).toEqual({ segment: 'carta', history: ['menu'] })

    const b = applySegmentChange(a.segment, a.history, 'menu-2026')
    expect(b).toEqual({ segment: 'menu-2026', history: ['menu', 'carta'] })

    // both old segments redirect to the current one
    expect(dispatchCatalogue(['menu', 'pizza'], b.segment, b.history)).toEqual({ kind: 'redirect', to: ['menu-2026', 'pizza'] })
    expect(dispatchCatalogue(['carta', 'pizza'], b.segment, b.history)).toEqual({ kind: 'redirect', to: ['menu-2026', 'pizza'] })

    // a page slug may not take either
    expect(pageSlugShadowsSegment('menu', b)).toBe('menu')
    expect(pageSlugShadowsSegment('carta/x', b)).toBe('carta')
    expect(pageSlugShadowsSegment('about', b)).toBeNull()

    // revert to carta: removed from history, menu-2026 now redirects
    const c = applySegmentChange(b.segment, b.history, 'carta')
    expect(c).toEqual({ segment: 'carta', history: ['menu', 'menu-2026'] })
    expect(c.history).not.toContain('carta')
    expect(dispatchCatalogue(['carta', 'pizza'], c.segment, c.history)).toEqual({ kind: 'entry', slug: 'pizza' })
  })

  it('is append-only, deduped, and a no-op when unchanged', () => {
    expect(applySegmentChange('menu', ['old'], 'menu')).toEqual({ segment: 'menu', history: ['old'] })
    expect(applySegmentChange('b', ['a', 'a'], 'c')).toEqual({ segment: 'c', history: ['a', 'b'] })
  })

  it('does not mutate its inputs', () => {
    const h = ['a']
    applySegmentChange('b', h, 'c')
    expect(h).toEqual(['a'])
  })
})

describe('dispatchCatalogue (ADR-033 C2)', () => {
  const seg = 'menu'
  const hist = ['carta']

  it('[seg] → landing', () => expect(dispatchCatalogue(['menu'], seg, hist)).toEqual({ kind: 'landing' }))
  it('[seg, slug] → entry', () => expect(dispatchCatalogue(['menu', 'pizza'], seg, hist)).toEqual({ kind: 'entry', slug: 'pizza' }))
  it('[seg, a, b] → null (no such depth)', () => expect(dispatchCatalogue(['menu', 'a', 'b'], seg, hist)).toBeNull())
  it('[historic] → redirect to the segment root', () =>
    expect(dispatchCatalogue(['carta'], seg, hist)).toEqual({ kind: 'redirect', to: ['menu'] }))
  it('[historic, ...rest] → redirect preserving the rest', () =>
    expect(dispatchCatalogue(['carta', 'a', 'b'], seg, hist)).toEqual({ kind: 'redirect', to: ['menu', 'a', 'b'] }))
  it('anything else falls through', () => {
    expect(dispatchCatalogue(['about'], seg, hist)).toBeNull()
    expect(dispatchCatalogue([], seg, hist)).toBeNull()
  })
  it('module not installed / segment unset → nothing dispatches', () => {
    expect(dispatchCatalogue(['menu'], undefined, [])).toBeNull()
    expect(dispatchCatalogue(['menu'], '', ['menu'])).toBeNull()
  })
  it('compares case-insensitively', () => expect(dispatchCatalogue(['Menu'], seg, hist)).toEqual({ kind: 'landing' }))
})
