/**
 * The person's display name (Account page + profile panel). Pure, shared by
 * the browser (instant feedback) and the server action (the real check).
 *
 * Rules: trimmed, inner runs of whitespace collapsed to one space, 1–80
 * characters (counted as Unicode code points, so "José" is 4), no control
 * characters.
 */
export const DISPLAY_NAME_MAX = 80

export type DisplayNameError = 'empty' | 'tooLong' | 'invalid'
export type DisplayNameResult = { ok: true; name: string } | { ok: false; error: DisplayNameError }

// C0/C1 control characters, plus line/paragraph separators and bidi overrides
// (they can make a name render differently from what it is).
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

export function normalizeDisplayName(raw: unknown): DisplayNameResult {
  if (typeof raw !== 'string') return { ok: false, error: 'empty' }
  // Tabs/newlines count as whitespace and are collapsed, not refused.
  const name = raw.replace(/\s+/g, ' ').trim()
  if (!name) return { ok: false, error: 'empty' }
  if (FORBIDDEN.test(name)) return { ok: false, error: 'invalid' }
  if ([...name].length > DISPLAY_NAME_MAX) return { ok: false, error: 'tooLong' }
  return { ok: true, name }
}
