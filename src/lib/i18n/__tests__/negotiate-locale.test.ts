import { describe, it, expect } from 'vitest'
import { negotiateLocale, parseAcceptLanguage } from '../negotiate-locale'

// The platform rule, stated by Tom on 2026-09-30, one case per sentence.
describe('negotiateLocale — the Abluo root-URL rule', () => {
  const enFr = { supportedLocales: ['en', 'fr'], defaultLocale: 'en' }
  const enDe = { supportedLocales: ['en', 'de'], defaultLocale: 'en' }

  it('German browser, site without German → default (English), never a 404 locale', () => {
    expect(negotiateLocale({ ...enFr, acceptLanguage: 'de-DE,de;q=0.9' })).toBe('en')
  })
  it('German browser, site with German → German', () => {
    expect(negotiateLocale({ ...enDe, acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' })).toBe('de')
  })
  it('French browser on an English-default site with French → French', () => {
    expect(negotiateLocale({ ...enFr, acceptLanguage: 'fr-BE,fr;q=0.9,en;q=0.8' })).toBe('fr')
  })
  it('Lithuanian / Chinese browser with no offered language → default', () => {
    expect(negotiateLocale({ ...enFr, acceptLanguage: 'lt-LT,lt;q=0.9' })).toBe('en')
    expect(negotiateLocale({ ...enFr, acceptLanguage: 'zh-CN,zh;q=0.9' })).toBe('en')
  })
  it('walks the preference list: de first, fr second, site has fr → fr', () => {
    expect(negotiateLocale({ ...enFr, acceptLanguage: 'de-DE,de;q=0.9,fr;q=0.8,en;q=0.7' })).toBe('fr')
  })
  it('respects q-values, not header order', () => {
    expect(negotiateLocale({ ...enFr, acceptLanguage: 'en;q=0.5,fr;q=0.9' })).toBe('fr')
  })
  it('an earlier choice (cookie) beats the browser', () => {
    expect(negotiateLocale({ ...enFr, cookieLocale: 'en', acceptLanguage: 'fr-FR,fr' })).toBe('en')
  })
  it('ignores a remembered language the site no longer offers', () => {
    expect(negotiateLocale({ ...enFr, cookieLocale: 'de', acceptLanguage: 'fr' })).toBe('fr')
    expect(negotiateLocale({ ...enFr, cookieLocale: 'de' })).toBe('en')
  })
  it('no header, no cookie → default', () => {
    expect(negotiateLocale(enFr)).toBe('en')
  })
  it('missing supportedLocales → only the default is offered', () => {
    expect(negotiateLocale({ defaultLocale: 'it', acceptLanguage: 'en' })).toBe('it')
    expect(negotiateLocale({ defaultLocale: 'it', supportedLocales: [], acceptLanguage: 'en' })).toBe('it')
  })
  it('a French-default site sends an English browser to English when offered', () => {
    expect(negotiateLocale({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr', acceptLanguage: 'en-GB' })).toBe('en')
  })
})

describe('parseAcceptLanguage', () => {
  it('orders by q, keeps header order on ties, drops q=0 and *', () => {
    expect(parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5')).toEqual(['fr', 'en', 'de'])
    expect(parseAcceptLanguage('de;q=0, it')).toEqual(['it'])
    expect(parseAcceptLanguage('EN-us')).toEqual(['en'])
    expect(parseAcceptLanguage('')).toEqual([])
    expect(parseAcceptLanguage(null)).toEqual([])
  })
})
