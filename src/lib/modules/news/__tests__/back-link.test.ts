import { describe, it, expect } from 'vitest'
import { newsBackLink } from '../back-link'

describe('newsBackLink', () => {
  it('uses the site’s own name for its news index when authored', () => {
    expect(newsBackLink({ from: undefined, locale: 'it', siteBase: '/it', newsIndexTitle: 'Journal' })).toEqual({
      label: 'Journal',
      url: '/it/news',
    })
  })

  it('falls back to the localized dictionary label', () => {
    expect(newsBackLink({ from: undefined, locale: 'de', siteBase: '/de', newsIndexTitle: null }).label).toBe('Zurück zu den News')
    expect(newsBackLink({ from: 'news', locale: 'en', siteBase: '/en', newsIndexTitle: '  ' }).label).toBe('Back to News')
  })

  it('keeps the path-based base on preview surfaces and honours a legacy ?from=page', () => {
    expect(newsBackLink({ from: undefined, locale: 'en', siteBase: '/en/abluo' }).url).toBe('/en/abluo/news')
    expect(newsBackLink({ from: 'staging-home', locale: 'en', siteBase: '/en', newsIndexTitle: 'Journal' }).url).toBe('/en/staging-home')
  })
})
