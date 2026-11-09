/**
 * The address when a site has no `locations[]` (Claudia Hoffmann, 2026-11-09):
 * her Website Settings hold ONE `location` of type businessLocation
 * { street, postalCode, city, state, country } and `locations: null`. The card
 * treated the address as missing; now that single address is the card's one
 * location — in the editor's availability, on the website card, in the vCard
 * ADR field and in the live preview — keyed SITE_LOCATION_FALLBACK_KEY.
 * Every fixture below is the real stored shape.
 */
import { describe, expect, it } from 'vitest'
import { SITE_LOCATION_FALLBACK_KEY, buildVCard, cardAddressLine, cardSiteLocations, hasCardAddress, resolveShow } from '../model'
import { siteCardView, siteLocations, siteVCardInput } from '../website'
import { previewCardView } from '../preview'
import type { DigitalCardSiteResult } from '../projection'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'

/** As stored in hoffmann-site-config (published, 2026-11-09). */
const HOFFMANN_LOCATION = { _type: 'businessLocation', city: 'Varese', country: 'Italia', postalCode: '21100', state: 'VA', street: 'Via Amendola 11' }

const card = (over: Partial<DigitalCardSiteResult> = {}): DigitalCardSiteResult => ({
  publicId: '11111111-1111-4111-8111-111111111111',
  kind: 'site',
  description: 'Sono Claudia Hoffmann, psicoterapeuta a Varese.',
  links: [],
  background: null,
  // The stored switches of her card: no `locations` key → every location is shown by default.
  show: { description: true, phone: true } as never,
  site: { siteName: 'Dott.ssa Claudia Hoffmann', socialLinks: null, locations: null, location: HOFFMANN_LOCATION as never },
  project: { customDomain: 'ch-psicoterapeuta.com', enabledModules: ['digital-cards'] },
  ...over,
})
const messages = getDigitalCardSiteMessages('it')

describe('model: the single address as a location', () => {
  it('recognises the businessLocation shape and writes one line for the editor', () => {
    expect(hasCardAddress(HOFFMANN_LOCATION)).toBe(true)
    expect(hasCardAddress({ _type: 'businessLocation' })).toBe(false)
    expect(hasCardAddress(null)).toBe(false)
    expect(cardAddressLine(HOFFMANN_LOCATION)).toBe('Via Amendola 11, 21100 Varese VA')
  })

  it('locations[] wins; empty or null falls back to the single address; nothing when neither', () => {
    const make = (address: object, key: string) => ({ _key: key, address })
    expect(cardSiteLocations([{ _key: 'l1', address: {} }], HOFFMANN_LOCATION, make)).toEqual([{ _key: 'l1', address: {} }])
    expect(cardSiteLocations(null, HOFFMANN_LOCATION, make)).toEqual([
      { _key: SITE_LOCATION_FALLBACK_KEY, address: { street: 'Via Amendola 11', postalCode: '21100', city: 'Varese', state: 'VA', country: 'Italia' } },
    ])
    expect(cardSiteLocations([], HOFFMANN_LOCATION, make)).toHaveLength(1)
    expect(cardSiteLocations(null, null, make)).toEqual([])
  })
})

describe('website card + vCard with Hoffmann’s settings', () => {
  it('the card shows the address (switch on by default)', () => {
    const view = siteCardView(card(), { locale: 'it', siteBase: '/it', messages })
    expect(view.locations).toEqual([{ key: SITE_LOCATION_FALLBACK_KEY, name: null, lines: ['Via Amendola 11', '21100 Varese VA', 'Italia'], mapsUrl: null }])
  })

  it('turned off in the editor (show.locations without the key) → not shown', () => {
    const view = siteCardView(card({ show: { locations: [] } as never }), { locale: 'it', siteBase: '/it', messages })
    expect(view.locations).toEqual([])
  })

  it('the vCard carries it as ADR', () => {
    const input = siteVCardInput(card(), 'https://www.ch-psicoterapeuta.com')
    expect(input.address).toMatchObject({ street: 'Via Amendola 11', postalCode: '21100', city: 'Varese', state: 'VA', country: 'Italia' })
    expect(buildVCard(input).split('\r\n')).toContain('ADR;TYPE=WORK:;;Via Amendola 11;Varese;VA;21100;Italia')
  })

  it('resolveShow with the fallback key available keeps it on by default', () => {
    expect(resolveShow('site', { description: true }, { locations: siteLocations(card().site).map((l) => l._key) }).locations).toEqual([SITE_LOCATION_FALLBACK_KEY])
  })

  it('the live preview shows it too (same view model)', () => {
    const base = {
      locale: 'de',
      defaultLocale: 'it',
      site: card().site!,
      project: card().project!,
      person: null,
      siteCard: null,
      pages: {},
      files: {},
      background: null,
      theme: { css: '', fontsUrl: null },
      motion: null,
    } as never
    const view = previewCardView('site', 'p', { description: {}, links: [], backgroundId: null, show: { description: true }, urlName: '' }, base, getDigitalCardSiteMessages('de'))
    expect(view?.locations.map((l) => l.lines[0])).toEqual(['Via Amendola 11'])
  })
})
