/**
 * Spam protection helpers — Form Field Library
 *
 * Three layers, no CAPTCHA:
 *
 *  1. Honeypot   — hidden text input that bots fill; humans never see it
 *  2. Timing     — reject submissions completed unrealistically fast (< 2s)
 *  3. Rate limit — per-IP cap via a Supabase count query (5 submissions / hour)
 *
 * ADR-018 slice 1 generalized the rate-limit store: `isRateLimited` /
 * `runSpamChecks` accept an optional `{ table, ipColumn }` so the same helpers
 * serve both the legacy `inquiries` table (default — `data->>ip`) and the new
 * `form_submissions` table (`submitter_ip` column). Existing callers pass no
 * options and are unaffected.
 *
 * TURNSTILE INTEGRATION POINT
 * ─────────────────────────────────────────────────────────────────────────────
 * If spam becomes a problem, add Cloudflare Turnstile here.
 * Steps:
 *   1. Add TURNSTILE_SECRET_KEY to .env
 *   2. Add the Turnstile widget to the form (invisible or managed mode)
 *   3. Receive the cf-turnstile-response token in the POST body
 *   4. Call verifyTurnstile(token) below and check result.success
 *   5. Reject the request if verification fails
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum milliseconds between form open and submission. */
const MIN_FORM_DURATION_MS = 2_000

/** Maximum submissions per IP per rolling hour window. */
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_HOURS = 1

/** Default rate-limit store — the legacy inquiries table, IP in the data JSONB. */
const DEFAULT_RATE_LIMIT_STORE: RateLimitStore = { table: 'inquiries', ipColumn: 'data->>ip' }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpamCheckResult {
  blocked: boolean
  reason?: 'honeypot' | 'timing' | 'rate_limit'
}

/**
 * Where to count prior submissions for rate limiting.
 * `ipColumn` may be a plain column (`submitter_ip`) or a JSONB path (`data->>ip`).
 */
export interface RateLimitStore {
  table: string
  ipColumn: string
}

// ─── Layer 1: Honeypot ────────────────────────────────────────────────────────

/**
 * Returns true if the honeypot field was filled.
 *
 * The honeypot field (`company_website`) is a real <input type="text"> in the DOM,
 * hidden via CSS (position:absolute; opacity:0; height:0; overflow:hidden).
 * Bots that traverse the DOM and fill visible inputs will populate it.
 * Real users never see it and leave it empty.
 *
 * IMPORTANT: do NOT use <input type="hidden"> — bots skip those.
 */
export function isHoneypotTriggered(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

// ─── Layer 2: Timing ──────────────────────────────────────────────────────────

/**
 * Returns true if the form was submitted unrealistically fast.
 * `openedAt` is a Unix millisecond timestamp captured when the form mounts.
 */
export function isTooFast(openedAt: number | undefined): boolean {
  if (!openedAt || typeof openedAt !== 'number') return false
  return Date.now() - openedAt < MIN_FORM_DURATION_MS
}

// ─── Layer 3: Rate limiting ───────────────────────────────────────────────────

/**
 * Returns true if this IP has exceeded the rate limit.
 * Uses the configured store's table as the rate-limit source — no Redis required.
 * Defaults to the legacy `inquiries` table (IP in `data->>ip`).
 */
export async function isRateLimited(
  ip: string,
  supabase: SupabaseClient,
  store: RateLimitStore = DEFAULT_RATE_LIMIT_STORE,
): Promise<boolean> {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1_000,
  ).toISOString()

  let query = supabase
    .from(store.table)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', windowStart)

  // JSONB path (e.g. `data->>ip`) needs `.filter`; a plain column uses `.eq`.
  query = store.ipColumn.includes('->')
    ? query.filter(store.ipColumn, 'eq', ip)
    : query.eq(store.ipColumn, ip)

  const { count, error } = await query

  if (error) {
    // Fail open — if the rate-limit check itself errors, don't block the user.
    console.warn('[spam] rate-limit check error:', error.message)
    return false
  }

  return (count ?? 0) >= RATE_LIMIT_MAX
}

// ─── Composite check ─────────────────────────────────────────────────────────

/**
 * Run all spam checks in sequence.
 * Returns immediately on the first detected violation (fail-fast).
 * The response to the client is always a silent 200 — never reveal which check fired.
 */
export async function runSpamChecks(
  params: {
    honeypot: string | undefined
    openedAt: number | undefined
    ip: string
  },
  supabase: SupabaseClient,
  store: RateLimitStore = DEFAULT_RATE_LIMIT_STORE,
): Promise<SpamCheckResult> {
  if (isHoneypotTriggered(params.honeypot)) {
    return { blocked: true, reason: 'honeypot' }
  }

  if (isTooFast(params.openedAt)) {
    return { blocked: true, reason: 'timing' }
  }

  if (await isRateLimited(params.ip, supabase, store)) {
    return { blocked: true, reason: 'rate_limit' }
  }

  return { blocked: false }
}

// ─── IP extraction ────────────────────────────────────────────────────────────

/**
 * Extract the submitter's IP from request headers.
 * Vercel sets x-forwarded-for reliably in production.
 * Falls back to 'dev-local' in local development (where the header is absent).
 */
export function extractIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) return 'dev-local'
  // x-forwarded-for may contain multiple IPs: "client, proxy1, proxy2"
  return forwarded.split(',')[0].trim()
}
