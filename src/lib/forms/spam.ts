/**
 * Spam protection helpers — Form Field Library
 *
 * Three layers, no CAPTCHA:
 *
 *  1. Honeypot   — hidden text input that bots fill; humans never see it
 *  2. Timing     — reject submissions completed unrealistically fast (< 2s)
 *  3. Rate limit — per-IP and per-PROJECT caps via Supabase count queries
 *
 * ADR-018 slice 1 generalized the rate-limit store: `isRateLimited` /
 * `runSpamChecks` accept an optional `{ table, ipColumn }` so the same helpers
 * serve both the legacy `inquiries` table (default — `data->>ip`) and the new
 * `form_submissions` table (`submitter_ip` column). Existing callers pass no
 * options and are unaffected.
 *
 * ── Abuse hardening: omission is not consent ──────────────────────────────────
 * Layers 1 and 2 used to be defeated by simply NOT sending their inputs: no
 * `company_website` key meant no honeypot check, and no `openedAt` meant
 * `isTooFast` returned false. Both now produce a third verdict, `unverified`,
 * distinct from "passed". An unverified request is not rejected — a legitimate
 * client can genuinely omit `openedAt` (the multi-step renderer deliberately
 * does for machine-paced auto-advance creates, see `SubmissionPayload`) — but it
 * gets the STRICTER rate-limit tier and a fail-CLOSED rate-limit check. A real
 * browser that vouches for itself keeps the lenient tier.
 *
 * TURNSTILE INTEGRATION POINT
 * ─────────────────────────────────────────────────────────────────────────────
 * If spam becomes a problem, add Cloudflare Turnstile here. The seam is
 * `runSpamChecks`: it already receives the whole request's spam signals and
 * returns a single blocked/reason verdict, so Turnstile slots in as one more
 * layer without touching the routes or the submission service.
 * Steps:
 *   1. Add TURNSTILE_SECRET_KEY to .env
 *   2. Add the Turnstile widget to the form (invisible or managed mode)
 *   3. Receive the cf-turnstile-response token in the POST body and thread it
 *      through as `params.turnstileToken` (the routes already forward the body)
 *   4. Call verifyTurnstile(token) here and check result.success
 *   5. Reject with `{ blocked: true, reason: 'turnstile' }`
 * Until then, note that an ABSENT token must be treated as `unverified` (the
 * tier above), not as a pass — that is the same omission bug this file just fixed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum milliseconds between form open and submission. */
const MIN_FORM_DURATION_MS = 2_000

/**
 * Oldest `openedAt` we still treat as a real form-fill session. A tab left open
 * for a day is plausible; a timestamp older than that (or in the future) is a
 * forged or stale value and is treated as UNVERIFIED rather than as a pass.
 */
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1_000

/** Maximum submissions per IP per rolling hour window (signals present). */
const RATE_LIMIT_MAX = 5

/**
 * Maximum submissions per IP per rolling hour when the caller supplied no
 * honeypot field and/or no usable `openedAt`. Lower, because such a caller has
 * skipped the two cheap bot filters; still non-zero, because the multi-step
 * auto-advance create legitimately omits `openedAt`.
 */
const RATE_LIMIT_MAX_UNVERIFIED = 3

/**
 * Maximum submissions per PROJECT per rolling hour, across ALL IPs.
 *
 * The per-IP cap alone is useless against a distributed attack, and every
 * completed submission emails the tenant's recipients (ADR-019). 200/hour is
 * ~40x the per-IP cap — far above any real traffic these forms see — while
 * still bounding a botnet to a survivable amount of mail and Resend spend.
 */
const PROJECT_RATE_LIMIT_MAX = 200

const RATE_LIMIT_WINDOW_HOURS = 1

/** Default rate-limit store — the legacy inquiries table, IP in the data JSONB. */
const DEFAULT_RATE_LIMIT_STORE: RateLimitStore = { table: 'inquiries', ipColumn: 'data->>ip' }

