/**
 * Partial redaction (ADR-039 round 3) — pure and client-safe.
 * Hidden characters are replaced one-for-one with the mask █ (U+2588), so the
 * text keeps its length and the reader sees how much was removed. The
 * database (support_ticket_redact_parts, migration 048) refuses any change
 * other than masking.
 */
export const REDACTION_MASK = '█'

export type RedactionRange = { start: number; end: number } // [start, end) in UTF-16 code units

/** Merges, clamps and sorts ranges; drops empty ones. */
export function normalizeRanges(ranges: RedactionRange[], length: number): RedactionRange[] {
  const clean = ranges
    .map((r) => ({ start: Math.max(0, Math.min(length, Math.floor(r.start))), end: Math.max(0, Math.min(length, Math.floor(r.end))) }))
    .map((r) => (r.start <= r.end ? r : { start: r.end, end: r.start }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start)
  const out: RedactionRange[] = []
  for (const r of clean) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else out.push({ ...r })
  }
  return out
}

/**
 * Masks the ranges. Whitespace and line breaks inside a range are kept, so
 * the layout survives; surrogate pairs (emoji) are masked as two marks, which
 * keeps the length identical to what the database compares.
 */
export function maskRanges(body: string, ranges: RedactionRange[]): { body: string; removed: number } {
  const merged = normalizeRanges(ranges, body.length)
  if (!merged.length) return { body, removed: 0 }
  let out = ''
  let removed = 0
  let at = 0
  for (const r of merged) {
    out += body.slice(at, r.start)
    for (let i = r.start; i < r.end; i++) {
      const ch = body[i]
      if (/\s/.test(ch) || ch === REDACTION_MASK) out += ch
      else { out += REDACTION_MASK; removed++ }
    }
    at = r.end
  }
  out += body.slice(at)
  return { body: out, removed }
}

/** Splits a body into plain text and masked runs, for rendering a grey bar per hidden part. */
export type BodySegment = { kind: 'text'; text: string } | { kind: 'masked'; length: number }

export function segmentBody(body: string): BodySegment[] {
  const out: BodySegment[] = []
  const re = new RegExp(`${REDACTION_MASK}+`, 'g')
  let at = 0
  for (const m of body.matchAll(re)) {
    if (m.index! > at) out.push({ kind: 'text', text: body.slice(at, m.index) })
    out.push({ kind: 'masked', length: m[0].length })
    at = m.index! + m[0].length
  }
  if (at < body.length) out.push({ kind: 'text', text: body.slice(at) })
  return out
}

/** Word boundaries for tap-to-hide on phones: [start, end) of every non-space run. */
export function wordRanges(body: string): RedactionRange[] {
  const out: RedactionRange[] = []
  for (const m of body.matchAll(/\S+/g)) out.push({ start: m.index!, end: m.index! + m[0].length })
  return out
}
