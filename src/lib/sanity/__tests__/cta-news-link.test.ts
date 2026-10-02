import { describe, it, expect } from 'vitest'
import { resolveCta, prefixCtaHref, ctaInternalPath, NEWS_ROUTE_SEGMENT } from '../cta'
import { resolveNavLink } from '../nav-links'
import { CTA_FIELDS } from '../queries'
import { resolveHeaderCtaConfig } from '@/lib/modules/config'
import type { Cta, NavLink, WebsiteSiteConfig } from '../types'
import { schemaTypes } from '../schema'

// The CTA link model gained two internal destinations — a news article (by
// reference, resolved per locale through its localizedSlug) and the news
// index. Additive: every CTA shape stored before them must resolve exactly as
// it did, because production data is not migrated.

const base = { label: 'Read', internalName: 'Test CTA' }

describe('resolveCta — news destinations', () => {
  it('links a news article to news/{slug}, prefixed per locale and tenant', () => {
    const r = resolveCta({ ...base, actionType: 'newsArticle', newsArticleSlug: 'release-1-0' })
    expect(r).toEqual({ type: 'link', ...base, href: '/news/release-1-0', external: false })
    expect(prefixCtaHref(r, 'it', 'abluo')).toMatchObject({ href: '/it/abluo/news/release-1-0' })
  })

  it('links the news index to /news', () => {
    const r = resolveCta({ ...base, actionType: 'newsIndex' })
    expect(r).toEqual({ type: 'link', ...base, href: '/news', external: false })
    expect(prefixCtaHref(r, 'de', 'abluo')).toMatchObject({ href: '/de/abluo/news' })
  })

  it('renders nothing for an article whose slug does not resolve (missing, unscoped or unpublished ref)', () => {
    expect(resolveCta({ ...base, actionType: 'newsArticle' })).toEqual({ type: 'none', ...base })
  })

  it('uses the platform route segment', () => {
    expect(NEWS_ROUTE_SEGMENT).toBe('news')
    expect(ctaInternalPath({ ...base, actionType: 'newsArticle', newsArticleSlug: 'x' })).toBe('news/x')
    expect(ctaInternalPath({ ...base, actionType: 'newsIndex' })).toBe('news')
    expect(ctaInternalPath({ ...base, actionType: 'page', pageSlug: 'about' })).toBe('about')
    expect(ctaInternalPath({ ...base, actionType: 'externalUrl', externalUrl: 'https://x' })).toBeUndefined()
    expect(ctaInternalPath(null)).toBeUndefined()
  })
})

describe('resolveCta — legacy shapes are unchanged', () => {
  const cases: [string, Cta, unknown][] = [
    ['page', { ...base, actionType: 'page', pageSlug: 'about' }, { type: 'link', ...base, href: '/about', external: false }],
    ['page with leading slash', { ...base, actionType: 'page', pageSlug: '/about' }, { type: 'link', ...base, href: '/about', external: false }],
    ['page anchor', { ...base, actionType: 'page', pageSlug: '#faq' }, { type: 'link', ...base, href: '#faq', external: false }],
    ['page without slug', { ...base, actionType: 'page' }, { type: 'none', ...base }],
    ['external, default new tab', { ...base, actionType: 'externalUrl', externalUrl: 'https://x.y' }, { type: 'link', ...base, href: 'https://x.y', external: true }],
    ['external relative, same tab', { ...base, actionType: 'externalUrl', externalUrl: 'news/a', openInNewTab: false }, { type: 'link', ...base, href: 'news/a', external: false }],
    ['form', { ...base, actionType: 'form', formId: 'early-access' }, { type: 'form', ...base, formId: 'early-access' }],
    ['download', { ...base, actionType: 'fileDownload', fileUrl: 'https://cdn/x.pdf', fileName: 'x.pdf' }, { type: 'download', ...base, href: 'https://cdn/x.pdf', fileName: 'x.pdf' }],
    ['no actionType', { ...base }, { type: 'none', ...base }],
    // A stored page CTA that happens to carry a stray newsArticleSlug still resolves as a page.
    ['page ignores news fields', { ...base, actionType: 'page', pageSlug: 'about', newsArticleSlug: 'x' }, { type: 'link', ...base, href: '/about', external: false }],
  ]
  it.each(cases)('%s', (_name, cta, expected) => {
    expect(resolveCta(cta)).toEqual(expected)
  })
})

