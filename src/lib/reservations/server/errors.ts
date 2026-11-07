// ── Reservations — database error mapping (ADR-044, migration 066) ───────────
//
// Pure (no server-only import): turns the error object PostgREST / supabase-js
// returns for an rpc() or a table read into a typed union the callers can
// switch on. 066 raises `reservations: <code>` with SQLSTATE
//   AB409 = no place / changed elsewhere (for `full`, DETAIL = JSON array of the
//           full occurrence ids), AB422 = refused by a rule, P0002 = not found.
// `unavailable` = the function / table is missing (066 not applied yet, schema
// cache stale) or the call failed in a way the user cannot fix; the app shows
// "bookings are not available right now" and keeps working, like every other
// module does before its migration.
//
// Not to be confused with the domain `ReservationError` CLASS in ../types.ts
// (thrown by pure helpers); this is a result-value union.

export type ReservationError =
  | { kind: 'full'; occurrenceIds: string[] }
  | { kind: 'conflict'; code: string; detail?: string }
  | { kind: 'refused'; code: string; detail?: string }
  | { kind: 'not_found'; code: string }
  | { kind: 'unavailable' }

export type DbErrorLike = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }

/** Table / function missing: PostgREST schema-cache misses and Postgres undefined_* codes. */
const UNAVAILABLE_CODES = new Set(['PGRST202', 'PGRST205', '42P01', '42883', '42703', '3F000'])
/** Data the database refused as malformed — the caller's input, not an outage. */
const INVALID_CODES = new Set(['23514', '23503', '23505', '22023', '22P02', '22007', '22008', '22003', '22001'])

/** `reservations: some_code` → `some_code`; anything else → `unknown`. */
export function reservationCodeOf(message: string | null | undefined): string {
  const m = /reservations:\s*([a-z0-9_]+)/i.exec(message ?? '')
  return m ? m[1].toLowerCase() : 'unknown'
}

function parseIds(details: string | null | undefined): string[] {
  if (!details) return []
  try {
    const v: unknown = JSON.parse(details)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function parseReservationError(error: DbErrorLike | null | undefined): ReservationError {
  const code = error?.code ?? ''
  const detail = error?.details ?? undefined
  if (code === 'AB409' || code === '40001') {
    const c = reservationCodeOf(error?.message)
    if (c === 'full') return { kind: 'full', occurrenceIds: parseIds(detail) }
    return { kind: 'conflict', code: c === 'unknown' ? 'changed' : c, ...(detail ? { detail } : {}) }
  }
  if (code === 'AB422') return { kind: 'refused', code: reservationCodeOf(error?.message), ...(detail ? { detail } : {}) }
  if (code === 'P0002') return { kind: 'not_found', code: reservationCodeOf(error?.message) }
  if (INVALID_CODES.has(code)) return { kind: 'refused', code: 'invalid' }
  if (UNAVAILABLE_CODES.has(code)) return { kind: 'unavailable' }
  return { kind: 'unavailable' }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ReservationError }
export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const fail = (error: ReservationError): Result<never> => ({ ok: false, error })
