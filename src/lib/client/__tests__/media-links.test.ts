/**
 * The Media screen's injected links (ADR-030): the client keeps exactly the
 * hrefs it built before; the admin gets its own add route and plain-text
 * "Used in". Plus the per-photo default language used across projects.
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_MEDIA_LINKS, adminMediaHref, CLIENT_MEDIA_LINKS, fillMediaLink, mediaUsageHref } from '../media-links'
import { applyMediaFilters, DEFAULT_MEDIA_FILTERS, localeFor } from '../media-filter'

describe('client media links (unchanged behaviour)', () => {
  it('builds the same hrefs as the screen did before', () => {
    expect(fillMediaLink(CLIENT_MEDIA_LINKS.add, { project: 'amelie' })).toBe('/amelie/media/add')
    expect(mediaUsageHref(CLIENT_MEDIA_LINKS, 'amelie', { kind: 'gallery', id: 'g-1' })).toBe('/amelie/galleries/g-1')
    expect(mediaUsageHref(CLIENT_MEDIA_LINKS, 'amelie', { kind: 'post', id: 'p-1' })).toBe('/amelie/posts')
    expect(mediaUsageHref(CLIENT_MEDIA_LINKS, 'amelie', { kind: 'page', id: 'x' })).toBeNull()
    for (const kind of ['event', 'settings', 'other'] as const) expect(mediaUsageHref(CLIENT_MEDIA_LINKS, 'amelie', { kind, id: 'x' })).toBeNull()
  })
})

describe('admin media links', () => {
  it('adds into one project; "Used in" stays text', () => {
    expect(fillMediaLink(ADMIN_MEDIA_LINKS.add, { project: 'amelie' })).toBe('/media/add?project=amelie')
    expect(mediaUsageHref(ADMIN_MEDIA_LINKS, 'amelie', { kind: 'gallery', id: 'g-1' })).toBeNull()
    expect(mediaUsageHref(ADMIN_MEDIA_LINKS, 'amelie', { kind: 'post', id: 'p-1' })).toBeNull()
  })

  it('has no add link without a project ("All projects")', () => {
    expect(fillMediaLink(ADMIN_MEDIA_LINKS.add, { project: null })).toBeNull()
  })

  it('links the admin Media page for one project or all', () => {
    expect(adminMediaHref('amelie')).toBe('/media?project=amelie')
    expect(adminMediaHref(null)).toBe('/media')
  })
})

describe('fillMediaLink', () => {
  it('encodes values and needs an id when the template has one', () => {
    expect(fillMediaLink('/{project}/x/{id}', { project: 'a b', id: 'c/d' })).toBe('/a%20b/x/c%2Fd')
    expect(fillMediaLink('/{project}/x/{id}', { project: 'a' })).toBeNull()
    expect(fillMediaLink(null, { project: 'a' })).toBeNull()
  })
})

describe('per-photo default language (lists across projects)', () => {
  const photo = (assetId: string, alt: Record<string, string>, locale: string) => ({ assetId, name: '', alt, tags: [], usedIn: [], locale })

  it('localeFor reads a string or a function', () => {
    expect(localeFor('it', photo('a', {}, 'de'))).toBe('it')
    expect(localeFor((p: { locale: string }) => p.locale, photo('a', {}, 'de'))).toBe('de')
  })

  it('"description missing" checks each photo in its own site language', () => {
    const items = [photo('it-ok', { it: 'Mare' }, 'it'), photo('de-missing', { it: 'Mare' }, 'de'), photo('de-ok', { de: 'Meer' }, 'de')]
    const missing = applyMediaFilters(items, { ...DEFAULT_MEDIA_FILTERS, description: 'missing' }, (p) => p.locale)
    expect(missing.map((p) => p.assetId)).toEqual(['de-missing'])
    // One language for all: the client's behaviour.
    expect(applyMediaFilters(items, { ...DEFAULT_MEDIA_FILTERS, description: 'missing' }, 'it').map((p) => p.assetId)).toEqual(['de-ok'])
  })
})
