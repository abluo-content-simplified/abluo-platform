// ── Book details helpers (ADR-033 Amendment I, I-3) — pure, browser-safe ──────
//
// Author, year and ISBN are all optional. The ISBN only ADVISES: a value that
// does not check out is kept and published as typed; it is just not emitted
// to search engines (structured.ts) and shows a quiet hint beside the field.

/** Spaces and hyphens ignored, `x` upper-cased. Anything else is kept as typed. */
export function normalizeIsbn(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\s-]+/g, '').toUpperCase() : ''
}

/** ISBN-10 (weighted mod 11, check digit 0–9 or X) or ISBN-13 (EAN mod 10, prefix 978/979). */
export function isValidIsbn(raw: unknown): boolean {
  const s = normalizeIsbn(raw)
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 10; i++) sum += (10 - i) * (s[i] === 'X' ? 10 : Number(s[i]))
    return sum % 11 === 0
  }
  if (/^97[89]\d{10}$/.test(s)) {
    let sum = 0
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3)
    return sum % 10 === 0
  }
  return false
}

export const BOOK_YEAR_MIN = 1000

/** The latest accepted year: next year (a book announced for it). */
export const bookYearMax = (now: Date = new Date()): number => now.getFullYear() + 1

/**
 * A whole number between 1000 and next year, from a number or digits typed in
 * a field. null when blank OR not acceptable (use `bookYearProblem` to tell which).
 */
export function parseBookYear(value: unknown, now?: Date): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d{1,5}\s*$/.test(value) ? Number(value.trim()) : NaN
  return Number.isInteger(n) && n >= BOOK_YEAR_MIN && n <= bookYearMax(now) ? n : null
}

/** true when something was typed that is not an acceptable year (blank is always fine). */
export function bookYearProblem(value: unknown, now?: Date): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return parseBookYear(value, now) === null
}
