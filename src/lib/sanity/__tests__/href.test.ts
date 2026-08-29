import { describe, it, expect } from 'vitest'
import { isPassThroughHref, withTenantPrefix } from '../href'
import { resolveCta, prefixCtaHref } from '../cta'
import { resolveNavLink } from '../nav-links'
import type { Cta } from '../types'

const L = 'en'
const T = 'nologo'

describe('isPassThroughHref', () => {
  it.each([
    ['#contact', true],
    ['#', true],
    ['mailto:hello@nologo.io', true],
    ['tel:+390212345678', true],
    ['sms:+39021234', true],
    ['http://example.com', true],
    ['https://example.com/a?b=c#d', true],
    ['//cdn.example.com/file.pdf', true],
    ['', true],
    [null, true],
    [undefined, true],
    ['/about', false],
    ['about', false],
    ['/pricing#tiers', false],
    ['blog/post-1', false],
    ['/', false],
  ])('isPassThroughHref(%p) === %p', (input, expected) => {
    expect(isPassThroughHref(input as string | null | undefined)).toBe(expected)
  })
})

describe('withTenantPrefix', () => {
  it('leaves bare fragments alone', () => {
    expect(withTenantPrefix('#contact', L, T)).toBe('#contact')
  })

  it('leaves mailto:, tel: and sms: alone', () => {
    expect(withTenantPrefix('mailto:hello@nologo.io', L, T)).toBe('mailto:hello@nologo.io')
    expect(withTenantPrefix('tel:+390212345678', L, T)).toBe('tel:+390212345678')
    expect(withTenantPrefix('sms:+390212345678', L, T)).toBe('sms:+390212345678')
  })

  it('leaves absolute http(s) URLs alone', () => {
    expect(withTenantPrefix('https://example.com/x', L, T)).toBe('https://example.com/x')
    expect(withTenantPrefix('http://example.com/x', L, T)).toBe('http://example.com/x')
  })

  it('leaves protocol-relative URLs alone', () => {
    expect(withTenantPrefix('//cdn.example.com/file.pdf', L, T)).toBe('//cdn.example.com/file.pdf')
  })

  it('prefixes a leading-slash internal path', () => {
    expect(withTenantPrefix('/about', L, T)).toBe('/en/nologo/about')
  })

  it('prefixes a bare internal path', () => {
    expect(withTenantPrefix('about', L, T)).toBe('/en/nologo/about')
  })

  it('prefixes an internal path and keeps its fragment', () => {
    expect(withTenantPrefix('/pricing#tiers', L, T)).toBe('/en/nologo/pricing#tiers')
    expect(withTenantPrefix('pricing#tiers', L, T)).toBe('/en/nologo/pricing#tiers')
  })

  it('returns empty and nullish hrefs unchanged', () => {
    expect(withTenantPrefix('', L, T)).toBe('')
    expect(withTenantPrefix(null, L, T)).toBe('')
    expect(withTenantPrefix(undefined, L, T)).toBe('')
  })

  it('does nothing when locale or tenant is missing', () => {
    expect(withTenantPrefix('/about', undefined, T)).toBe('/about')
    expect(withTenantPrefix('/about', L, undefined)).toBe('/about')
  })
})

// ─── prefixCtaHref — the shared section-component prefixer ─────────────────────

function externalCta(url: string, openInNewTab = false): Cta {
  return { internalName: 'cta', label: 'Go', actionType: 'externalUrl', externalUrl: url, openInNewTab }
}

function hrefOf(cta: Cta): string {
  const resolved = prefixCtaHref(resolveCta(cta), L, T)
  if (resolved.type !== 'link') throw new Error(`expected link, got ${resolved.type}`)
  return resolved.href
}