export {
  MIN_FORM_DURATION_MS,
  MAX_FORM_AGE_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_MAX_UNVERIFIED,
  PROJECT_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_HOURS,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpamCheckResult {
  blocked: boolean
  reason?: 'honeypot' | 'timing' | 'rate_limit' | 'project_rate_limit'
}

/**
 * Where to count prior submissions for rate limiting.
 * `ipColumn` may be a plain column (`submitter_ip`) or a JSONB path (`data->>ip`).
 * `projectColumn`, when set, enables the per-project cap for that store.
 */
export interface RateLimitStore {
  table: string
  ipColumn: string
  projectColumn?: string
}

/** 'ok' = the signal is present and passed. 'unverified' = the caller sent nothing to check. */
export type SignalVerdict = 'ok' | 'unverified' | 'failed'

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

/**
 * Three-way honeypot verdict.
 *
 * An EMPTY STRING is a pass: every first-party client posts `company_website: ''`.
 * A MISSING key is `unverified` — the caller never rendered the honeypot, so the
 * layer proves nothing about them, and pretending it passed is how the check was
 * bypassed by omission.
 */
export function evaluateHoneypot(value: unknown): SignalVerdict {
  if (typeof value !== 'string') return 'unverified'
  return value.trim().length > 0 ? 'failed' : 'ok'
}

// ─── Layer 2: Timing ──────────────────────────────────────────────────────────

/**
 * Returns true if the form was submitted unrealistically fast.
 * `openedAt` is a Unix millisecond timestamp captured when the form mounts.
 *
 * Retained with its original semantics (absent → false) for callers that only
 * want the "too fast" question; `evaluateTiming` is what the pipeline uses.
 */
export function isTooFast(openedAt: number | undefined): boolean {
  if (!openedAt || typeof openedAt !== 'number') return false
  return Date.now() - openedAt < MIN_FORM_DURATION_MS
}

/**
 * Three-way timing verdict.
 *
 *   'failed'      — submitted in under MIN_FORM_DURATION_MS, or dated in the
 *                   future (a forged timestamp trying to look slow).
 *   'unverified'  — no usable `openedAt`: absent, not a finite number, or older
 *                   than MAX_FORM_AGE_MS. NOT a pass.
 *   'ok'          — a plausible fill duration.
 */
export function evaluateTiming(openedAt: unknown, now: number = Date.now()): SignalVerdict {
  if (typeof openedAt !== 'number' || !Number.isFinite(openedAt) || openedAt <= 0) return 'unverified'
  const elapsed = now - openedAt
  if (elapsed < 0) return 'failed' // opened in the "future" — forged
  if (elapsed > MAX_FORM_AGE_MS) return 'unverified' // stale/implausible, prove nothing
  return elapsed < MIN_FORM_DURATION_MS ? 'failed' : 'ok'
}

// ─── Layer 3: Rate limiting ───────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Cap for this request's tier. Defaults to RATE_LIMIT_MAX. */
  max?: number
  /**
   * What to do when the count query itself errors. See the note in
   * `runSpamChecks` for the reasoning behind the split default.
   */
  failClosed?: boolean
}

/**
 * Returns true if this IP has exceeded the rate limit.
 * Uses the configured store's table as the rate-limit source — no Redis required.
 * Defaults to the legacy `inquiries` table (IP in `data->>ip`).
 */
export async function isRateLimited(
  ip: string,
  supabase: SupabaseClient,
  store: RateLimitStore = DEFAULT_RATE_LIMIT_STORE,
  options: RateLimitOptions = {},
): Promise<boolean> {
  return countExceeds(supabase, store, store.ipColumn, ip, options, 'ip')
}

/**
 * Returns true if this PROJECT has exceeded its hourly submission cap, counting
 * every IP together.
 *
 * This is the cap that survives a distributed attack, and the one that stops a
 * single abused tenant from being buried in mail. It is deliberately independent
 * of the per-IP cap: one abusive IP hitting its own ceiling must not consume any
 * other tenant's headroom (the counts are scoped per project, not global).
 */
export async function isProjectRateLimited(
  projectId: string,
  supabase: SupabaseClient,
  store: RateLimitStore,
  options: RateLimitOptions = {},
): Promise<boolean> {
  if (!store.projectColumn) return false
  return countExceeds(
    supabase,
    store,
    store.projectColumn,
    projectId,
    { max: PROJECT_RATE_LIMIT_MAX, ...options },
    'project',
  )
}

async function countExceeds(
  supabase: SupabaseClient,
  store: RateLimitStore,
  column: string,
  value: string,
  options: RateLimitOptions,
  label: 'ip' | 'project',
): Promise<boolean> {
  const max = options.max ?? RATE_LIMIT_MAX
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1_000,
  ).toISOString()

  let query = supabase
    .from(store.table)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', windowStart)

  // JSONB path (e.g. `data->>ip`) needs `.filter`; a plain column uses `.eq`.
  query = column.includes('->')
    ? query.filter(column, 'eq', value)
    : query.eq(column, value)

  const { count, error } = await query

  if (error) {
    console.warn(
      `[spam] ${label} rate-limit check error (${options.failClosed ? 'failing CLOSED' : 'failing open'}):`,
      error.message,
    )
    return options.failClosed === true
  }

  const exceeded = (count ?? 0) >= max
  if (exceeded && label === 'project') {
    // Loud on purpose: this cap firing means real submissions may be being
    // dropped for a whole tenant, and somebody should look at why.
    console.error(
      `[spam] PROJECT rate limit hit for project=${value}: ${count} submissions in the last ` +
        `${RATE_LIMIT_WINDOW_HOURS}h (cap ${max}). Further submissions for this project are ` +
        `being silently dropped until the window rolls.`,
    )
  }
  return exceeded
}

