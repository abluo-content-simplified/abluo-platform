import { describe, it, expect } from 'vitest'
import { getLocationMapsLink, formatLocationAddress, selectLocations, LOCATION_KEY_PATTERN } from '../locations'
import type { SiteLocation } from '@/lib/sanity/types'

const address = { street: 'Rue de la Loi 200', postalCode: '1049', city: 'Brussels', country: 'Belgium' }

describe('getLocationMapsLink — resolution order', () => {
  it('1. a pasted Maps link wins over pin and address', () => {
    expect(
      getLocationMapsLink({ mapsUrl: 'https://maps.app.goo.gl/abc123', pin: { lat: 50.8, lng: 4.4 }, address }),
    ).toBe('https://maps.app.goo.gl/abc123')
  })

  it('2. the pin wins over the address', () => {
    expect(getLocationMapsLink({ pin: { lat: 50.8427, lng: 4.3826 }, address })).toBe(
      'https://maps.google.com/?q=50.8427%2C4.3826',
    )
  })

  it('3. the address is the fallback', () => {
    expect(getLocationMapsLink({ address })).toBe(
      `https://maps.google.com/?q=${encodeURIComponent('Rue de la Loi 200, 1049, Brussels, Belgium')}`,
    )
  })

  it('4. nothing usable → null', () => {
    expect(getLocationMapsLink({})).toBeNull()
    expect(getLocationMapsLink(null)).toBeNull()
    expect(getLocationMapsLink({ address: { street: '  ' } })).toBeNull()
  })

  it('ignores a blank or non-http mapsUrl and falls through', () => {
    expect(getLocationMapsLink({ mapsUrl: '   ', address })).toContain('maps.google.com/?q=')
    expect(getLocationMapsLink({ mapsUrl: 'javascript:alert(1)', pin: { lat: 1, lng: 2 } })).toBe(
      'https://maps.google.com/?q=1%2C2',
    )
    expect(getLocationMapsLink({ mapsUrl: 'not a url' })).toBeNull()
  })

  it('ignores an incomplete or out-of-range pin', () => {
    expect(getLocationMapsLink({ pin: { lat: 50.8 }, address })).toContain(encodeURIComponent('Rue de la Loi'))
    expect(getLocationMapsLink({ pin: { lat: 91, lng: 4 } })).toBeNull()
    expect(getLocationMapsLink({ pin: { lat: Number.NaN, lng: 4 } })).toBeNull()
  })

  it('accepts a 0,0 pin (0 is a valid coordinate)', () => {
    expect(getLocationMapsLink({ pin: { lat: 0, lng: 0 } })).toBe('https://maps.google.com/?q=0%2C0')
  })
})

describe('formatLocationAddress', () => {
  it('formats street / postal code + city / country lines', () => {
    expect(formatLocationAddress(address)).toEqual(['Rue de la Loi 200', '1049 Brussels', 'Belgium'])
  })
  it('includes state when set and skips empty parts', () => {
    expect(formatLocationAddress({ city: 'Varese', state: 'VA', country: ' ' })).toEqual(['Varese', 'VA'])
    expect(formatLocationAddress({ postalCode: '21100' })).toEqual(['21100'])
  })
  it('empty or missing → []', () => {
    expect(formatLocationAddress(undefined)).toEqual([])
    expect(formatLocationAddress({})).toEqual([])
  })
})

describe('selectLocations', () => {
  const locs: SiteLocation[] = [
    { _key: 'a', key: 'brey', name: 'Breydel' },
    { _key: 'b', key: 'berl', name: 'Berlaymont' },
    { _key: 'c', key: 'loi', name: 'Loi 130' },
  ]
  it('all (and unset) → every location in authored order', () => {
    expect(selectLocations(locs, 'all', ['loi']).map((l) => l.key)).toEqual(['brey', 'berl', 'loi'])
    expect(selectLocations(locs, undefined, null).map((l) => l.key)).toEqual(['brey', 'berl', 'loi'])
  })
  it('pick → picked order, unknown and duplicate keys skipped', () => {
    expect(selectLocations(locs, 'pick', ['loi', 'nope', 'brey', 'loi']).map((l) => l.key)).toEqual(['loi', 'brey'])
  })
  it('pick with no keys → nothing', () => {
    expect(selectLocations(locs, 'pick', [])).toEqual([])
    expect(selectLocations(locs, 'pick', null)).toEqual([])
  })
  it('drops entries without a key and tolerates no locations', () => {
    expect(selectLocations([{ _key: 'x', key: '' }, ...locs], 'all', null)).toHaveLength(3)
    expect(selectLocations(undefined, 'all', null)).toEqual([])
  })
})

describe('LOCATION_KEY_PATTERN', () => {
  it('accepts slug keys and rejects anything that breaks a #fragment', () => {
    for (const ok of ['brey', 'rue-de-la-loi', 'site_2']) expect(LOCATION_KEY_PATTERN.test(ok)).toBe(true)
    for (const bad of ['Brey', '#brey', 'rue de la loi', '-x', 'x-', '']) expect(LOCATION_KEY_PATTERN.test(bad)).toBe(false)
  })
})
