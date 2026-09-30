/**
 * Abluo Maps Provider — platform abstraction for map embedding.
 *
 * All map rendering in Abluo goes through this module.
 * The Contact Section (and any future section that shows a map) calls these
 * functions — it never constructs URLs directly or knows which provider is used.
 *
 * ── v1 Provider: Google Maps Embed API ───────────────────────────────────────
 * Requires NEXT_PUBLIC_GOOGLE_MAPS_KEY set in Vercel environment variables
 * (and .env.local). One PUBLIC key per platform, API-restricted to the Maps
 * Embed API only — see docs/engineering/google-maps-keys.md. Without it every
 * map degrades silently to its "Open in Google Maps" link.
 *
 * Every embed is click-to-load behind ConsentEmbed (ADR-021, vendor
 * `google-maps`): no request reaches Google before the visitor asks for it.
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

/** The public Maps Embed API key, or null when it is not configured. */
export function getMapsEmbedKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY?.trim()
  return key ? key : null
}

export interface MapEmbedUrlOptions {
  /** A place search ("Rue de la Loi 200, Brussels") or coordinates ("50.84,4.38"). */
  query: string | null | undefined
  /** Maps Embed API key. Missing/blank → null (callers degrade to a link). */
  apiKey: string | null | undefined
  /** 0–21. Omitted → Google picks a zoom that fits the place. */
  zoom?: number
  /** UI language of the map, e.g. "fr". */
  language?: string
}

/**
 * Pure builder for a Google Maps Embed API (`/maps/embed/v1/place`) URL.
 * Returns null — never throws — when the key or the query is missing, so every
 * caller can fall back to its link-only rendering.
 */
export function buildMapEmbedUrl({ query, apiKey, zoom, language }: MapEmbedUrlOptions): string | null {
  const key = apiKey?.trim()
  const q = query?.trim()
  if (!key || !q) return null
  const params = new URLSearchParams({ key, q })
  if (typeof zoom === 'number' && Number.isFinite(zoom)) {
    params.set('zoom', String(Math.min(21, Math.max(0, Math.round(zoom)))))
  }
  const lang = language?.trim()
  if (lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) params.set('language', lang)
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`
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
  return buildMapEmbedUrl({ query: addressQuery, apiKey: getMapsEmbedKey() })
}

/**
 * Returns a deep link that opens the address in Google Maps (or the native
 * Maps app on iOS/Android). Always works — no API key required.
 * Used as the `href` on the map iframe wrapper so clicking opens full Maps.
 */
export function getMapsDeepLink(addressQuery: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(addressQuery)}`
}
