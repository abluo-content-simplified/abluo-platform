// ─── Multi-line plain text on the website ────────────────────────────────────
//
// Editors type line breaks (Return / Shift+Return) into multi-line plain-text
// fields — Sanity `text` and `localizedText` (short descriptions, intros, bios,
// CTA bodies, notes, …). They are stored as "\n", and a browser folds a "\n"
// into an ordinary space unless the element keeps it. Every website element
// that renders such a field adds MULTILINE_TEXT (via `multiline()`), so a break
// the editor typed is a break the visitor sees.
//
// `white-space: pre-line` keeps newlines but still collapses runs of spaces and
// wraps long lines normally, so text WITHOUT a "\n" renders exactly as before.
// It also works with Tailwind's `line-clamp-*`; for clamped card previews use
// `previewLines()` too, so a blank line between paragraphs does not use up one
// of the few visible lines.
//
// Not for things that must stay on one line: <title>, meta descriptions,
// JSON-LD, Open Graph, alt text, e-mails. Single-line `string` /
// `localizedString` fields and Portable Text (which renders its own breaks) do
// not need it either.

/** Tailwind class that turns typed line breaks into visible ones. */
export const MULTILINE_TEXT = 'whitespace-pre-line'

/** `className` for an element showing multi-line plain text: MULTILINE_TEXT plus the element's own classes. */
export function multiline(className?: string | null): string {
  const rest = className?.trim()
  return rest ? `${MULTILINE_TEXT} ${rest}` : MULTILINE_TEXT
}

/**
 * Text for a short, line-clamped preview (listing cards). Keeps single line
 * breaks, turns a paragraph gap (blank lines) into one break and trims the
 * ends, so the clamp spends its lines on words, not on empty lines.
 */
export function previewLines(text: string): string
export function previewLines(text: string | null | undefined): string | null | undefined
export function previewLines(text: string | null | undefined): string | null | undefined {
  if (typeof text !== 'string') return text
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
