/**
 * Font data for the generated social card (`opengraph-image.tsx`).
 *
 * Satori — the renderer behind `next/og`'s ImageResponse — does NOT use system
 * fonts. It rasterises from font data you hand it, so a card cannot be drawn
 * without fetching a real font file first. That is the whole reason this file
 * exists.
 *
 * ── Why Google Fonts, and why a 2011 Safari user-agent ───────────────────────
 * Every design system's heading face is either `source: 'google'` with a family
 * name, or `source: 'library'` with a name that is also published on Google
 * Fonts (Geist, Barlow Condensed). One fetch path covers both.
 *
 * The css2 endpoint serves WOFF2 to modern browsers, and Satori cannot read
 * WOFF2. Sending an old Safari UA makes Google serve the legacy format
 * instead — in practice WOFF, which Satori reads fine (it supports ttf, otf
 * and woff; only woff2 is out).
 *
 * VERIFIED 2026-10-13 against all six families in use (Oswald, Syne, EB
 * Garamond, Geist, Barlow Condensed, Inter): every one came back `format('woff')`,
 * none came back truetype. Matching truetype alone — the shape most examples
 * of this trick use — matches nothing, falls through to the fallback, fails
 * that too, and 503s every card. Hence both formats below, woff2 excluded.
 *
 * ── Caching ──────────────────────────────────────────────────────────────────
 * The buffer is memoised per family+weight for the lifetime of the server
 * instance. A card is drawn once per URL and then cached by the CDN, so this
 * fetch happens a handful of times per deploy, not per share.
 */

/** Serves the legacy format (woff) rather than WOFF2, which Satori cannot parse. */
const TTF_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.59.8 (KHTML, like Gecko) Version/5.1.9 Safari/534.59.8'

/** Used when the tenant's own face cannot be fetched. Always available. */
export const FALLBACK_FAMILY = 'Inter'

const cache = new Map<string, ArrayBuffer | null>()

/**
 * The family name to draw a tenant's card in.
 *
 * `library` fonts carry their name in `libraryFont`, Google ones in
 * `googleFont`. Either way it is a family name Google Fonts knows. Null when
 * the design system declares no heading face, so the caller falls back.
 */
export function headingFamily(
  headingFont: { source?: string | null; googleFont?: string | null; libraryFont?: string | null } | null | undefined
): string | null {
  if (!headingFont) return null
  const name = headingFont.source === 'google' ? headingFont.googleFont : headingFont.libraryFont
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Pure: the first font URL Satori can actually parse out of a css2 response.
 *
 * Accepts `truetype` and `woff`, never `woff2` — the negative case is the one
 * that matters, so it is asserted in the tests. TrueType is preferred when the
 * endpoint offers both, otherwise the first woff wins.
 */
export function firstUsableFontUrl(css: string): string | null {
  const ttf = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]truetype['"]\)/)
  if (ttf) return ttf[1]
  const woff = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]woff['"]\)/)
  return woff ? woff[1] : null
}

/**
 * Two attempts, and the second is not optional.
 *
 * A single-weight family has no 700, and css2 answers `400 Bad Request` for an
 * axis it does not publish — Varela (Amélie's heading face) is exactly this:
 * `family=Varela:wght@700` is a 400, `family=Varela` returns the font. Asking
 * without the axis gets whatever weight the family does have, which is the
 * right answer for a card.
 */
async function fetchFamily(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`
  if (cache.has(key)) return cache.get(key) ?? null

  const urls = [
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}`,
  ]

  for (const cssUrl of urls) {
    try {
      const cssRes = await fetch(cssUrl, { headers: { 'User-Agent': TTF_UA } })
      if (!cssRes.ok) continue
      const url = firstUsableFontUrl(await cssRes.text())
      if (!url) continue
      const fontRes = await fetch(url)
      if (!fontRes.ok) continue
      const buf = await fontRes.arrayBuffer()
      cache.set(key, buf)
      return buf
    } catch {
      // Try the next shape; a missing face must never fail the whole card.
    }
  }

  cache.set(key, null)
  return null
}

/**
 * The tenant's heading face, or the fallback, or null if even that is
 * unreachable (the caller then has no font and must not render).
 */
export async function loadCardFont(family: string | null, weight = 700): Promise<{ family: string; data: ArrayBuffer } | null> {
  if (family) {
    const data = await fetchFamily(family, weight)
    if (data) return { family, data }
  }
  const fallback = await fetchFamily(FALLBACK_FAMILY, weight)
  return fallback ? { family: FALLBACK_FAMILY, data: fallback } : null
}
