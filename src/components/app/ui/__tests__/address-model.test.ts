import { describe, expect, it } from 'vitest'
import { formatStreetLine, parseAddressComponents, parsePlaceDetails, parseSuggestions } from '../address-model'

const c = (longText: string, shortText: string, ...types: string[]) => ({ longText, shortText, types, languageCode: 'it' })

/** Places API (New) addressComponents for "Via Roma, 1, 48015 Cervia RA, Italia". */
const ITALY = [
  c('1', '1', 'street_number'),
  c('Via Roma', 'Via Roma', 'route'),
  c('Cervia', 'Cervia', 'locality', 'political'),
  c('Cervia', 'Cervia', 'administrative_area_level_3', 'political'),
  c('Provincia di Ravenna', 'RA', 'administrative_area_level_2', 'political'),
  c('Emilia-Romagna', 'Emilia-Romagna', 'administrative_area_level_1', 'political'),
  c('Italia', 'IT', 'country', 'political'),
  c('48015', '48015', 'postal_code'),
]

/** "Südstraße 27, 80331 München, Deutschland". */
const GERMANY = [
  c('27', '27', 'street_number'),
  c('Südstraße', 'Südstr.', 'route'),
  c('Altstadt-Lehel', 'Altstadt-Lehel', 'sublocality_level_1', 'sublocality', 'political'),
  c('München', 'München', 'locality', 'political'),
  c('Oberbayern', 'Oberbayern', 'administrative_area_level_2', 'political'),
  c('Bayern', 'BY', 'administrative_area_level_1', 'political'),
  c('Deutschland', 'DE', 'country', 'political'),
  c('80331', '80331', 'postal_code'),
]

describe('parseAddressComponents', () => {
  it('Italy: route then number, province code as region', () => {
    expect(parseAddressComponents(ITALY)).toEqual({ addressLine1: 'Via Roma 1', postalCode: '48015', city: 'Cervia', region: 'RA', country: 'IT' })
  })
  it('Germany: route then number, state as region', () => {
    expect(parseAddressComponents(GERMANY)).toEqual({ addressLine1: 'Südstraße 27', postalCode: '80331', city: 'München', region: 'Bayern', country: 'DE' })
  })
  it('UK: number first, postal_town when there is no locality', () => {
    const uk = [c('10', '10', 'street_number'), c('Downing Street', 'Downing St', 'route'), c('London', 'London', 'postal_town'), c('England', 'England', 'administrative_area_level_1'), c('United Kingdom', 'GB', 'country'), c('SW1A 2AA', 'SW1A 2AA', 'postal_code')]
    expect(parseAddressComponents(uk)).toEqual({ addressLine1: '10 Downing Street', postalCode: 'SW1A 2AA', city: 'London', region: 'England', country: 'GB' })
  })
  it('US: state code', () => {
    const us = [c('1600', '1600', 'street_number'), c('Amphitheatre Parkway', 'Amphitheatre Pkwy', 'route'), c('Mountain View', 'Mountain View', 'locality'), c('California', 'CA', 'administrative_area_level_1'), c('United States', 'US', 'country')]
    expect(parseAddressComponents(us)).toMatchObject({ addressLine1: '1600 Amphitheatre Parkway', region: 'CA', country: 'US', postalCode: null })
  })
  it('city falls back to administrative_area_level_3', () => {
    expect(parseAddressComponents([c('Pinarella', 'Pinarella', 'administrative_area_level_3'), c('Italia', 'IT', 'country')]).city).toBe('Pinarella')
  })
  it('malformed input gives an empty address, never throws', () => {
    const empty = { addressLine1: null, postalCode: null, city: null, region: null, country: null }
    expect(parseAddressComponents(null)).toEqual(empty)
    expect(parseAddressComponents([1, 'x', { types: 'route' }])).toEqual(empty)
    expect(parsePlaceDetails({})).toEqual(empty)
    expect(parsePlaceDetails({ addressComponents: ITALY }).country).toBe('IT')
  })
})

describe('formatStreetLine', () => {
  it('orders by country and tolerates missing parts', () => {
    expect(formatStreetLine('Via Roma', '1', 'IT')).toBe('Via Roma 1')
    expect(formatStreetLine('rue de la Paix', '12', 'FR')).toBe('12 rue de la Paix')
    expect(formatStreetLine('Via Roma', null, 'IT')).toBe('Via Roma')
    expect(formatStreetLine(null, '5', 'IT')).toBe('5')
    expect(formatStreetLine(null, null, 'IT')).toBeNull()
  })
})

describe('parseSuggestions', () => {
  it('reads place predictions and skips anything else', () => {
    const json = {
      suggestions: [
        { placePrediction: { placeId: 'abc', text: { text: 'Via Roma, 1, Cervia RA, Italia' }, structuredFormat: { mainText: { text: 'Via Roma, 1' }, secondaryText: { text: 'Cervia RA, Italia' } } } },
        { queryPrediction: { text: { text: 'via roma' } } },
        { placePrediction: { placeId: 'def', text: { text: 'Südstraße 27, München' } } },
        { placePrediction: { text: { text: 'no id' } } },
      ],
    }
    expect(parseSuggestions(json)).toEqual([
      { placeId: 'abc', primary: 'Via Roma, 1', secondary: 'Cervia RA, Italia' },
      { placeId: 'def', primary: 'Südstraße 27, München', secondary: '' },
    ])
    expect(parseSuggestions(null)).toEqual([])
    expect(parseSuggestions({ suggestions: 'x' })).toEqual([])
  })
})
