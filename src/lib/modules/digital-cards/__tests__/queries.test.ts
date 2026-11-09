import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import * as Q from '../queries'
import type { DigitalCardKnownIds, DigitalCardPersonResult, DigitalCardRouteState, DigitalCardSiteResult } from '../projection'

// ADR-049 — the website queries evaluated against a small dataset: only live,
// published cards of this project; persons only while listable; hidden links
// left out; retired names; offline cards visible to routing only.

const P = 'cyce'
const PAST = '2026-01-01T00:00:00Z'
const ref = (id: string) => ({ _type: 'reference', _ref: id })

const dataset = [
  { _id: 'project-cyce', _type: 'project', projectSlug: P, customDomain: 'cyce.info', moduleInstallations: [{ moduleId: 'digital-cards', enabled: true }, { moduleId: 'whatsapp', enabled: true, config: { whatsappNumber: '+32 470 000000' } }, { moduleId: 'people', enabled: true, config: { profileSegment: { en: 'teachers' } } }] },
  { _id: 'site-cyce', _type: 'siteConfig', projectSlug: P, siteName: 'CYCE', phone: '+32 2 000 00 00', email: 'info@cyce.info', whatsappNumber: '+32 999', socialLinks: [{ _key: 's1', platform: 'instagram', url: 'https://instagram.com/cyce' }], locations: [{ _key: 'l1', key: 'brey', name: { en: 'Breydel' } }] },
  { _id: 'media-bg', _type: 'mediaAsset', projectSlug: P, image: { asset: ref('image-bg'), hotspot: { x: 0.3, y: 0.4 } }, altText: { en: 'Studio' } },
  { _id: 'media-foreign', _type: 'mediaAsset', projectSlug: 'other', image: { asset: ref('image-x') } },
  { _id: 'media-pdf', _type: 'mediaAsset', projectSlug: P, name: 'timetable.pdf', mediaType: 'image', image: { asset: ref('image-pdf') } },
  { _id: 'page-contact', _type: 'page', projectSlug: P, slug: { en: { current: 'contact' } }, title: { en: 'Contact' } },
  { _id: 'person-sofia', _type: 'person', projectSlug: P, publicId: 'p-sofia', firstName: 'Sofia', lastName: 'Rossi', visibility: 'page', slug: { en: { current: 'sofia' } } },
  { _id: 'person-off', _type: 'person', projectSlug: P, publicId: 'p-off', firstName: 'Off', visibility: 'off' },
  { _id: 'person-archived', _type: 'person', projectSlug: P, publicId: 'p-arch', firstName: 'Old', archivedAt: PAST },
  {
    _id: 'card-site', _type: 'digitalCard', projectSlug: P, publicId: 'pub-site', kind: 'site', background: ref('media-bg'),
    description: { en: 'Yoga in Brussels' },
    links: [
      { _key: 'k1', kind: 'page', page: ref('page-contact'), primary: true, label: { en: 'Write to us' } },
      { _key: 'k2', kind: 'url', url: 'https://example.com', hidden: true },
      { _key: 'k3', kind: 'file', file: ref('media-pdf') },
      { _key: 'k4', kind: 'phone', value: '+32 2 000 00 00', url: 'https://leak.example' },
    ],
    show: { phone: false },
  },
  { _id: 'card-sofia', _type: 'digitalCard', projectSlug: P, publicId: 'pub-sofia', kind: 'person', person: ref('person-sofia'), urlName: 'sofia-rossi', retiredUrlNames: ['sofia'] },
  { _id: 'drafts.card-sofia', _type: 'digitalCard', projectSlug: P, publicId: 'pub-sofia', kind: 'person', person: ref('person-sofia'), urlName: 'draft-name' },
  { _id: 'card-off', _type: 'digitalCard', projectSlug: P, publicId: 'pub-offp', kind: 'person', person: ref('person-off'), urlName: 'off' },
  { _id: 'card-arch-person', _type: 'digitalCard', projectSlug: P, publicId: 'pub-archp', kind: 'person', person: ref('person-archived'), urlName: 'old' },
  { _id: 'card-unpublished', _type: 'digitalCard', projectSlug: P, publicId: 'pub-unp', kind: 'person', person: ref('person-sofia'), urlName: 'gone', expiresAt: PAST },
  { _id: 'card-archived', _type: 'digitalCard', projectSlug: P, publicId: 'pub-arch', kind: 'person', person: ref('person-sofia'), urlName: 'archived', archivedAt: PAST },
  { _id: 'card-foreign', _type: 'digitalCard', projectSlug: 'other', publicId: 'pub-foreign', kind: 'person', urlName: 'foreign', background: ref('media-foreign') },
]

async function run<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const all = { projectSlug: P, locale: 'en', defaultLocale: 'en', ...params }
  const value = await evaluate(parse(query, { params: all }), { dataset, params: all, timestamp: new Date('2026-11-09T12:00:00Z') })
  return (await value.get()) as T
}

