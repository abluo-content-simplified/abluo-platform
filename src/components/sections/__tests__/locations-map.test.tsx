import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocationsSection } from '@/components/sections/LocationsSection'
import type { LocationsSection as LocationsSectionType, WebsiteSiteConfig } from '@/lib/sanity/types'

// ADR-021 — the live map is click-to-load: before consent the server HTML has
// the placeholder and NO iframe, so no request can reach Google.

const siteConfig = {
  locations: [
    { _key: 'a', key: 'brey', name: 'Breydel', pin: { lat: 50.8427, lng: 4.3826 } },
    { _key: 'b', key: 'loi', name: 'Loi', address: { street: 'Rue de la Loi 200', city: 'Brussels' } },
    { _key: 'c', key: 'link', name: 'Link only', mapsUrl: 'https://maps.app.goo.gl/abc' },
  ],
} as unknown as WebsiteSiteConfig

const section = (extra: Partial<LocationsSectionType> = {}) =>
  ({ _type: 'locationsSection', _key: 's', ...extra }) as LocationsSectionType

const html = (s: LocationsSectionType, locale = 'en') =>
  renderToStaticMarkup(
    <LocationsSection section={s} surface={'usePagePattern' as never} designSystem={null} siteConfig={siteConfig} locale={locale} />,
  )

const count = (h: string, needle: string) => h.split(needle).length - 1

describe('LocationsSection — live map behind consent', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('with a key: one "Show map" placeholder per mappable location, no iframe before consent', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', 'test-key')
    const out = html(section())
    expect(count(out, '>Show map<')).toBe(2)
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('google.com/maps/embed')
    expect(out).not.toContain('test-key')
    expect(count(out, 'Open in Google Maps')).toBe(3)
  })

  it('placeholder text is localized', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', 'test-key')
    expect(html(section(), 'fr')).toContain('Afficher la carte')
  })

  it('without a key: silently link-only', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', '')
    const out = html(section())
    expect(out).not.toContain('Show map')
    expect(count(out, 'Open in Google Maps')).toBe(3)
  })

  it('showMap: false turns the maps off; list layout works too', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_KEY', 'test-key')
    expect(html(section({ showMap: false }))).not.toContain('Show map')
    expect(count(html(section({ layout: 'list' })), '>Show map<')).toBe(2)
  })
})
