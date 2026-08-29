// ─── Text wordmark ────────────────────────────────────────────────────────────
//
// Renders `siteConfig.wordmarkText` with every character listed in
// `siteConfig.wordmarkAccent` painted in the brand accent colour — "No!Logo"
// with wordmarkAccent "!" draws the "!" in `var(--color-primary)`.
//
// Shared on purpose: the footer and the header both draw the same wordmark, so
// the accent rule lives here (neutral `src/lib/`) rather than inside either
// component. Pure and framework-free apart from the ReactNode return — the
// splitting logic is exported separately so it can be unit-tested without
// rendering.
//
// Colour is written as an inline style rather than a class: a wordmark can sit
// over a hero image or a coloured header, where an inline colour is the only
// thing that reliably wins (same reasoning as src/lib/headline-accent.tsx).
//
// Additive: `wordmarkText` is undefined on every tenant authored before the
// field existed, and `renderWordmark` returns null for it, so callers keep
// their existing image-logo / siteName fallbacks.

import type { ReactNode } from 'react'

/** Inline style applied to every accented character run. */
export const WORDMARK_ACCENT_STYLE = { color: 'var(--color-primary)' } as const

/**
 * The accent colour a wordmark uses when it sits in the footer.
 *
 * `--color-primary` is chosen against the page background, and the footer
 * paints itself with a different surface — on No!Logo's brand-orange footer the
 * orange "!" measured 1.24:1 against it, i.e. invisible. `--color-footer-accent`
 * is the same brand colour nudged toward the footer's ink only as far as AA
 * requires, so the accent still reads as the accent.
 */
export const FOOTER_WORDMARK_ACCENT_STYLE = { color: 'var(--color-footer-accent)' } as const

/** One run of consecutive characters that are either all accented or all not. */
export interface WordmarkSegment {
  text: string
  accent: boolean
}

/**
 * Split `text` into alternating accented / plain runs.
 *
 * Matching is per character and case-sensitive: `accentChars` is a bag of
 * characters, not a substring — "!" accents every "!" in the text, "oO"
 * accents every "o" and every "O". Order and duplicates in `accentChars` are
 * irrelevant.
 *
 * Iteration is by code point (`Array.from`), so an emoji or other astral
 * character is never split down the middle of its surrogate pair.
 *
 * Returns `[]` for empty/absent text, and a single plain segment when no
 * accent characters are configured or none of them occur — so a caller can
 * always render the segments and get the untouched string back.
 */
export function splitWordmark(
  text: string | undefined | null,
  accentChars?: string | null,
): WordmarkSegment[] {
  if (!text) return []

  const accents = new Set(Array.from(accentChars ?? ''))
  if (accents.size === 0) return [{ text, accent: false }]

  const segments: WordmarkSegment[] = []
  for (const char of Array.from(text)) {
    const accent = accents.has(char)
    const last = segments[segments.length - 1]
    if (last && last.accent === accent) last.text += char
    else segments.push({ text: char, accent })
  }
  return segments
}

/**
 * Render a wordmark with its accent characters coloured.
 *
 * Returns `null` when there is no text, so callers can write
 * `renderWordmark(cfg.wordmarkText, cfg.wordmarkAccent) ?? fallback`.
 *
 * Font, size and weight are the caller's business — this only owns the colour
 * split. `accentStyle` lets a caller on a non-page surface substitute a colour
 * resolved against that surface — the footer passes
 * FOOTER_WORDMARK_ACCENT_STYLE for exactly this reason.
 */
export function renderWordmark(
  text: string | undefined | null,
  accentChars?: string | null,
  accentStyle: { color: string } = WORDMARK_ACCENT_STYLE,
): ReactNode {
  const segments = splitWordmark(text, accentChars)
  if (segments.length === 0) return null
  return (
    <>
      {segments.map((segment, i) =>
        segment.accent ? (
          <span key={i} style={accentStyle}>
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  )
}