describe('site card', () => {
  it('returns the live site card with resolved links, background and site data', async () => {
    const c = await run<DigitalCardSiteResult>(Q.DIGITAL_CARD_SITE_QUERY)
    expect(c.publicId).toBe('pub-site')
    expect(c.description).toBe('Yoga in Brussels')
    expect(c.links!.map((l) => l._key)).toEqual(['k1', 'k3', 'k4'])
    expect(c.links![0]).toMatchObject({ kind: 'page', primary: true, label: 'Write to us', page: { slug: 'contact', title: 'Contact' }, url: null, value: null })
    expect(c.links![1].file).toMatchObject({ title: 'timetable.pdf' })
    expect(c.links![2]).toMatchObject({ value: '+32 2 000 00 00', url: null })
    expect(c.background).toMatchObject({ hotspot: { x: 0.3, y: 0.4 }, alt: 'Studio' })
    expect(c.show).toEqual({ phone: false })
    expect(c.site).toMatchObject({ siteName: 'CYCE', email: 'info@cyce.info', whatsappNumber: '+32 470 000000' })
    expect(c.site!.locations![0]).toMatchObject({ _key: 'l1', name: 'Breydel' })
    expect(c.project).toMatchObject({ customDomain: 'cyce.info', peopleProfileSegment: { en: 'teachers' } })
    expect(c.project!.enabledModules).toContain('digital-cards')
    expect(Object.keys(c)).not.toContain('retiredUrlNames')
    expect(Object.keys(c)).not.toContain('_id')
  })
})

describe('person card', () => {
  it('returns the published copy by current name, with the person and the site card background', async () => {
    const c = await run<DigitalCardPersonResult>(Q.DIGITAL_CARD_PERSON_QUERY, { urlName: 'sofia-rossi' })
    expect(c).toMatchObject({ publicId: 'pub-sofia', kind: 'person', urlName: 'sofia-rossi', background: null })
    expect(c.person).toMatchObject({ publicId: 'p-sofia', firstName: 'Sofia', hasPage: true, archived: false })
    expect(c.siteCard!.background).toMatchObject({ hotspot: { x: 0.3, y: 0.4 } })
    expect(await run(Q.DIGITAL_CARD_PERSON_QUERY, { urlName: 'draft-name' })).toBeNull()
  })

  it('person off or archived → card returned with person null (offline, D6)', async () => {
    expect((await run<DigitalCardPersonResult>(Q.DIGITAL_CARD_PERSON_QUERY, { urlName: 'off' })).person).toBeNull()
    expect((await run<DigitalCardPersonResult>(Q.DIGITAL_CARD_PERSON_QUERY, { urlName: 'old' })).person).toBeNull()
  })

  it('unpublished, archived and foreign cards are not served', async () => {
    for (const urlName of ['gone', 'archived', 'foreign']) expect(await run(Q.DIGITAL_CARD_PERSON_QUERY, { urlName }), urlName).toBeNull()
  })

  it('a retired name leads to the current one', async () => {
    expect(await run(Q.DIGITAL_CARD_BY_RETIRED_NAME_QUERY, { urlName: 'sofia' })).toEqual({ urlName: 'sofia-rossi' })
    expect(await run(Q.DIGITAL_CARD_BY_RETIRED_NAME_QUERY, { urlName: 'nobody' })).toBeNull()
  })
})

describe('routing state and known ids', () => {
  it('tells an offline card from an unknown address', async () => {
    expect(await run<DigitalCardRouteState>(Q.DIGITAL_CARD_ROUTE_STATE_QUERY, { kind: 'person', urlName: 'gone' })).toEqual({ kind: 'person', urlName: 'gone', live: false })
    expect(await run<DigitalCardRouteState>(Q.DIGITAL_CARD_ROUTE_STATE_QUERY, { kind: 'person', urlName: 'sofia-rossi' })).toEqual({ kind: 'person', urlName: 'sofia-rossi', live: true })
    expect(await run(Q.DIGITAL_CARD_ROUTE_STATE_QUERY, { kind: 'person', urlName: 'foreign' })).toBeNull()
    expect(await run(Q.DIGITAL_CARD_ROUTE_STATE_QUERY, { kind: 'person', urlName: 'nobody' })).toBeNull()
    expect(await run<DigitalCardRouteState>(Q.DIGITAL_CARD_ROUTE_STATE_QUERY, { kind: 'site', urlName: '' })).toMatchObject({ kind: 'site', live: true })
  })

  it('lists live cards and their shown link keys only', async () => {
    const ids = await run<DigitalCardKnownIds[]>(Q.DIGITAL_CARD_KNOWN_IDS_QUERY)
    const byId = Object.fromEntries(ids.map((r) => [r.publicId, r.linkKeys]))
    expect(Object.keys(byId).sort()).toEqual(['pub-archp', 'pub-offp', 'pub-site', 'pub-sofia'])
    expect(byId['pub-site']).toEqual(['k1', 'k3', 'k4'])
    expect(byId['pub-sofia']).toEqual([])
  })
})
