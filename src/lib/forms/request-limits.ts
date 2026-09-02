/**
 * Request bounding for the ANONYMOUS form endpoints — abuse hardening.
 *
 * The two public submission routes accept unauthenticated JSON from anyone who
 * knows a project slug (slugs are public). Everything below is about bounding
 * how much an anonymous caller can make us store, parse and email.
 *
 * Two independent bounds live here:
 *
 *  1. `readJsonBodyWithLimit` — a hard cap on the REQUEST BODY. Vercel's own cap
 *     is 4.5 MB, which is ~70x more than any text form needs; without a cap of
 *     our own a single POST can push megabytes into `form_submissions`.
 *  2. `sanitizeSourceObject` — a key + value whitelist for the attribution
 *     `source` JSONB, mirroring the treatment `context` already gets in
 *     `submissions.ts` (`sanitizeContext`). Before this, `body.source` was spread
 *     wholesale into the stored row: arbitrary attacker JSON straight to disk.
 *
 * Neither of these is a spam heuristic — they hold regardless of whether a
 * request looks like a bot. See `spam.ts` for the behavioural layers.
 */

// ── Body size ─────────────────────────────────────────────────────────────────

/**
 * Maximum accepted request body, in bytes.
 *
 * 64 KB. These endpoints carry text form values only — no uploads (`file` fields
 * are not accepted by this slice). The worst-case LEGITIMATE body is roughly:
 * a `textarea` at its 4,000-char default cap, plus ~10 shorter fields, plus the
 * attribution `source` (a page URL and a referrer, ~2 KB each) — call it 12 KB,
 * and up to ~4x that if every character is a 4-byte emoji. 64 KB leaves that
 * comfortable headroom while cutting the ceiling an anonymous caller can write
 * by ~70x versus Vercel's 4.5 MB platform limit.
 */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024

export type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string }

/**
 * Reads and parses a JSON request body, refusing anything over `maxBytes`.
 *
 * Two checks, deliberately:
 *   - `content-length`, when present, rejects an oversized body BEFORE reading a
 *     single byte of it (the cheap path — this is what stops the 4 MB POST).
 *   - the stream is then read with a running byte counter and aborted the moment
 *     the cap is passed, so a MISSING or LYING `content-length` (trivial to
 *     send, and chunked encoding has none at all) buys the caller nothing.
 *
 * A non-object JSON body (`[]`, `"x"`, `null`, `7`) is normalised to `{}` rather
 * than rejected: the callers all read named properties off it, and the previous
 * `.catch(() => ({}))` behaviour for malformed JSON is preserved.
 */
export async function readJsonBodyWithLimit(
  request: Request,
  maxBytes: number = MAX_REQUEST_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const n = Number(declared)
    if (Number.isFinite(n) && n > maxBytes) {
      return { ok: false, status: 413, error: 'request body too large' }
    }
  }

  let text: string
  try {
    const read = await readTextCapped(request, maxBytes)
    if (!read.ok) return { ok: false, status: 413, error: 'request body too large' }
    text = read.text
  } catch {
    // Aborted/broken transfer — treat as an empty body, as the routes did before.
    return { ok: true, body: {} }
  }

  let parsed: unknown
  try {
    parsed = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return { ok: true, body: {} }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: true, body: {} }
  return { ok: true, body: parsed as Record<string, unknown> }
}

async function readTextCapped(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = request.body as ReadableStream<Uint8Array> | null | undefined

  // No readable stream (some test/runtime shims): fall back to buffering, then
  // measure. Bounded by the platform's own 4.5 MB cap, so this is not unbounded.
  if (!body || typeof body.getReader !== 'function') {
    const text = await request.text()
    if (byteLength(text) > maxBytes) return { ok: false }
    return { ok: true, text }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      // Stop pulling the rest of the upload rather than draining it into memory.
      await reader.cancel().catch(() => {})
      return { ok: false }
    }
    chunks.push(value)
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    joined.set(c, offset)
    offset += c.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(joined) }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

// ── Attribution `source` whitelist ────────────────────────────────────────────

/**
 * The keys a client may contribute to the stored `source` JSONB.
 *
 * This is the closed set produced by `collectClientSource()` (page/referrer/UTM/
 * click ids) plus the entry-point + CTA attribution the section components seed
 * it with, plus the two server-derived keys the route adds itself. Anything else
 * a caller sends is dropped — the same rule `context` has always had.
 */
export const ALLOWED_SOURCE_KEYS: readonly string[] = [
  // collectClientSource() — page + referrer
  'page_url',
  'page_path',
  'page_slug',
  'referrer',
  'referrer_domain',
  // collectClientSource() — campaign attribution
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  // collectClientSource() — ad click ids
  'gclid',
  'fbclid',
  // Entry point / CTA attribution seeded by the section components
  'source',
  'cta_internal_name',
  'cta_label_snapshot',
  // Server-derived, added by the route (never trusted from the body — the route
  // sets them AFTER sanitizing, so a client-sent value is overwritten).
  'device_type',
  'country',
]

const SOURCE_KEY_SET = new Set(ALLOWED_SOURCE_KEYS)

/** Per-value cap for URL-ish attribution keys (page_url, referrer). */
export const MAX_SOURCE_URL_VALUE_LENGTH = 2_048
/** Per-value cap for every other attribution key. */
export const MAX_SOURCE_VALUE_LENGTH = 512

const LONG_SOURCE_KEYS = new Set(['page_url', 'referrer'])

/**
 * Reduces a client-supplied `source` object to whitelisted keys with bounded
 * scalar values. Nested objects/arrays are dropped outright — attribution is
 * flat by construction, and a nested payload is either a bug or an attempt to
 * write arbitrary JSON into the tenant's database.
 *
 * Over-long strings are TRUNCATED rather than rejected: a 3 KB page URL is a
 * real thing (long query strings), and losing the tail of an attribution string
 * is strictly better than losing the lead.
 */
export function sanitizeSourceObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SOURCE_KEY_SET.has(key)) continue
    const max = LONG_SOURCE_KEYS.has(key) ? MAX_SOURCE_URL_VALUE_LENGTH : MAX_SOURCE_VALUE_LENGTH
    const clean = sanitizeScalar(value, max)
    if (clean !== undefined) out[key] = clean
  }
  return out
}

/**
 * Bounds one JSONB leaf value: strings are truncated to `maxLength`, finite
 * numbers/booleans/null pass through, everything else (objects, arrays,
 * functions, NaN/Infinity) is dropped by returning `undefined`.
 */
export function sanitizeScalar(value: unknown, maxLength: number): unknown | undefined {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
      return value.length > maxLength ? value.slice(0, maxLength) : value
    case 'number':
      return Number.isFinite(value) ? value : undefined
    case 'boolean':
      return value
    default:
      return undefined
  }
}
