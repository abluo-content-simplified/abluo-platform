/**
 * Locations — pure helpers for siteConfig.locations[] (the editable list of a
 * website's places: yoga-class buildings, a clinic's practices, ...).
 *
 * Each location is edited by the client as content. What matters to a visitor
 * in a big building is the ENTRANCE, not the postal address, so the Google
 * Maps link resolves in this order:
 *
 *   1. mapsUrl — a Google Maps link the editor pasted (usually the entrance pin)
 *   2. pin     — the entrance coordinates (Sanity geopoint)
 *   3. address — a Maps search for the street address
 *   4. none    — the location renders without a link
 *
 * The link is a plain outbound LINK: nothing is loaded from Google until the
 * visitor clicks, so no cookies and no consent are involved.
 *
 * The optional live map (locationsSection.showMap) is a Google Maps EMBED and
 * resolves in the same order minus the pasted link, which cannot be embedded:
 *
 *   1. pin     — the entrance coordinates (zoomed in on the door)
 *   2. address — a Maps search for the street address
 *   3. none    — no map, link only
 *
 * The embed is click-to-load behind ConsentEmbed (ADR-021); without an embed
 * key it resolves to null and the card stays link-only.
 */

import { buildAddressQuery, buildMapEmbedUrl, getMapsDeepLink, getMapsEmbedKey, type BusinessLocation } from '@/lib/maps/provider'
import type { SiteLocation } from '@/lib/sanity/types'

/** The subset of a location the link resolution reads. */
export type LocationLinkSource = Pick<SiteLocation, 'mapsUrl' | 'pin' | 'address'>

/** Only http(s) links are ever emitted as an href — never javascript:, data:, … */
function safeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function validPin(pin: SiteLocation['pin']): { lat: number; lng: number } | null {
  if (!pin) return null
  const { lat, lng } = pin
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

/**
 * The "Open in Google Maps" href for a location, or null when the location
 * carries nothing a map could point at.
 */
export function getLocationMapsLink(location: LocationLinkSource | null | undefined): string | null {
  if (!location) return null

  const pasted = safeHttpUrl(location.mapsUrl)
  if (pasted) return pasted

  const pin = validPin(location.pin)
  if (pin) return getMapsDeepLink(`${pin.lat},${pin.lng}`)

  const addressQuery = buildAddressQuery(location.address)
  if (addressQuery) return getMapsDeepLink(addressQuery)

  return null
}

/** Zoom used when the map centres on an entrance pin — close enough to see the door. */
export const LOCATION_PIN_ZOOM = 17

/**
 * What the embedded map shows: the pin, else the address search, else nothing.
 * A pasted mapsUrl is ignored here — a share link cannot be embedded.
 */
export function getLocationMapQuery(
  location: Pick<SiteLocation, 'pin' | 'address'> | null | undefined,
): { query: string; zoom?: number } | null {
  if (!location) return null
  const pin = validPin(location.pin)
  if (pin) return { query: `${pin.lat},${pin.lng}`, zoom: LOCATION_PIN_ZOOM }
  const addressQuery = buildAddressQuery(location.address)
  if (addressQuery) return { query: addressQuery }
  return null
}

/**
 * The Maps Embed API URL for a location, or null (→ link-only card) when the
 * location has no pin/address or no embed key is configured. Never throws.
 * `apiKey` defaults to NEXT_PUBLIC_GOOGLE_MAPS_KEY; tests pass it explicitly.
 */
export function getLocationMapEmbedUrl(
  location: Pick<SiteLocation, 'pin' | 'address'> | null | undefined,
  options: { apiKey?: string | null; language?: string } = {},
): string | null {
  const target = getLocationMapQuery(location)
  if (!target) return null
  const apiKey = 'apiKey' in options ? options.apiKey : getMapsEmbedKey()
  return buildMapEmbedUrl({ query: target.query, zoom: target.zoom, apiKey, language: options.language })
}

/**
 * Display lines for an address:
 *   "Rue de la Loi 200"
 *   "1049 Brussels"
 *   "Belgium"
 * Empty parts are skipped; an empty address yields [].
 */
export function formatLocationAddress(address: BusinessLocation | null | undefined): string[] {
  if (!address) return []
  const clean = (v?: string) => (typeof v === 'string' ? v.trim() : '')
  const street = clean(address.street)
  const cityLine = [clean(address.postalCode), clean(address.city)].filter(Boolean).join(' ')
  return [street, cityLine, clean(address.state), clean(address.country)].filter(Boolean)
}

/**
 * The locations a section shows.
 *   'all'  (default) — every location, in the order they are listed in Website Settings.
 *   'pick'           — the given keys, in the order picked; unknown keys are skipped.
 * A 'pick' with no keys shows nothing (an editor who picked nothing asked for nothing).
 */
export function selectLocations(
  locations: SiteLocation[] | null | undefined,
  selection: 'all' | 'pick' | null | undefined,
  keys: string[] | null | undefined,
): SiteLocation[] {
  const all = (locations ?? []).filter((l) => !!l && typeof l.key === 'string' && l.key.length > 0)
  if (selection !== 'pick') return all
  const byKey = new Map(all.map((l) => [l.key, l]))
  const seen = new Set<string>()
  const picked: SiteLocation[] = []
  for (const k of keys ?? []) {
    const hit = byKey.get(k)
    if (hit && !seen.has(k)) {
      seen.add(k)
      picked.push(hit)
    }
  }
  return picked
}

/** The slug rule shared with anchor ids — the key doubles as the DOM id. */
export const LOCATION_KEY_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/
