// ─── Google Fonts URL ─────────────────────────────────────────────────────────
//
// Extracted from the website layout so the emitted css2 request is unit-
// testable: a wrong weight here silently 400s the whole stylesheet and the
// page renders in fallback fonts, which is exactly the kind of regression a
// test should catch rather than a browser.

/**
 * Map of fonts that need non-standard weight/style variants on Google Fonts.
 *
 * WHY PER-FAMILY AND NOT A WIDER DEFAULT: Google Fonts rejects the whole
 * `css2` request with a 400 when an axis value a family does not publish is
 * asked for — one bad weight kills every family in the URL, so the page loads
 * no webfonts at all. Families differ wildly (Syne stops at 800, Barlow
 * Condensed at 700, Geist runs 100–900), so widening DEFAULT_FONT_WEIGHTS
 * would break every static or narrow-range family a tenant picks. The default
 * stays at the four weights essentially every family publishes, and any family
 * we actually want heavier or lighter cuts of gets an explicit, verified entry
 * here. Adding a family to this map is the supported way to widen its range.
 */
export const FONT_WEIGHT_PARAMS: Record<string, string> = {
  'Geist': 'wght@100;200;300;400;500;600;700;800;900',
  'Barlow Condensed': 'ital,wght@0,400;0,500;0,600;0,700;1,400',
  'Poppins': 'wght@300;400;500;600;700',
  'Playfair Display': 'ital,wght@0,400;0,600;0,700;1,400',
  'Lora': 'ital,wght@0,400;0,600;0,700;1,400',
  // Syne's variable axis is 400–800. 800 is what the No!Logo display face uses
  // for its hero headline — without it the browser synthesises or falls back to
  // 700 and headings render visibly lighter than the design.
  'Syne': 'wght@400;500;600;700;800',
  // DM Sans publishes a 100–1000 axis; 300 gives the lighter body/label cuts.
  'DM Sans': 'wght@300;400;500;600;700',
}

/** Weights requested for any family without an explicit entry above. */
export const DEFAULT_FONT_WEIGHTS = 'wght@400;500;600;700'

export function fontToGoogleParam(name: string): string {
  const params = FONT_WEIGHT_PARAMS[name] ?? DEFAULT_FONT_WEIGHTS
  return `${name.replace(/ /g, '+')}:${params}`
}

export function buildGoogleFontsUrl(headingFont: string, bodyFont: string): string {
  const families: string[] = []
  families.push(fontToGoogleParam(headingFont))
  if (bodyFont !== headingFont) families.push(fontToGoogleParam(bodyFont))
  if (!families.length) return ''
  return `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f}`).join('&')}&display=swap`
}
