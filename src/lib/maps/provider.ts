/**
 * Abluo Maps Provider — platform abstraction for map embedding.
 *
 * All map rendering in Abluo goes through this module.
 * The Contact Section (and any future section that shows a map) calls these
 * functions — it never constructs URLs directly or knows which provider is used.
 *
 * ── v1 Provider: Google Maps Embed API ───────────────────────────────────────
 * Requires NEXT_PUBLIC_GOOGLE_MAPS_KEY set in Vercel environment variables.
 * One key per platform, restricted to *.abluo.app and *.preview.abluo.app.
 *
 * ── Dark mode note ───────────────────────────────────────────────────────────
 * The Google Maps Embed API has no styling parameters — it always renders
 * the standard light map. The `mapTheme` setting is stored in Sanity and
 * accepted here for forward-compatibility. When a Maps JavaScript API
 * integration is added (Phase 2), dark-styled maps will work automatically
 * by switching the provider implementation — no Contact Section changes needed.
 *
 * ── Adding a new provider ────────────────────────────────────────────────────
 * 1. Add a new `getXxxEmbedUrl` function below.
 * 2. Update `getMapEmbedUrl` to select it based on a platform config flag.
 * 3. Contact Section and all other consumers require zero changes.
 */

export interface BusinessLocation {
  street?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
}

/**
 * Builds a geocodable address string from a structured location.
 * Falls back to the legacy flat `address` string if location is not yet populated.
 * Returns null if neither source has usable content.
 */
export function buildAddressQuery(
  location?: BusinessLocation | null,
  fallbackAddress?: string | null,
): string | null {
  if (location) {
    const parts = [
      location.street,
      location.postalCode,
      location.city,
      location.state,
      location.country,
    ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0)

    if (parts.length > 0) return parts.join(', ')
  }

  const trimmed = fallbackAddress?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

/**
 * Returns a Google Maps Embed API URL for the given address query.
 * Returns null when the API key is not configured or no address is available.
 *
 * The `_mapTheme` parameter is accepted but unused in v1 — the Embed API
 * does not support styling. It is kept for forward-compatibility so callers
 * do not need to change when dark mode is added in Phase 2.
 */
export function getMapEmbedUrl(
  addressQuery: string,
  _mapTheme?: 'auto' | 'light' | 'dark',
): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
  if (!key || !addressQuery.trim()) return null
  return `https://www.google.com/maps/embed/v1/place?key=${key}&q=${encodeURIComponent(addressQuery)}`
}

/**
 * Returns a deep link that opens the address in Google Maps (or the native
 * Maps app on iOS/Android). Always works — no API key required.
 * Used as the `href` on the map iframe wrapper so clicking opens full Maps.
 */
export function getMapsDeepLink(addressQuery: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`
}
