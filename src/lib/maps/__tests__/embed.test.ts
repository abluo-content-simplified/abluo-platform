import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildMapEmbedUrl, getMapEmbedUrl, getMapsEmbedKey } from '../provider'
import { getLocationMapEmbedUrl, getLocationMapQuery, LOCATION_PIN_ZOOM } from '../locations'
import { resolveStudioPinMapConfig, STUDIO_PIN_DEFAULT_CENTER, STUDIO_PIN_ZOOM_EXISTING, STUDIO_PIN_ZOOM_NEW } from '../studio-pin'

const address = { street: 'Rue de la Loi 200', postalCode: '1049', city: 'Brussels', country: 'Belgium' }
const KEY = 'test-embed-key'

function parse(url: string | null) {
  expect(url).not.toBeNull()
  const u = new URL(url as string)
  return { origin: u.origin, path: u.pathname, params: u.searchParams }
}

describe('buildMapEmbedUrl', () => {
  it('builds an official Maps Embed API place URL', () => {
    const { origin, path, params } = parse(buildMapEmbedUrl({ query: 'Rue de la Loi 200, Brussels', apiKey: KEY }))
    expect(origin).toBe('https://www.google.com')
    expect(path).toBe('/maps/embed/v1/place')
    expect(params.get('key')).toBe(KEY)
    expect(params.get('q')).toBe('Rue de la Loi 200, Brussels')
    expect(params.has('zoom')).toBe(false)
  })

  it('adds a clamped zoom and a valid language, ignores a bad language', () => {
    expect(parse(buildMapEmbedUrl({ query: '1,2', apiKey: KEY, zoom: 17, language: 'fr' })).params.get('zoom')).toBe('17')
    expect(parse(buildMapEmbedUrl({ query: '1,2', apiKey: KEY, zoom: 99 })).params.get('zoom')).toBe('21')
    expect(parse(buildMapEmbedUrl({ query: '1,2', apiKey: KEY, language: 'fr' })).params.get('language')).toBe('fr')
    expect(parse(buildMapEmbedUrl({ query: '1,2', apiKey: KEY, language: '"><x' })).params.has('language')).toBe(false)
  })

  it('encodes the query so it cannot inject parameters', () => {
    const { params } = parse(buildMapEmbedUrl({ query: 'A & B?key=evil', apiKey: KEY }))
    expect(params.get('q')).toBe('A & B?key=evil')
    expect(params.getAll('key')).toEqual([KEY])
  })

  it('returns null — never throws — without a key or a query', () => {
    expect(buildMapEmbedUrl({ query: 'Brussels', apiKey: undefined })).toBeNull()
    expect(buildMapEmbedUrl({ query: 'Brussels', apiKey: '   ' })).toBeNull()
    expect(buildMapEmbedUrl({ query: '', apiKey: KEY })).toBeNull()
    expect(buildMapEmbedUrl({ query: null, apiKey: KEY })).toBeNull()
  })
})

describe('getLocationMapQuery — pin, then address, then nothing', () => {
  it('the pin wins and zooms in on the entrance', () => {
    expect(getLocationMapQuery({ pin: { lat: 50.8427, lng: 4.3826 }, address })).toEqual({
      query: '50.8427,4.3826',
      zoom: LOCATION_PIN_ZOOM,
    })
  })
  it('the address is the fallback (no forced zoom)', () => {
    expect(getLocationMapQuery({ address })).toEqual({ query: 'Rue de la Loi 200, 1049, Brussels, Belgium' })
  })
  it('an invalid pin falls through to the address', () => {
    expect(getLocationMapQuery({ pin: { lat: 200, lng: 4 }, address })?.query).toContain('Rue de la Loi')
  })
  it('nothing usable → null (a pasted mapsUrl alone is link-only)', () => {
    expect(getLocationMapQuery({})).toBeNull()
    expect(getLocationMapQuery(null)).toBeNull()
  })
})

describe('getLocationMapEmbedUrl', () => {
  it('embeds the pin', () => {
    const { params } = parse(getLocationMapEmbedUrl({ pin: { lat: 50.8, lng: 4.4 }, address }, { apiKey: KEY, language: 'nl' }))
    expect(params.get('q')).toBe('50.8,4.4')
    expect(params.get('zoom')).toBe(String(LOCATION_PIN_ZOOM))
    expect(params.get('language')).toBe('nl')
  })
  it('embeds the address search when there is no pin', () => {
    expect(parse(getLocationMapEmbedUrl({ address }, { apiKey: KEY })).params.get('q')).toBe(
      'Rue de la Loi 200, 1049, Brussels, Belgium',
    )
  })
  it('key missing → null, so the card stays link-only', () => {
    expect(getLocationMapEmbedUrl({ pin: { lat: 50.8, lng: 4.4 } }, { apiKey: null })).toBeNull()
    expect(getLocationMapEmbedUrl({ address }, { apiKey: '' })).toBeNull()
  })
  it('no pin and no address → null even with a key', () => {
    expect(getLocationMapEmbedUrl({}, { apiKey: KEY })).toBeNull()
  })
})

describe('env key (NEXT_PUBLIC_GOOGLE_MAPS_KEY)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('unset or blank → null everywhere, no throw', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', '')
    expect(getMapsEmbedKey()).toBeNull()
    expect(getMapEmbedUrl('Brussels')).toBeNull()
    expect(getLocationMapEmbedUrl({ address })).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', '   ')
    expect(getLocationMapEmbedUrl({ address })).toBeNull()
  })

  it('set → used by default', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', KEY)
    expect(parse(getLocationMapEmbedUrl({ address })).params.get('key')).toBe(KEY)
    expect(parse(getMapEmbedUrl('Brussels')).params.get('q')).toBe('Brussels')
  })
})

describe('resolveStudioPinMapConfig — Studio picker fallback', () => {
  it('no key → null (plain lat/lng fields)', () => {
    expect(resolveStudioPinMapConfig(undefined)).toBeNull()
    expect(resolveStudioPinMapConfig('  ')).toBeNull()
  })
  it('new pin → Brussels at city zoom', () => {
    expect(resolveStudioPinMapConfig(' k ', undefined)).toEqual({
      apiKey: 'k',
      defaultLocation: STUDIO_PIN_DEFAULT_CENTER,
      defaultZoom: STUDIO_PIN_ZOOM_NEW,
      defaultLocale: 'en',
    })
  })
  it('existing pin → centred on it, close-up', () => {
    const c = resolveStudioPinMapConfig('k', { lat: 50.84, lng: 4.38 })
    expect(c?.defaultLocation).toEqual({ lat: 50.84, lng: 4.38 })
    expect(c?.defaultZoom).toBe(STUDIO_PIN_ZOOM_EXISTING)
  })
  it('a broken pin value falls back to Brussels', () => {
    expect(resolveStudioPinMapConfig('k', { lat: 'x', lng: 4 })?.defaultLocation).toEqual(STUDIO_PIN_DEFAULT_CENTER)
  })
})
