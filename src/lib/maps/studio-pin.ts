/**
 * Studio entrance-pin picker — pure config for siteLocation.pin.
 *
 * The Studio map (Maps JavaScript API + Places, via @sanity/google-maps-input)
 * needs its own BROWSER key, NEXT_PUBLIC_GOOGLE_MAPS_STUDIO_KEY, HTTP-referrer
 * restricted to the Studio hosts. It is a different key from the website's
 * Maps Embed key (NEXT_PUBLIC_GOOGLE_MAPS_KEY). No key → null → the field
 * falls back to Sanity's plain latitude/longitude inputs. Never throws.
 * See docs/engineering/google-maps-keys.md.
 */

export interface StudioPinMapConfig {
  apiKey: string
  defaultLocation: { lat: number; lng: number }
  defaultZoom: number
  defaultLocale: string
}

/** Where the map opens when a location has no pin yet. */
export const STUDIO_PIN_DEFAULT_CENTER = { lat: 50.8467, lng: 4.3525 } // Brussels
/** City-level zoom for a new pin; close-up once a pin exists (the entrance). */
export const STUDIO_PIN_ZOOM_NEW = 12
export const STUDIO_PIN_ZOOM_EXISTING = 18

function finitePin(pin: { lat?: unknown; lng?: unknown } | null | undefined): { lat: number; lng: number } | null {
  if (!pin) return null
  const { lat, lng } = pin
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export function resolveStudioPinMapConfig(
  apiKey: string | null | undefined,
  currentPin?: { lat?: unknown; lng?: unknown } | null,
): StudioPinMapConfig | null {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!key) return null
  const pin = finitePin(currentPin)
  return {
    apiKey: key,
    // The plugin centres on the value when there is one; this is the fallback.
    defaultLocation: pin ?? STUDIO_PIN_DEFAULT_CENTER,
    defaultZoom: pin ? STUDIO_PIN_ZOOM_EXISTING : STUDIO_PIN_ZOOM_NEW,
    // Studio (admin) UI language is English — ADR-010.
    defaultLocale: 'en',
  }
}
