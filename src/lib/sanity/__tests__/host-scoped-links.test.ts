import { describe, it, expect } from 'vitest'
import { siteBasePath, withTenantPrefix, toPublicPath } from '../href'
import { prefixCtaHref, resolveCta } from '../cta'
import { resolveNavLinks } from '../nav-links'
import { isHostScopedSegment } from '@/lib/tenancy/link-scope'
import { languageSwitchPath } from '@/lib/i18n/language-switch'
import type { Cta, NavLink } from '../types'

// On a site's own host, internal links must be the canonical form (no project
// segment); on the platform's path-based surfaces the segment stays.

describe('isHostScopedSegment', () => {
  it('a custom domain serving the same project is host-scoped', () => {
    expect(isHostScopedSegment('abluo.app', 'abluo')).toBe(true)
    expect(isHostScopedSegment('www.abluo.app', 'abluo')).toBe(true)
    expect(isHostScopedSegment('abluo.localhost:3000', 'abluo')).toBe(true)
  })

  it('a project reached by path on another project host is not', () => {
    // dev.abluo.app resolves to abluo; /en/livener there is Livener by path.
    expect(isHostScopedSegment('dev.abluo.app', 'livener')).toBe(false)
  })

  it('platform and unknown hosts are not', () => {
    expect(isHostScopedSegment('preview.abluo.app', 'abluo')).toBe(false)
    expect(isHostScopedSegment('localhost:3000', 'abluo')).toBe(false)
    expect(isHostScopedSegment('example.com', 'abluo')).toBe(false)
    expect(isHostScopedSegment(null, 'abluo')).toBe(false)
    expect(isHostScopedSegment('abluo.app', '')).toBe(false)
  })
})

describe('siteBasePath / withTenantPrefix', () => {
  it('keeps the project segment on path-based surfaces (default)', () => {
    expect(siteBasePath('it', 'abluo')).toBe('/it/abluo')
    expect(withTenantPrefix('/news', 'it', 'abluo')).toBe('/it/abluo/news')
  })

  it('drops it on the site’s own host', () => {
    expect(siteBasePath('it', 'abluo', true)).toBe('/it')
    expect(withTenantPrefix('/news', 'it', 'abluo', true)).toBe('/it/news')
    expect(withTenantPrefix('pricing#tiers', 'en', 'abluo', true)).toBe('/en/pricing#tiers')
  })

  it('pass-through hrefs are untouched either way', () => {
    expect(withTenantPrefix('#faq', 'en', 'abluo', true)).toBe('#faq')
    expect(withTenantPrefix('mailto:a@b.c', 'en', 'abluo', true)).toBe('mailto:a@b.c')
  })
})

describe('toPublicPath', () => {
  it('strips exactly this tenant as the second segment when host-scoped', () => {
    expect(toPublicPath('/en/abluo', 'abluo', true)).toBe('/en')
    expect(toPublicPath('/en/abluo/', 'abluo', true)).toBe('/en')
    expect(toPublicPath('/en/abluo/news/x?y=1#z', 'abluo', true)).toBe('/en/news/x?y=1#z')
    expect(toPublicPath('/en/abluo#faq', 'abluo', true)).toBe('/en#faq')
  })

  it('leaves everything else alone', () => {
    expect(toPublicPath('/en/abluo/news', 'abluo', false)).toBe('/en/abluo/news')
    expect(toPublicPath('/en/abluoextra/news', 'abluo', true)).toBe('/en/abluoextra/news')
    expect(toPublicPath('/en/livener/news', 'abluo', true)).toBe('/en/livener/news')
    expect(toPublicPath('https://x.com/en/abluo', 'abluo', true)).toBe('https://x.com/en/abluo')
  })
})

describe('CTA and navigation links on the site’s own host', () => {
  it('news article CTA → /{locale}/news/{slug}', () => {
    const resolved = resolveCta({ label: 'Read', internalName: 'x', actionType: 'newsArticle', newsArticleSlug: 'release-1-0' } as Cta)
    expect(prefixCtaHref(resolved, 'it', 'abluo', true)).toMatchObject({ href: '/it/news/release-1-0' })
    expect(prefixCtaHref(resolved, 'it', 'abluo')).toMatchObject({ href: '/it/abluo/news/release-1-0' })
  })

  it('nav links (and their children) drop the segment', () => {
    const links = [
      { label: 'Home', linkType: 'internal', internalPage: 'homepage' },
      { label: 'About', linkType: 'internal', pageSlug: 'about', children: [{ label: 'Team', linkType: 'internal', pageSlug: 'team' }] },
      { label: 'Out', linkType: 'external', externalUrl: 'https://example.com/en/abluo' },
    ] as unknown as NavLink[]
    const scoped = resolveNavLinks(links, 'de', 'abluo', undefined, true)
    expect(scoped.map((l) => l.href)).toEqual(['/de', '/de/about', 'https://example.com/en/abluo'])
    expect(scoped[1].children?.[0].href).toBe('/de/team')
    const pathBased = resolveNavLinks(links, 'de', 'abluo')
    expect(pathBased.map((l) => l.href)).toEqual(['/de/abluo', '/de/abluo/about', 'https://example.com/en/abluo'])
  })
})

describe('languageSwitchPath', () => {
  const base = { tenantId: 'abluo', slugMap: {}, preservePath: true }

  it('uses the registered target for the other locale', () => {
    const slugMap = { de: 'news/fallstudie', en: 'news/case-study' }
    expect(languageSwitchPath({ ...base, slugMap, targetLocale: 'de', hostScoped: true, pathname: '/news/case-study' })).toBe('/news/fallstudie')
    expect(languageSwitchPath({ ...base, slugMap, targetLocale: 'de', hostScoped: false, pathname: '/abluo/news/case-study' })).toBe('/abluo/news/fallstudie')
  })

  it('keeps the sub-path on host-scoped and path-based URLs', () => {
    expect(languageSwitchPath({ ...base, targetLocale: 'it', hostScoped: true, pathname: '/news' })).toBe('/news')
    expect(languageSwitchPath({ ...base, targetLocale: 'it', hostScoped: true, pathname: '/' })).toBe('/')
    expect(languageSwitchPath({ ...base, targetLocale: 'it', hostScoped: false, pathname: '/abluo/news' })).toBe('/abluo/news')
    expect(languageSwitchPath({ ...base, targetLocale: 'it', hostScoped: false, pathname: '/abluo' })).toBe('/abluo')
  })

  it('without preservePath and no target, goes home', () => {
    expect(languageSwitchPath({ ...base, preservePath: false, targetLocale: 'it', hostScoped: true, pathname: '/news' })).toBe('/')
    expect(languageSwitchPath({ ...base, preservePath: false, targetLocale: 'it', hostScoped: false, pathname: '/abluo/news' })).toBe('/abluo')
  })
})

describe('index routes keep the visitor on the index when switching language', () => {
  it('the footer switcher (no path preservation) goes to /{other}/news, not home', async () => {
    const { indexRouteSlugMap } = await import('@/lib/i18n/language-switch')
    const slugMap = indexRouteSlugMap(['en', 'it', 'de'], 'news')
    expect(slugMap).toEqual({ en: 'news', it: 'news', de: 'news' })
    expect(languageSwitchPath({ targetLocale: 'de', slugMap, tenantId: 'abluo', hostScoped: true, pathname: '/news', preservePath: false })).toBe('/news')
    expect(languageSwitchPath({ targetLocale: 'de', slugMap, tenantId: 'abluo', hostScoped: false, pathname: '/abluo/news', preservePath: false })).toBe('/abluo/news')
  })
})
