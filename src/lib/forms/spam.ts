/**
 * Spam protection helpers — Form Field Library
 *
 * Three layers, no CAPTCHA:
 *
 *  1. Honeypot   — hidden text input that bots fill; humans never see it
 *  2. Timing     — reject submissions completed unrealistically fast (< 2s)
 *  3. Rate limit — per-IP cap via Supabase count query (5 submissions / hour)
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
 *
 * async function verifyTurnstile(token: string): Promise<boolean> {
 *   const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
 *     method: 'POST',
 *     body: new URLSearchParams({
 *       secret: process.env.TURNSTILE_SECRET_KEY!,
 *       response: token,
 *     }),
 *   })
 *   const data = await res.json()
 *   return data.success === true
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum milliseconds between form open and submission. */
const MIN_FORM_DURATION_MS = 2_000

/** Maximum submissions per IP per rolling hour window. */
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_HOURS = 1

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpamCheckResult {
  blocked: boolean
  reason?: 'honeypot' | 'timing' | 'rate_limit'
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
 * Uses the inquiries table itself as the rate-limit store — no Redis required.
 *
 * Queries: SELECT count(*) FROM inquiries
 *          WHERE data->>'ip' = $ip
 *          AND created_at > now() - interval '1 hour'
 *
 * The functional index on (data->>'ip') makes this fast.
 * At current traffic levels a full scan would also be fine.
 */
export async function isRateLimited(
  ip: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1_000
  ).toISOString()

  // Use filter() for JSONB extraction — .eq() doesn't accept JSON paths
  const { count, error } = await supabase
    .from('inquiries')
    .select('id', { count: 'exact', head: true })
    .filter('data->>ip', 'eq', ip)
    .gte('created_at', windowStart)

  if (error) {
    // Fail open — if the rate-limit check itself errors, don't block the user
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
  supabase: SupabaseClient
): Promise<SpamCheckResult> {
  if (isHoneypotTriggered(params.honeypot)) {
    return { blocked: true, reason: 'honeypot' }
  }

  if (isTooFast(params.openedAt)) {
    return { blocked: true, reason: 'timing' }
  }

  if (await isRateLimited(params.ip, supabase)) {
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