// ─── Composite check ─────────────────────────────────────────────────────────

export interface SpamCheckParams {
  honeypot: unknown
  openedAt: unknown
  ip: string
  /** Enables the per-project cap. Resolved server-side from the route slug. */
  projectId?: string | null
}

/**
 * Run all spam checks in sequence.
 * Returns immediately on the first detected violation (fail-fast).
 * The response to the client is always a silent 200 — never reveal which check fired.
 *
 * ── Fail-open vs fail-closed on a rate-limit DB error ─────────────────────────
 * Split, by tier, and deliberately:
 *
 *  - A VOUCHED request (honeypot present and empty, plausible `openedAt`) fails
 *    OPEN. If Supabase is unreachable the INSERT that follows fails anyway, so
 *    failing closed here buys nothing for a real outage; it only bites in the
 *    narrow case where the count query times out while writes still work —
 *    exactly the case where failing closed would silently drop every paying
 *    client's leads. Lost leads are unrecoverable; a burst of spam rows during a
 *    blip is not.
 *  - An UNVERIFIED request (the caller skipped the honeypot and/or the timer)
 *    fails CLOSED. It has already declined to prove it is a browser, its only
 *    remaining bound IS the rate limit, and a caller that can trigger DB errors
 *    (by flooding) must not be rewarded with an unbounded window. Nothing that a
 *    real first-party client does lands in this tier except the machine-paced
 *    auto-advance create, and that only fails during an actual DB fault.
 */
export async function runSpamChecks(
  params: SpamCheckParams,
  supabase: SupabaseClient,
  store: RateLimitStore = DEFAULT_RATE_LIMIT_STORE,
): Promise<SpamCheckResult> {
  const honeypot = evaluateHoneypot(params.honeypot)
  if (honeypot === 'failed') {
    return { blocked: true, reason: 'honeypot' }
  }

  const timing = evaluateTiming(params.openedAt)
  if (timing === 'failed') {
    return { blocked: true, reason: 'timing' }
  }

  const unverified = honeypot === 'unverified' || timing === 'unverified'
  const rateLimitOptions: RateLimitOptions = {
    max: unverified ? RATE_LIMIT_MAX_UNVERIFIED : RATE_LIMIT_MAX,
    failClosed: unverified,
  }

  if (await isRateLimited(params.ip, supabase, store, rateLimitOptions)) {
    return { blocked: true, reason: 'rate_limit' }
  }

  if (
    params.projectId &&
    store.projectColumn &&
    (await isProjectRateLimited(params.projectId, supabase, store, {
      failClosed: rateLimitOptions.failClosed,
    }))
  ) {
    return { blocked: true, reason: 'project_rate_limit' }
  }

  return { blocked: false }
}

// ─── IP extraction ────────────────────────────────────────────────────────────

/**
 * Extract the submitter's IP from request headers, preferring sources the
 * CLIENT cannot set.
 *
 * Order matters, and it is the whole point of this function:
 *
 *  1. `x-vercel-forwarded-for` — set by Vercel's edge from the real TCP peer and
 *     overwritten on every request, so a client-supplied value cannot survive.
 *     This is the authoritative source in production.
 *  2. `x-real-ip` — the single-value equivalent set by Vercel (and by most
 *     reverse proxies); also overwritten at the edge.
 *  3. `x-forwarded-for` — LAST resort, and we take the LAST element, not the
 *     first. XFF is append-only: `client, proxy1, proxy2`. Anything a caller
 *     invents lands at the FRONT, which is precisely what the previous
 *     `split(',')[0]` returned — so an attacker could mint a fresh rate-limit
 *     bucket per request with one header. The last element is the address our
 *     own edge observed, which is the one an attacker cannot forge. On Vercel
 *     the header holds a single address, so this is identical in production.
 *  4. `'dev-local'` in local development, where none of these are present.
 *
 * NOTE this makes the rate limit sound but not perfect: IPv6 clients get a fresh
 * /128 cheaply. The per-project cap is what bounds that case.
 */
export function extractIp(headers: Headers): string {
  const vercel = firstAddress(headers.get('x-vercel-forwarded-for'))
  if (vercel) return vercel

  const real = firstAddress(headers.get('x-real-ip'))
  if (real) return real

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }

  return 'dev-local'
}

function firstAddress(header: string | null): string | null {
  if (!header) return null
  const first = header.split(',')[0]?.trim()
  return first ? first : null
}
