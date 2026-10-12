import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBrowseTarget, routeSegmentAfterBase } from '../unavailable'

const ALL = ['blog', 'events', 'news', 'forms']

describe('routeSegmentAfterBase', () => {
  it('reads path-scoped and host-scoped URLs alike', () => {
    expect(routeSegmentAfterBase('/en/acme/blog/some-post', 'en', 'acme')).toBe('blog')
    expect(routeSegmentAfterBase('/en/blog/some-post', 'en', 'acme')).toBe('blog')
    expect(routeSegmentAfterBase('/it/acme/events/x?y=1#z', 'it', 'acme')).toBe('events')
  })
  it('returns null at the site root', () => {
    expect(routeSegmentAfterBase('/en/acme', 'en', 'acme')).toBeNull()
    expect(routeSegmentAfterBase('/en', 'en', 'acme')).toBeNull()
    expect(routeSegmentAfterBase(null, 'en', 'acme')).toBeNull()
  })
})

describe('resolveBrowseTarget (ADR-032 D12)', () => {
  it('maps typed routes to their listing', () => {
    expect(resolveBrowseTarget('/en/acme/blog/x', 'en', 'acme', ALL)).toBe('blog')
    expect(resolveBrowseTarget('/en/acme/category/x', 'en', 'acme', ALL)).toBe('blog')
    expect(resolveBrowseTarget('/en/events/x', 'en', 'acme', ALL)).toBe('events')
    expect(resolveBrowseTarget('/de/acme/news/x', 'de', 'acme', ALL)).toBe('news')
  })
  it('offers nothing for pages, the catch-all and unknown routes', () => {
    expect(resolveBrowseTarget('/en/acme/about-us', 'en', 'acme', ALL)).toBeNull()
    expect(resolveBrowseTarget('/en/acme/a/b/c', 'en', 'acme', ALL)).toBeNull()
    expect(resolveBrowseTarget('/en/acme', 'en', 'acme', ALL)).toBeNull()
  })
  it('offers nothing when the owning module is disabled or config is unknown', () => {
    expect(resolveBrowseTarget('/en/acme/blog/x', 'en', 'acme', ['events'])).toBeNull()
    expect(resolveBrowseTarget('/en/acme/events/x', 'en', 'acme', [])).toBeNull()
    expect(resolveBrowseTarget('/en/acme/news/x', 'en', 'acme', null)).toBeNull()
  })
  it('depends only on the route segment, never on the item slug', () => {
    const a = resolveBrowseTarget('/en/acme/blog/a-live-post', 'en', 'acme', ALL)
    const b = resolveBrowseTarget('/en/acme/blog/an-archived-post', 'en', 'acme', ALL)
    const c = resolveBrowseTarget('/en/acme/blog/never-existed', 'en', 'acme', ALL)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })
})

describe('unavailable page cannot expose item data', () => {
  const ROOT = resolve(__dirname, '../../../..')
  const FILES = [
    'src/components/site/UnavailablePage.tsx',
    'src/app/[locale]/(website)/[tenant]/not-found.tsx',
    'src/lib/lifecycle/unavailable.ts',
  ]
  for (const f of FILES) {
    it(`${f} imports no Sanity client/query and does not fetch`, () => {
      const src = readFileSync(resolve(ROOT, f), 'utf8')
      expect(src).not.toMatch(/from ['"]@\/lib\/sanity\/(client|queries)['"]/)
      expect(src).not.toMatch(/from ['"](next-sanity|@sanity\/client)['"]/)
      expect(src).not.toMatch(/\bfetch(ForTenant)?\s*\(/)
    })
  }
})