describe('CTA_FIELDS projects the news article slug, project-scoped and per locale', () => {
  it('reads the referenced article through a $projectSlug-filtered subquery', () => {
    expect(CTA_FIELDS).toMatch(/"newsArticleSlug":/)
    const lookups = CTA_FIELDS.match(/\*\[_type == "newsArticle"[^\]]*\]/g) ?? []
    expect(lookups).toHaveLength(2)
    for (const l of lookups) {
      expect(l).toBe('*[_type == "newsArticle" && ^.newsArticleRef._ref == _id && projectSlug == $projectSlug]')
    }
    expect(CTA_FIELDS).not.toMatch(/newsArticleRef->/)
  })

  it('falls back from the request locale to the default locale, like pageSlug', () => {
    expect(CTA_FIELDS).toMatch(/\]\[0\]\.slug\[\$locale\]\.current,/)
    expect(CTA_FIELDS).toMatch(/\]\[0\]\.slug\[\$defaultLocale\]\.current/)
  })

  it('keeps every legacy projection', () => {
    for (const f of ['actionType', '"pageSlug"', '"formId"', '"fileUrl"', 'externalUrl', 'openInNewTab', '"context"']) {
      expect(CTA_FIELDS).toContain(f)
    }
  })
})

describe('cta schema — additive options', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cta = (schemaTypes as any[]).find((t) => t.name === 'cta')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const field = (name: string) => cta.fields.find((f: any) => f.name === name)

  it('offers the news destinations alongside the existing four', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values = field('actionType').options.list.map((o: any) => o.value)
    expect(values).toEqual(expect.arrayContaining(['page', 'form', 'fileDownload', 'externalUrl', 'newsArticle', 'newsIndex']))
  })

  it('references newsArticle, shown only for the newsArticle action', () => {
    const ref = field('newsArticleRef')
    expect(ref.type).toBe('reference')
    expect(ref.to).toEqual([{ type: 'newsArticle' }])
    expect(ref.hidden({ parent: { actionType: 'newsArticle' } })).toBe(false)
    expect(ref.hidden({ parent: { actionType: 'page' } })).toBe(true)
  })

  it('limits the picker to this project', () => {
    const ref = field('newsArticleRef')
    expect(ref.options.filter({ document: { projectSlug: 'abluo' } })).toEqual({
      filter: 'projectSlug == $projectSlug && defined(slug)',
      params: { projectSlug: 'abluo' },
    })
  })
})

describe('header button resolves news destinations like page ones', () => {
  const site = (headerCta: Record<string, unknown>) => ({ headerCta }) as unknown as WebsiteSiteConfig

  it('news article and index', () => {
    expect(resolveHeaderCtaConfig(null, site({ actionType: 'newsArticle', newsArticleSlug: 'a' })).href).toBe('news/a')
    expect(resolveHeaderCtaConfig(null, site({ actionType: 'newsIndex' })).href).toBe('news')
  })

  it('page link unchanged', () => {
    expect(resolveHeaderCtaConfig(null, site({ actionType: 'page', pageSlug: 'about' })).href).toBe('about')
  })
})

describe('navigation links — news index special section', () => {
  const link = (l: Partial<NavLink>) => ({ label: 'News', ...l }) as NavLink

  it('internalPage "news" resolves to the news index', () => {
    expect(resolveNavLink(link({ linkType: 'internal', internalPage: 'news' }), 'it', 'abluo').href).toBe('/it/abluo/news')
  })

  it('existing special sections and page refs are unchanged', () => {
    expect(resolveNavLink(link({ linkType: 'internal', internalPage: 'blog' }), 'en', 'abluo').href).toBe('/en/abluo/blog')
    expect(resolveNavLink(link({ linkType: 'internal', internalPage: 'homepage' }), 'en', 'abluo').href).toBe('/en/abluo')
    expect(resolveNavLink(link({ linkType: 'internal', pageSlug: 'about' }), 'en', 'abluo').href).toBe('/en/abluo/about')
  })
})
