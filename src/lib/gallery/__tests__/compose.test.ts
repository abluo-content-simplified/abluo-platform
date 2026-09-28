import { describe, it, expect } from 'vitest'
import { galleriesOf, toGroups, combineGroups, buildTabs } from '../compose'
import { hashPrefix, photoHash, parsePhotoHash } from '../deeplink'
import type { Gallery } from '@/lib/sanity/types'

const item = (key: string, assetId: string) => ({ _key: key, mediaAsset: { _id: assetId } })
const gallery = (id: string, title: string | undefined, assets: string[]): Gallery => ({
  _id: id,
  _type: 'gallery',
  projectSlug: 'p',
  internalName: id,
  title,
  items: assets.map((a, i) => item(`${id}-${i}`, a)),
})

const exterior = gallery('ext', 'Exterior', ['a1', 'a2'])
const room1 = gallery('r1', 'Room 1', ['a3', 'a4'])
const treatments = gallery('tr', 'Treatments', ['a4', 'a5'])

const opts = { allLabel: 'All', fallbackLabel: (i: number) => `Gallery ${i + 1}` }

describe('galleriesOf', () => {
  it('reads the legacy single gallery when no galleries are set', () => {
    expect(galleriesOf({ gallery: exterior, galleries: null })).toEqual([exterior])
    expect(galleriesOf({ gallery: exterior, galleries: [] })).toEqual([exterior])
  })
  it('prefers the galleries list and drops unresolvable references', () => {
    expect(galleriesOf({ gallery: exterior, galleries: [room1, null] })).toEqual([room1])
  })
  it('is empty when nothing is set', () => {
    expect(galleriesOf({})).toEqual([])
  })
})

describe('combineGroups', () => {
  it('shows a photo that sits in two galleries once', () => {
    const items = combineGroups(toGroups([room1, treatments]))
    expect(items.map((i) => i.mediaAsset?._id)).toEqual(['a3', 'a4', 'a5'])
  })
})

describe('buildTabs', () => {
  it('uses one untitled set in combined mode', () => {
    const tabs = buildTabs(toGroups([exterior, room1]), { ...opts, display: 'combined' })
    expect(tabs).toHaveLength(1)
    expect(tabs[0].items).toHaveLength(4)
  })
  it('puts All first, selected on load, then one tab per gallery', () => {
    const tabs = buildTabs(toGroups([exterior, room1, treatments]), { ...opts, display: 'tabs' })
    expect(tabs.map((t) => t.label)).toEqual(['All', 'Exterior', 'Room 1', 'Treatments'])
    expect(tabs[0].items).toHaveLength(5)
  })
  it('can leave out the All tab', () => {
    const tabs = buildTabs(toGroups([exterior, room1]), { ...opts, display: 'tabs', showAllTab: false })
    expect(tabs.map((t) => t.label)).toEqual(['Exterior', 'Room 1'])
  })
  it('does not make tabs out of a single gallery', () => {
    expect(buildTabs(toGroups([exterior]), { ...opts, display: 'tabs' })).toHaveLength(1)
  })
  it('labels an untitled gallery without leaking its internal Studio name', () => {
    const tabs = buildTabs(toGroups([gallery('x', undefined, ['z']), exterior]), { ...opts, display: 'tabs', showAllTab: false })
    expect(tabs[0].label).toBe('Gallery 1')
  })
})

describe('deep links', () => {
  it('round-trips a photo number', () => {
    const prefix = hashPrefix(null)
    expect(photoHash(prefix, 2)).toBe('#photo-3')
    expect(parsePhotoHash('#photo-3', prefix)).toBe(2)
  })
  it('namespaces by anchor id so two galleries on a page do not collide', () => {
    const prefix = hashPrefix('studio')
    expect(photoHash(prefix, 0)).toBe('#studio-photo-1')
    expect(parsePhotoHash('#photo-1', prefix)).toBeNull()
  })
  it('ignores hashes it does not own or cannot parse', () => {
    const prefix = hashPrefix(null)
    expect(parsePhotoHash('#contact', prefix)).toBeNull()
    expect(parsePhotoHash('#photo-0', prefix)).toBeNull()
    expect(parsePhotoHash('#photo-abc', prefix)).toBeNull()
    expect(parsePhotoHash('', prefix)).toBeNull()
  })
})
