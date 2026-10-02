// ─── Headline accent ──────────────────────────────────────────────────────────
//
// Renders part of a section headline in the brand accent colour — the LAST
// WORD ("…for Hospitality **Platforms.**"), the last word of EVERY line, or the
// whole headline (see HeadlineAccent below). A platform-wide, opt-in feature: every
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
// Why primary and not the design system's `accent` colour: primary is the
// bright brand colour, and the hero headline sits in white over a darkened
// photo/video in BOTH themes, so the accent has to stay readable on dark media.
// A design system's `accent` is often a DEEPER shade picked for small text on a
// light background (CYCE: #B84F06 on cream) — over a dark photo that would be
// dark-on-dark. It is also not emitted as a CSS variable at all today.
//
// Language-agnostic: the split is positional (last whitespace run), never a
// dictionary or word list, so a translated headline accents its own last word.

import { Fragment, type ReactNode } from 'react'

/**
 * Enum stored by the `headlineAccent` schema field.
 *
 *   none              no accent (also null / undefined / any unknown value)
 *   lastWord          last word of the LAST line
 *   lastWordEachLine  last word of EVERY line of a multi-line headline
 *                     ("…concentration? **Yoga!**" / "…with others? **Yoga!**")
 *   all               the whole headline ("**Enjoy your practice!**")
 */
export type HeadlineAccent = 'none' | 'lastWord' | 'lastWordEachLine' | 'all'

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
 * Whether line `index` of a headline the caller has already split on "\n"
 * (the hero does, to render each line as its own block) gets the accent.
 *
 *   lastWord                → only the last line with content (`lastLineIndex`)
 *   lastWordEachLine / all  → every line
 *   anything else           → none
 *
 * The caller then hands that single line to renderHeadline() with the same
 * accent value, which accents its last word (or all of it for 'all').
 */
export function accentsLine(
  accent: HeadlineAccent | string | null | undefined,
  index: number,
  lastLineIndex: number,
): boolean {
  if (accent === 'lastWord') return index === lastLineIndex
  return accent === 'lastWordEachLine' || accent === 'all'
}

/** Accent the last word of one line; returns the line untouched when it has none. */
function accentLastWord(text: string): ReactNode {
  const { head, accent: word } = splitLastWord(text)
  if (word === '') return text
  // The trimmed-off trailing whitespace is kept, so re-joining is lossless.
  const tail = text.slice(text.trimEnd().length)
  return (
    <>
      {head}
      <span style={HEADLINE_ACCENT_STYLE}>{word}</span>
      {tail}
    </>
  )
}

/**
 * Render a headline with the configured accent applied.
 *
 * Returns the input untouched for 'none' / undefined / null / empty AND for any
 * value this code does not know, so callers can swap `{title}` for
 * `{renderHeadline(title, section.headlineAccent)}` with zero change to
 * existing output, and content written for a newer renderer degrades to plain.
 */
export function renderHeadline(
  text: string | undefined | null,
  accent?: HeadlineAccent | string | null,
): ReactNode {
  if (!text) return text
  if (accent === 'lastWord') {
    const { head, accent: word } = splitLastWord(text)
    if (word === '') return text
    return (
      <>
        {head}
        <span style={HEADLINE_ACCENT_STYLE}>{word}</span>
      </>
    )
  }
  if (accent === 'lastWordEachLine') {
    // Split on "\n" only (the line separator every section uses with
    // white-space: pre-line); the newlines are re-emitted between the lines.
    const lines = text.split('\n')
    if (lines.length === 1) return accentLastWord(text)
    return (
      <>
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 ? '\n' : null}
            {accentLastWord(line)}
          </Fragment>
        ))}
      </>
    )
  }
  if (accent === 'all') {
    if (text.trim() === '') return text
    return <span style={HEADLINE_ACCENT_STYLE}>{text}</span>
  }
  return text
}
