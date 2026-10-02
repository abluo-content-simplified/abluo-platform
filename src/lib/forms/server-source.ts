/**
 * Server-derived attribution — the keys the submission route adds to `source`
 * itself, from request headers, AFTER the client's object (so a client can
 * never supply them).
 *
 *   device_type  coarse class from the user-agent (mobile / tablet / desktop);
 *                the user-agent itself is never stored.
 *   country      `x-vercel-ip-country`         (ISO 3166-1 alpha-2)
 *   region       `x-vercel-ip-country-region`  (ISO 3166-2 subdivision code)
 *   city         `x-vercel-ip-city`            (URI-encoded by Vercel)
 *
 * The geo values are Vercel's IP-based estimate; the IP itself is stored
 * separately in `submitter_ip` for spam rate-limiting only (unchanged).
 * Absent headers (local dev, non-Vercel hosts) simply produce no key.
 */

/** Keys only the server may set — the route drops any client-sent value for them. */
export const SERVER_SOURCE_KEYS = ['device_type', 'country', 'region', 'city'] as const

const MAX_GEO_LENGTH = 128

/** Decodes (when encoded), strips control characters, trims and bounds one geo header. */
export function sanitizeGeoHeader(raw: string | null | undefined, decode = false): string | null {
  if (!raw) return null
  let v = raw
  if (decode) {
    try {
      v = decodeURIComponent(v)
    } catch {
      // Malformed escape — keep the raw value rather than lose the city.
    }
  }
  // eslint-disable-next-line no-control-regex
  v = v.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!v) return null
  return v.length > MAX_GEO_LENGTH ? v.slice(0, MAX_GEO_LENGTH) : v
}

export function deviceTypeFromUserAgent(ua: string): 'mobile' | 'tablet' | 'desktop' {
  return /iPad|tablet|(android(?!.*mobile))/i.test(ua)
    ? 'tablet'
    : /Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
      ? 'mobile'
      : 'desktop'
}

export function serverSourceEnrichment(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {
    device_type: deviceTypeFromUserAgent(headers.get('user-agent') ?? ''),
  }
  const country = sanitizeGeoHeader(headers.get('x-vercel-ip-country'))
  const region = sanitizeGeoHeader(headers.get('x-vercel-ip-country-region'))
  const city = sanitizeGeoHeader(headers.get('x-vercel-ip-city'), true)
  if (country) out.country = country
  if (region) out.region = region
  if (city) out.city = city
  return out
}
