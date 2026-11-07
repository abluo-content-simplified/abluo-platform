// ── Reservations — human-readable booking reference (ADR-044 D16.18) ─────────
//
// "CYCE-7K2MQ": project prefix + unambiguous random body. The alphabet has no
// 0 / O / 1 / I / L, so a reference read aloud or typed from a bank statement
// cannot be confused. No checksum.
import { randomInt } from 'crypto'
import { ReservationError } from './types'

export const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const REFERENCE_BODY_LENGTH = 5
export const REFERENCE_PREFIX_MAX = 6

/** Returns an integer in [0, max). Injectable for tests. */
export type RandomSource = (max: number) => number

export function cleanProjectCode(code: string): string {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, REFERENCE_PREFIX_MAX)
  if (!cleaned) throw new ReservationError('invalid_project_code')
  return cleaned
}

export function generateReference(
  projectCode: string,
  random: RandomSource = (max) => randomInt(max),
  bodyLength: number = REFERENCE_BODY_LENGTH,
): string {
  if (!Number.isInteger(bodyLength) || bodyLength < 4 || bodyLength > 6) throw new ReservationError('invalid_argument', 'length')
  const prefix = cleanProjectCode(projectCode)
  let body = ''
  for (let i = 0; i < bodyLength; i++) {
    const n = random(REFERENCE_ALPHABET.length)
    if (!Number.isInteger(n) || n < 0 || n >= REFERENCE_ALPHABET.length) throw new ReservationError('invalid_argument', 'random')
    body += REFERENCE_ALPHABET[n]
  }
  return `${prefix}-${body}`
}

const FORMAT = new RegExp(`^[A-Z0-9]{1,${REFERENCE_PREFIX_MAX}}-[${REFERENCE_ALPHABET}]{4,6}$`)

/** Format check only (no checksum). Expects the canonical, upper-case form. */
export function isValidReferenceFormat(value: string): boolean {
  return FORMAT.test(value)
}

/**
 * Canonical form for searching: trim, upper-case, any run of spaces / dash
 * look-alikes / underscores becomes one '-'. The alphabet has no 0/O/1/I/L, so
 * there is no confusable character that maps to a canonical one; the
 * look-alikes are NOT rewritten (a reference containing them cannot exist and
 * should simply not be found).
 */
export function normaliseReference(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s‐-―−_-]+/g, '-')
}
