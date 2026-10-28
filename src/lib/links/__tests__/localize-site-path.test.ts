import { describe, it, expect, vi } from 'vitest'
import {
  findSiteLinkSlots,
  localizeSiteLinks,
  localizeSitePath,
  normalizeSitePageSlugs,
} from '../localize-site-path'

// Shaped like the real CYCE rows from sitePageSlugsQuery (raw localizedSlug).
const PAGES = normalizeSitePageSlugs([
  { _id: 'cyce-page-home', pageType: 'home', slugs: { _type: 'localizedSlug', en: { current: 'home' }, fr: { current: 'home' } } },
  { _id: 'cyce-page-teachers', pageType: 'team', slugs: { _type: 'localizedSlug', en: { current: 'teachers' }, fr: { current: 'professeurs' } } },
  { _id: 'cyce-page-contact', pageType: 'contact', slugs: { en: { current: 'contact' }, fr: { current: 'contact' } } },
  { _id: 'about', pageType: 'landing', slugs: { en: { current: 'about' }, fr: { current: 'a-propos' } } },
  { _id: 'about-team', pageType: 'landing', slugs: { en: { current: 'about/team' }, fr: { current: 'a-propos/equipe' } } },
  { _id: 'en-only', pageType: 'landing', slugs: { en: { current: 'press' } } },
])

describe('localizeSitePath', () => {
  it('rewrites an English page slug to French, keeping the anchor', () => {
    expect(localizeSitePath('/teachers#elena-constantinides', 'fr', PAGES)).toBe('/professeurs#elena-constantinides')
  })

  it('keeps the query string too', () => {
    expect(localizeSitePath('/teachers?x=1#a', 'fr', PAGES)).toBe('/professeurs?x=1#a')
  })

  it('leaves an unknown path alone', () => {
    expect(localizeSitePath('/nowhere#x', 'fr', PAGES)).toBe('/nowhere#x')
    expect(localizeSitePath('/teachersroom', 'fr', PAGES)).toBe('/teachersroom')
  })

  it('leaves absolute URLs, anchors, mailto and tel untouched', () => {
    expect(localizeSitePath('https://example.com/teachers', 'fr', PAGES)).toBe('https://example.com/teachers')
    expect(localizeSitePath('//cdn.example.com/teachers', 'fr', PAGES)).toBe('//cdn.example.com/teachers')
    expect(localizeSitePath('#teachers', 'fr', PAGES)).toBe('#teachers')
    expect(localizeSitePath('mailto:a@b.c', 'fr', PAGES)).toBe('mailto:a@b.c')
  })

  it('matches the longest nested slug', () => {
    expect(localizeSitePath('/about/team#lead', 'fr', PAGES)).toBe('/a-propos/equipe#lead')
    expect(localizeSitePath('/about#x', 'fr', PAGES)).toBe('/a-propos#x')
    expect(localizeSitePath('/a-propos/equipe', 'en', PAGES)).toBe('/about/team')
  })

  it('leaves a slug already in the target locale as it is', () => {
    expect(localizeSitePath('/professeurs#elena', 'fr', PAGES)).toBe('/professeurs#elena')
    expect(localizeSitePath('/teachers#elena', 'en', PAGES)).toBe('/teachers#elena')
    expect(localizeSitePath('/contact', 'fr', PAGES)).toBe('/contact')
  })

  it('also maps back from French to English', () => {
    expect(localizeSitePath('/professeurs#elena', 'en', PAGES)).toBe('/teachers#elena')
  })

  it('keeps home as home', () => {
    expect(localizeSitePath('/', 'fr', PAGES)).toBe('/')
    expect(localizeSitePath('/#about', 'fr', PAGES)).toBe('/#about')
    expect(localizeSitePath('/home', 'fr', PAGES)).toBe('/')
    expect(localizeSitePath('/home#news', 'fr', PAGES)).toBe('/#news')
  })

  it('keeps the link when the page has no slug in the visitor locale', () => {
    expect(localizeSitePath('/press', 'fr', PAGES)).toBe('/press')
  })

  it('never touches platform module routes', () => {
    const withEvents = normalizeSitePageSlugs([{ _id: 'e', slugs: { en: { current: 'events' }, fr: { current: 'evenements' } } }])
    expect(localizeSitePath('/events/yoga', 'fr', withEvents)).toBe('/events/yoga')
  })

  it('returns the input when there is no slug map or locale', () => {
    expect(localizeSitePath('/teachers', 'fr', [])).toBe('/teachers')
    expect(localizeSitePath('/teachers', null, PAGES)).toBe('/teachers')
    expect(localizeSitePath(undefined, 'fr', PAGES)).toBeUndefined()
  })
})

describe('localizeSiteLinks', () => {
  it('rewrites event hosts, registration URLs and site-relative CTA URLs in place', async () => {
    const sections = [
      {
        _type: 'eventsListingSection',
        events: [{ registrationUrl: '/teachers', hosts: [{ name: 'Elena', url: '/teachers#elena' }, { name: 'X', url: 'https://x.org' }] }],
      },
      { _type: 'hero', ctas: [{ actionType: 'externalUrl', externalUrl: '/about/team' }, { actionType: 'page', pageSlug: 'teachers' }] },
    ]
    await localizeSiteLinks(sections, 'fr', async () => PAGES)
    expect(sections[0].events![0].registrationUrl).toBe('/professeurs')
    expect(sections[0].events![0].hosts[0].url).toBe('/professeurs#elena')
    expect(sections[0].events![0].hosts[1].url).toBe('https://x.org')
    expect(sections[1].ctas![0].externalUrl).toBe('/a-propos/equipe')
    expect(sections[1].ctas![1]).toEqual({ actionType: 'page', pageSlug: 'teachers' })
  })

  it('does not read the slug map when there is nothing to localize', async () => {
    const load = vi.fn(async () => PAGES)
    await localizeSiteLinks([{ hosts: [{ url: 'https://x.org' }], registrationUrl: '#form' }], 'fr', load)
    expect(load).not.toHaveBeenCalled()
    expect(findSiteLinkSlots(null)).toEqual([])
  })
})
