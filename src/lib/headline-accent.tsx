// ─── Headline accent ──────────────────────────────────────────────────────────
//
// Renders the LAST WORD of a section headline in the brand accent colour —
// "…for Hospitality **Platforms.**". A platform-wide, opt-in feature: every
// section that has a headline/title carries an optional `headlineAccent`
// field whose default is 'none', so every document authored before this
// existed renders byte-identically (the helper returns the raw string
// untouched for 'none', undefined and null).
//
// Colour is `var(--color-primary)` written as an inline style, deliberately:
// the hero paints its own `color` inline (white over full-bleed media), and an
// inline colour on the span is the only thing that reliably wins there. That
// matches the original site, which accents over its hero video too.
//
// Language-agnostic: the split is positional (last whitespace run), never a
// dictionary or word list, so a translated headline accents its own last word.

import type { ReactNode } from 'react'

/** Enum stored by the `headlineAccent` schema field. */
export type HeadlineAccent = 'none' | 'lastWord'

/** Inline style applied to the accented word. */
export const HEADLINE_ACCENT_STYLE = { color: 'var(--color-primary)' } as const

/**
 * Split a headline at its final whitespace.
 *
 * `head` keeps the separating whitespace so re-joining head + accent is
 * lossless (important for `white-space: pre-line` headlines, where a trailing
 * "\n" in `head` is a real line break).
 *
 * Any whitespace counts as a separator — not just " " — so a multi-line
 * headline like "One line\nSecond line" accents "line" from the LAST line.
 *
 * Trailing whitespace is trimmed first (it would otherwise make the "last
 * word" empty). A one-word headline yields an empty `head` and accents the
 * whole thing; an empty/whitespace-only headline yields two empty strings.
 */
export function splitLastWord(text: string): { head: string; accent: string } {
  const trimmed = text.trimEnd()
  if (trimmed === '') return { head: '', accent: '' }
  const match = /^([\s\S]*\s)(\S+)$/.exec(trimmed)
  if (!match) return { head: '', accent: trimmed }
  return { head: match[1], accent: match[2] }
}

/**
 * Index of the last line carrying non-whitespace content, or -1 when none do.
 *
 * The hero splits its headline on "\n" into `<span class="block">` lines and
 * renders each separately; the accent belongs to the last line that actually
 * has a word in it (a headline ending in a stray "\n" must not accent the
 * empty trailing line).
 */
export function lastContentLineIndex(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') return i
  }
  return -1
}

/**
 * Render a headline with the configured accent applied.
 *
 * Returns the input untouched for 'none' / undefined / null / empty, so
 * callers can swap `{title}` for `{renderHeadline(title, section.headlineAccent)}`
 * with zero change to existing output.
 */
export function renderHeadline(
  text: string | undefined | null,
  accent?: HeadlineAccent | null,
): ReactNode {
  if (!text || accent !== 'lastWord') return text
  const { head, accent: word } = splitLastWord(text)
  if (word === '') return text
  return (
    <>
      {head}
      <span style={HEADLINE_ACCENT_STYLE}>{word}</span>
    </>
  )
}
