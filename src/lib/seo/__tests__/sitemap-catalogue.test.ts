/**
 * ADR-033 D4.4 / spec §6.5 / AC 13, 16, 17b — catalogue sitemap and llms.txt.
 * The queries decide WHAT is listed (hasPage, lifecycle, visibility context);
 * the pure helpers decide the URLs.
 */
import { describe, expect, it } from 'vitest'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { visibilityFilter } from '@/lib/modules/catalogue/visibility'
import {
  SITEMAP_CATALOGUE_COLLECTIONS_QUERY,
  SITEMAP_CATALOGUE_ITEMS_QUERY,
  SITEMAP_CATALOGUE_LANDING_QUERY,
} from '../sitemap-queries'
import { catalogueSitemapEntries } from '../sitemap-catalogue'
import {
  LLMS_CATALOGUE_COLLECTIONS_QUERY,
  LLMS_CATALOGUE_ITEMS_QUERY,
  catalogueLinesFor,
} from '../llms'

const ORIGIN = 'https://www.rist.it'

describe('catalogue sitemap queries', () => {
  it('items and collections: hasPage required (AC 13), lifecycle rule, no unlisted (AC 16)', () => {
    for (const [q, t] of [
      [SITEMAP_CATALOGUE_ITEMS_QUERY, 'catalogueItem'],
      [SITEMAP_CATALOGUE_COLLECTIONS_QUERY, 'catalogueCollection'],
    ] as const) {
      expect(q).toContain('hasPage == true')
      expect(q).toContain(publicFilterFor(t))
      expect(q).toContain(visibilityFilter('sitemap'))
      expect(visibilityFilter('sitemap')).not.toContain('"unlisted"')
      expect(q).toContain('[defined(segment)]')
    }
  })

  it('landing: its own lifecycle rule (C1), only with a segment', () => {
    expect(SITEMAP_CATALOGUE_LANDING_QUERY).toContain(publicFilterFor('cataloguePage'))
    expect(SITEMAP_CATALOGUE_LANDING_QUERY).toContain('[defined(segment)]')
  })
})

describe('catalogueSitemapEntries', () => {
  const base = { origin: ORIGIN, locales: ['it', 'en'], primaryLocale: 'it' }

  it('one URL per locale where the slug is set, under the segment', () => {
    const urls = catalogueSitemapEntries({
      ...base,
      items: [{ projectSlug: 'rist', segment: 'menu', slug: { it: { current: 'margherita' } } }],
      collections: [{ projectSlug: 'rist', segment: 'menu', slug: { it: { current: 'pranzo' }, en: { current: 'lunch' } } }],
      landing: null,
    }).map((e) => e.url)
    expect(urls).toEqual([
      `${ORIGIN}/it/menu/pranzo`,
      `${ORIGIN}/en/menu/lunch`,
      `${ORIGIN}/it/menu/margherita`,
    ])
  })

  it('no rows (hasPage false / unlisted, filtered by the query) → no entries', () => {
    expect(catalogueSitemapEntries({ ...base, items: [], collections: [], landing: null })).toEqual([])
  })

  it('a row without a segment (module off) emits nothing', () => {
    expect(
      catalogueSitemapEntries({ ...base, items: [{ projectSlug: 'rist', segment: null, slug: { it: { current: 'x' } } }], collections: [], landing: null }),
    ).toEqual([])
  })

  it('the landing page per locale when public', () => {
    const urls = catalogueSitemapEntries({ ...base, items: [], collections: [], landing: { projectSlug: 'rist', segment: 'menu' } }).map((e) => e.url)
    expect(urls).toEqual([`${ORIGIN}/it/menu`, `${ORIGIN}/en/menu`])
  })

  it('item photos join the image sitemap (https only)', () => {
    const [e] = catalogueSitemapEntries({
      ...base,
      locales: ['it'],
      items: [{ projectSlug: 'rist', segment: 'menu', slug: { it: { current: 'm' } }, images: ['https://cdn/x.jpg', 'http://bad'] }],
      collections: [],
      landing: null,
    })
    expect(e.images).toEqual(['https://cdn/x.jpg'])
  })
})

describe('llms.txt — catalogue under the structuredData context (C10)', () => {
  it('queries require a page, the lifecycle rule and exclude unlisted', () => {
    for (const [q, t] of [
      [LLMS_CATALOGUE_ITEMS_QUERY, 'catalogueItem'],
      [LLMS_CATALOGUE_COLLECTIONS_QUERY, 'catalogueCollection'],
    ] as const) {
      expect(q).toContain('hasPage == true')
      expect(q).toContain(publicFilterFor(t))
      expect(q).toContain(visibilityFilter('structuredData'))
    }
    expect(visibilityFilter('structuredData')).not.toContain('"unlisted"')
  })

  it('lines under the segment, collections first; nothing without a segment', () => {
    const rows = {
      collections: [{ titles: { it: 'Pranzo' }, slugs: { it: { current: 'pranzo' } } }],
      items: [{ titles: { it: 'Margherita' }, slugs: { it: { current: 'margherita' } }, descriptions: { it: 'Pomodoro' } }],
    }
    expect(catalogueLinesFor(rows, 'menu', ORIGIN, 'it')).toEqual([
      `- [Pranzo](${ORIGIN}/it/menu/pranzo)`,
      `- [Margherita](${ORIGIN}/it/menu/margherita): Pomodoro`,
    ])
    expect(catalogueLinesFor(rows, 'menu', ORIGIN, 'en')).toEqual([])
    expect(catalogueLinesFor(rows, null, ORIGIN, 'it')).toEqual([])
  })
})
