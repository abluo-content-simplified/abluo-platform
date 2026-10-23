/**
 * Partial redaction (ADR-039 round 3) — turning what the admin picks on screen
 * into [start, end) ranges of the plain message body. Pure and client-safe.
 *
 * The text is rendered as consecutive pieces, each carrying the offset where it
 * starts in the body (`data-start`). A DOM selection point is (piece, offset in
 * that piece's text), so its absolute position is `pieceStart + offset`.
 */
import { normalizeRanges, REDACTION_MASK, type RedactionRange } from './redaction'

export type SelectionPoint = { pieceStart: number; offset: number }

/** The range between two selection points (either order). null when empty or outside the body. */
export function rangeFromPoints(a: SelectionPoint, b: SelectionPoint, length: number): RedactionRange | null {
  const x = a.pieceStart + a.offset
  const y = b.pieceStart + b.offset
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const [r] = normalizeRanges([{ start: Math.min(x, y), end: Math.max(x, y) }], length)
  return r ?? null
}

/** Adds a range to the chosen ones (merged, sorted). */
export function addRange(ranges: RedactionRange[], range: RedactionRange, length: number): RedactionRange[] {
  return normalizeRanges([...ranges, range], length)
}

/** Takes a range out of the chosen ones (cuts partly covered ranges). */
export function subtractRange(ranges: RedactionRange[], range: RedactionRange, length: number): RedactionRange[] {
  const out: RedactionRange[] = []
  for (const r of normalizeRanges(ranges, length)) {
    if (range.end <= r.start || range.start >= r.end) out.push(r)
    else {
      if (range.start > r.start) out.push({ start: r.start, end: range.start })
      if (range.end < r.end) out.push({ start: range.end, end: r.end })
    }
  }
  return out
}

/** True when every character of the range is already chosen. */
export function isCovered(ranges: RedactionRange[], range: RedactionRange): boolean {
  return normalizeRanges(ranges, Number.MAX_SAFE_INTEGER).some((r) => r.start <= range.start && r.end >= range.end)
}

/** Tap on a word: chosen → un-chosen, otherwise chosen. */
export function toggleRange(ranges: RedactionRange[], range: RedactionRange, length: number): RedactionRange[] {
  return isCovered(ranges, range) ? subtractRange(ranges, range, length) : addRange(ranges, range, length)
}

/** A word that is already fully masked (█) has nothing left to hide. */
export function isMaskedWord(body: string, range: RedactionRange): boolean {
  return body.slice(range.start, range.end).split('').every((c) => c === REDACTION_MASK)
}

/** The number of characters that would be hidden (what `maskRanges` reports): not spaces, not existing marks. */
export function hiddenCount(body: string, ranges: RedactionRange[]): number {
  let n = 0
  for (const r of normalizeRanges(ranges, body.length)) for (let i = r.start; i < r.end; i++) if (!/\s/.test(body[i]) && body[i] !== REDACTION_MASK) n++
  return n
}

/** Splits a body into consecutive pieces (words and the space between them) with their start offsets. */
export function pieces(body: string): Array<{ start: number; text: string; word: boolean }> {
  const out: Array<{ start: number; text: string; word: boolean }> = []
  for (const m of body.matchAll(/\S+|\s+/g)) out.push({ start: m.index!, text: m[0], word: /\S/.test(m[0]) })
  return out
}