describe('prefixCtaHref', () => {
  it('never prefixes a fragment CTA (the reported bug)', () => {
    expect(hrefOf(externalCta('#contact'))).toBe('#contact')
  })

  it('never prefixes a mailto: CTA (the reported bug)', () => {
    expect(hrefOf(externalCta('mailto:hello@nologo.io'))).toBe('mailto:hello@nologo.io')
  })

  it('never prefixes tel:, https:// or protocol-relative CTAs', () => {
    expect(hrefOf(externalCta('tel:+390212345678'))).toBe('tel:+390212345678')
    expect(hrefOf(externalCta('https://example.com/x'))).toBe('https://example.com/x')
    expect(hrefOf(externalCta('//cdn.example.com/file.pdf'))).toBe('//cdn.example.com/file.pdf')
  })

  it('leaves pass-through hrefs alone regardless of openInNewTab', () => {
    expect(hrefOf(externalCta('#contact', true))).toBe('#contact')
    expect(hrefOf(externalCta('mailto:hello@nologo.io', true))).toBe('mailto:hello@nologo.io')
  })

  it('still prefixes internal page CTAs exactly as before', () => {
    const cta: Cta = { internalName: 'cta', label: 'About', actionType: 'page', pageSlug: 'about' }
    expect(hrefOf(cta)).toBe('/en/nologo/about')
    expect(hrefOf({ ...cta, pageSlug: '/about' })).toBe('/en/nologo/about')
  })

  it('prefixes an internal page CTA that carries a fragment', () => {
    const cta: Cta = { internalName: 'cta', label: 'Tiers', actionType: 'page', pageSlug: '/pricing#tiers' }
    expect(hrefOf(cta)).toBe('/en/nologo/pricing#tiers')
  })

  it('leaves non-link CTAs untouched', () => {
    const form = resolveCta({ internalName: 'f', actionType: 'form', formId: 'early-access' })
    expect(prefixCtaHref(form, L, T)).toEqual(form)

    const download = resolveCta({ internalName: 'd', actionType: 'fileDownload', fileUrl: 'https://cdn.io/a.pdf' })
    expect(prefixCtaHref(download, L, T)).toEqual(download)

    const none = resolveCta(null)
    expect(prefixCtaHref(none, L, T)).toEqual(none)
    expect(prefixCtaHref(resolveCta(undefined), L, T).type).toBe('none')
  })

  it('does nothing without locale/tenant params', () => {
    const resolved = resolveCta({ internalName: 'c', actionType: 'page', pageSlug: 'about' })
    expect(prefixCtaHref(resolved, undefined, T)).toEqual(resolved)
    expect(prefixCtaHref(resolved, L, undefined)).toEqual(resolved)
  })

  it('returns the same object when nothing changed (no needless re-render churn)', () => {
    const resolved = resolveCta(externalCta('#contact'))
    expect(prefixCtaHref(resolved, L, T)).toBe(resolved)
  })
})

// ─── nav-links ────────────────────────────────────────────────────────────────

describe('resolveNavLink legacy href prefixing', () => {
  const nav = (href: string) => resolveNavLink({ label: 'x', href }, L, T).href

  it('leaves fragments, schemes and protocol-relative URLs alone', () => {
    expect(nav('#faq')).toBe('#faq')
    expect(nav('mailto:hello@nologo.io')).toBe('mailto:hello@nologo.io')
    expect(nav('tel:+390212345678')).toBe('tel:+390212345678')
    expect(nav('https://example.com/x')).toBe('https://example.com/x')
    expect(nav('//cdn.example.com/file.pdf')).toBe('//cdn.example.com/file.pdf')
  })

  it('still prefixes internal paths exactly as before', () => {
    expect(nav('/live')).toBe('/en/nologo/live')
    expect(nav('/pricing#tiers')).toBe('/en/nologo/pricing#tiers')
    expect(nav('/en/live')).toBe('/en/nologo/live')
  })

  it('keeps the other link types unchanged', () => {
    expect(resolveNavLink({ label: 'x', linkType: 'internal', pageSlug: 'about' }, L, T).href).toBe('/en/nologo/about')
    expect(resolveNavLink({ label: 'x', linkType: 'anchor', anchorId: 'faq' }, L, T).href).toBe('#faq')
    expect(
      resolveNavLink({ label: 'x', linkType: 'external', externalUrl: 'mailto:hello@nologo.io' }, L, T).href
    ).toBe('mailto:hello@nologo.io')
  })
})
