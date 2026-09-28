// ─── Self-hosted Google Fonts (ADR-021 follow-up) ────────────────────────────
//
// Visitors' browsers must never contact Google for fonts: that sends their IP
// address to Google before any consent (LG München, 20 Jan 2022, 3 O 17493/20).
// Abluo serves the same css2 stylesheet and font files from its own domain
// under /api/fonts/* — our server fetches from Google once, the CDN caches it,
// and visitors only ever talk to the site's own host.
//
// Pure helpers here; the two route handlers are thin wrappers around them.

export const FONTS_CSS_ENDPOINT = '/api/fonts/css'
export const FONTS_FILE_PREFIX = '/api/fonts/file/'

const GOOGLE_CSS = 'https://fonts.googleapis.com/css2'
const GSTATIC = 'https://fonts.gstatic.com/'

// css2 family syntax: "Name+With+Spaces" or "Name:wght@400;700" / ":ital,wght@0,400;1,400"
const FAMILY_RE = /^[A-Za-z0-9 +]{1,64}(:[a-z,]{1,16}@[0-9.,;]{1,200})?$/
const DISPLAY_VALUES = new Set(['auto', 'block', 'swap', 'fallback', 'optional'])

/**
 * Validates an incoming css query and returns the upstream Google URL, or
 * null when anything unexpected is present — the endpoint is not an open proxy.
 */
export function upstreamCssUrl(search: URLSearchParams): string | null {
  const families = search.getAll('family')
  if (families.length === 0 || families.length > 4) return null
  for (const [key] of search) if (key !== 'family' && key !== 'display') return null
  if (!families.every((f) => FAMILY_RE.test(f))) return null
  const display = search.get('display')
  if (display !== null && !DISPLAY_VALUES.has(display)) return null
  const qs = families.map((f) => `family=${f.replace(/ /g, '+')}`)
  if (display) qs.push(`display=${display}`)
  return `${GOOGLE_CSS}?${qs.join('&')}`
}

/** Points every font file in Google's stylesheet at our own file endpoint. */
export function rewriteFontUrls(css: string): string {
  return css.split(GSTATIC).join(FONTS_FILE_PREFIX)
}

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/
const FONT_EXT_RE = /\.(woff2|woff|ttf|otf)$/

/** Validates a font file path from /api/fonts/file/<...path> → upstream URL or null. */
export function upstreamFileUrl(segments: string[]): string | null {
  if (segments.length === 0 || segments.length > 8) return null
  if (!segments.every((s) => SEGMENT_RE.test(s) && s !== '.' && s !== '..')) return null
  if (!FONT_EXT_RE.test(segments[segments.length - 1])) return null
  return GSTATIC + segments.join('/')
}

export const FONT_CONTENT_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/**
 * Google serves woff2 + unicode-range subsets only to browsers it recognises,
 * keyed on User-Agent. We always ask as a current evergreen browser — every
 * browser Abluo supports reads woff2.
 */
export const MODERN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
