import { describe, expect, it } from 'vitest'
import { cleanIds, cleanLinks, deletedPurgeCutoff, deliveryOf, linkView, pageHref, DELETED_KEEP_DAYS, type SiteAddress } from '../model'
import { cleanLibraryPicks, libraryFetchUrl } from '../library'
import { sitePageOptions } from '../site-pages'
import { SANITY_DATASET, SANITY_PROJECT_ID } from '@/lib/sanity/config'

const preview: SiteAddress = { projectSlug: 'cyce', liveOrigin: null, defaultLocale: 'it' }
const live: SiteAddress = { projectSlug: 'cyce', liveOrigin: 'https://www.cyce.it', defaultLocale: 'it' }

describe('links: dashboard destinations and website pages (Tom 2026-11-11)', () => {
  it('keeps dashboard ids and page links, drops junk and duplicates, at most 3', () => {
    expect(cleanLinks(['home', { page: 'chi-siamo', label: ' Chi  siamo ' }, { page: 'chi-siamo', label: 'again' }, { page: '../etc', label: 'x' }, { page: 'https://evil.com', label: 'x' }, 'nope'])).toEqual([
      { id: 'home' },
      { page: 'chi-siamo', label: 'Chi siamo' },
    ])
    expect(cleanLinks([{ page: '', label: 'Home' }, { id: 'support' }, { page: 'corsi/yoga', label: 'Yoga' }, { id: 'media' }])).toHaveLength(3)
  })

  it('a page opens on the preview address until the site is live, then on its own domain', () => {
    expect(pageHref(preview, 'chi-siamo')).toBe('https://preview.abluo.app/cyce/chi-siamo')
    expect(pageHref(preview, '')).toBe('https://preview.abluo.app/cyce')
    expect(pageHref(live, 'chi-siamo')).toBe('https://www.cyce.it/it/chi-siamo')
    expect(pageHref(live, '')).toBe('https://www.cyce.it/it')
  })

  it('the thread view of a link: dashboard path, or website page with its title', () => {
    expect(linkView(preview, { id: 'support' })).toEqual({ id: 'support', href: '/cyce/support' })
    expect(linkView(live, { page: 'corsi', label: 'Corsi' })).toEqual({ id: 'page:corsi', href: 'https://www.cyce.it/it/corsi', page: { label: 'Corsi' } })
    expect(linkView(preview, { id: 'gone' })).toBeNull()
  })
})

describe('list status: has the client seen it? (point 5)', () => {
  const t1 = '2026-11-10T10:00:00.000Z'
  const t2 = '2026-11-10T11:00:00.000Z'
  const t3 = '2026-11-10T12:00:00.000Z'
  it('one person: seen after Abluo wrote, with the time; or not yet', () => {
    expect(deliveryOf(t1, null, [t2])).toEqual({ lastFrom: 'abluo', seen: 1, total: 1, seenAt: t2 })
    expect(deliveryOf(t2, null, [t1])).toEqual({ lastFrom: 'abluo', seen: 0, total: 1, seenAt: null })
    expect(deliveryOf(t1, null, [null])).toEqual({ lastFrom: 'abluo', seen: 0, total: 1, seenAt: null })
  })
  it('shared: seen by n of m; the time only once everyone has', () => {
    expect(deliveryOf(t1, null, [t2, null])).toEqual({ lastFrom: 'abluo', seen: 1, total: 2, seenAt: null })
    expect(deliveryOf(t1, null, [t3, t2])).toEqual({ lastFrom: 'abluo', seen: 2, total: 2, seenAt: t3 })
  })
  it('the client wrote last: replied', () => {
    expect(deliveryOf(t1, t2, [t2]).lastFrom).toBe('client')
  })
})

describe('bulk and Recently deleted (point 6)', () => {
  it('ids: uuids only, distinct, at most 200', () => {
    const a = '11111111-1111-1111-1111-111111111111'
    expect(cleanIds([a, a, 'x', 3, null])).toEqual([a])
    expect(cleanIds('nope')).toEqual([])
  })
  it('purge cutoff is 30 days back', () => {
    const now = Date.parse('2026-12-11T00:00:00.000Z')
    expect(DELETED_KEEP_DAYS).toBe(30)
    expect(deletedPurgeCutoff(now)).toBe('2026-11-11T00:00:00.000Z')
  })
})

describe('Media Library pictures in a message', () => {
  const ok = `https://cdn.sanity.io/images/${SANITY_PROJECT_ID}/${SANITY_DATASET}/0a1b2c3d4e5f60718293a4b5c6d7e8f901234567-1600x1200.jpg`
  it('only our own Sanity image CDN is fetched, always as a bounded JPEG copy', () => {
    expect(libraryFetchUrl(ok)).toBe(`${ok}?w=2000&fit=max&fm=jpg&q=85`)
    expect(libraryFetchUrl(`${ok}?w=10`)).toBe(`${ok}?w=2000&fit=max&fm=jpg&q=85`)
    expect(libraryFetchUrl(ok.replace('cdn.sanity.io', 'evil.io'))).toBeNull()
    expect(libraryFetchUrl(ok.replace(SANITY_PROJECT_ID, 'otherproj'))).toBeNull()
    expect(libraryFetchUrl(ok.replace('https:', 'http:'))).toBeNull()
    expect(libraryFetchUrl(`https://cdn.sanity.io/images/${SANITY_PROJECT_ID}/${SANITY_DATASET}/../../x.jpg`)).toBeNull()
    expect(libraryFetchUrl(`https://cdn.sanity.io:8443/images/${SANITY_PROJECT_ID}/${SANITY_DATASET}/0a1b2c3d4e5f60718293a4b5c6d7e8f901234567-1x1.jpg`)).toBeNull()
  })
  it('picks: cleaned, distinct, at most the attachment limit', () => {
    expect(cleanLibraryPicks([{ url: ok, name: 'Studio' }, { url: ok }, { url: 'https://x.com/a.jpg' }, 'x'])).toEqual([{ url: ok, name: 'Studio' }])
  })
})

describe('website pages for the chooser', () => {
  it('home first as "", slugs in the default language, pages without one skipped', () => {
    expect(
      sitePageOptions(
        [
          { pageType: 'home', title: { it: 'Benvenuti' }, slug: { it: { current: 'home' } } },
          { pageType: 'about', title: { it: 'Chi siamo', en: 'About' }, slug: { it: { current: 'chi-siamo' }, en: { current: 'about' } } },
          { pageType: 'landing', title: { en: 'Only EN' }, slug: { en: { current: 'only-en' } } },
        ],
        'it',
      ),
    ).toEqual([
      { page: '', label: 'Benvenuti' },
      { page: 'chi-siamo', label: 'Chi siamo' },
    ])
  })
})
