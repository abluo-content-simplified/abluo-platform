/**
 * Platform fallback tokens — what a site renders for a token it has not set.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * These values used to be `??` literals inline in the website layout, and they
 * were not neutral: the dark background, primary, secondary and both font names
 * were Livener's brand, character-for-character. Verified 2026-09-03 against
 * Livener's design system document — `oklch(0.2309 0.0292 263.75deg)`,
 * `oklch(0.7886 0.1630 66.32deg)`, `Barlow Condensed`, `Poppins`, all identical.
 *
 * That made "no value set" mean "the first client's brand". Any tenant with a
 * gap silently rendered in someone else's colours, and nothing in the codebase
 * said so.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * A fallback must not be recognisable as anyone's brand. Every colour here is
 * ACHROMATIC — zero chroma, a grey — with one deliberate exception, NEUTRAL_
 * ACCENT, because an interface needs one accent to be usable at all and a grey
 * button reads as disabled. `__tests__/fallback-tokens.test.ts` enforces both
 * halves of that rule and fails if a fallback ever drifts toward a real palette.
 *
 * A tenant seeing these is a BUG REPORT, not a design: it means their design
 * system is incomplete. Neutral grey makes that obvious on sight. Livener's
 * amber made it invisible for months.
 */

/** The one non-grey fallback: a desaturated slate-teal owned by nobody. */
export const NEUTRAL_ACCENT = 'oklch(0.62 0.045 220deg)'

export const FALLBACK_DARK = {
  background:    'oklch(0.19 0 0)',
  backgroundAlt: 'oklch(0.23 0 0)',
  surface:       'oklch(0.23 0 0)',
  primary:       NEUTRAL_ACCENT,
  secondary:     'oklch(0.45 0 0)',
  textPrimary:   'oklch(0.96 0 0)',
  textSecondary: 'oklch(0.96 0 0 / 0.55)',
  textMuted:     'oklch(0.96 0 0 / 0.4)',
  border:        'oklch(1 0 0 / 0.1)',
} as const

export const FALLBACK_LIGHT = {
  background:    'oklch(0.98 0 0)',
  backgroundAlt: 'oklch(0.95 0 0)',
  surface:       'oklch(1 0 0)',
  primary:       NEUTRAL_ACCENT,
  secondary:     'oklch(0.55 0 0)',
  textPrimary:   'oklch(0.15 0 0)',
  textSecondary: 'oklch(0.15 0 0 / 0.55)',
  textMuted:     'oklch(0.15 0 0 / 0.4)',
  border:        'oklch(0 0 0 / 0.1)',
} as const

/** Semantic states. Not brand colours — red means error on every site. */
export const FALLBACK_STATE = {
  successDark: 'oklch(0.62 0.18 145)',
  warningDark: 'oklch(0.75 0.15 80)',
  dangerDark:  'oklch(0.6 0.22 25)',
  successLight: 'oklch(0.55 0.18 145)',
  warningLight: 'oklch(0.65 0.15 80)',
  dangerLight:  'oklch(0.55 0.22 25)',
} as const

/**
 * System font stacks. Previously `Barlow Condensed` / `Poppins` — Livener's
 * two fonts. A fallback font must not be a typeface choice: it must be whatever
 * the reader's device already has.
 */
export const FALLBACK_FONTS = {
  heading: 'system-ui',
  body: 'system-ui',
} as const

/** Shape and rhythm. Matches `abluo-base-design-system`, the neutral template. */
export const FALLBACK_RADIUS = { small: 8, medium: 12, large: 16 } as const

/**
 * Brand values that must NEVER appear as a fallback. Each is a real token from
 * a real live tenant, recorded so the guard test has something concrete to
 * assert against. Add a row when a tenant is onboarded; never remove one.
 */
export const KNOWN_TENANT_BRAND_VALUES: readonly string[] = [
  'oklch(0.2309 0.0292 263.75deg)', // livener  colors.darkTheme.background
  'oklch(0.7886 0.1630 66.32deg)',  // livener  colors.darkTheme.primary
  'oklch(0.3515 0.0866 283.66deg)', // livener  colors.darkTheme.secondary
  'Barlow Condensed',               // livener  typography.headingFont
  'Poppins',                        // livener  typography.bodyFont
  '#C4432A',                        // hoffmann primary (poppy)
  '#5E8B73',                        // hoffmann secondary (sage)
  '#F7FAF8',                        // hoffmann background
  'EB Garamond',                    // hoffmann typography.headingFont
  'Mulish',                         // hoffmann typography.bodyFont
  'oklch(0.6369 0.1385 189.89deg)', // abluo dental primary
]
