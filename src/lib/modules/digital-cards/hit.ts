// ── Digital Cards — the hit endpoint's decision (ADR-049 D11) ─────────────────
//
// Pure (no Next, no Sanity client, no Supabase): POST /api/cards/hit parses the
// beacon body here and asks hitDecision() whether to count it. Everything that
// would make a count wrong or abusable is refused HERE, and silently — the
// endpoint answers 204 whatever happens, so a caller learns nothing:
//
//   • not the production deployment, or not the project's own production
//     domain (previews, dev, *.vercel.app, preview.abluo.app never count);
//   • a bot / script user agent;
//   • a signed-in browser (a Supabase auth cookie — the owner checking the card);
//   • an unknown project, card or link (checked against the published cards,
//     DIGITAL_CARD_KNOWN_IDS_QUERY);
//   • over the per-instance rate limit.
//
// Never reads, keeps or logs an IP address; the referrer arrives as a HOST only
// and is reduced to a source slug by normalizeSource().

import { lookupHostRoute, resolveScopeFromHost } from '@/lib/tenancy/host-scope'
import { unbrand } from '@/lib/tenancy/ids'
import { DIGITAL_CARD_HIT_KINDS, normalizeSource, type DigitalCardHitKind } from './model'
import type { DigitalCardKnownIds } from './projection'
import type { DigitalCardHit } from '@/lib/api/digital-card-stats'
import { isBotUserAgent } from './website'

/** The beacon body: `{p: projectSlug, c: publicId, k: 'visit'|'click', l?: linkKey, s?: ?src=, r?: referrer host}`. */
export interface HitPayload {
  p: string
  c: string
  k: DigitalCardHitKind
  l?: string
  s?: string
  r?: string
}

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const CARD_RE = /^[A-Za-z0-9-]{1,64}$/
const LINK_RE = /^[A-Za-z0-9_-]{1,64}$/
const HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i

/** Bodies above this are not read (the real one is ~120 bytes). */
export const HIT_BODY_MAX_BYTES = 1024

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v.trim() : '')

/** A well-formed payload or null. Unknown fields are ignored; nothing is trusted beyond its shape. */
export function parseHitBody(raw: unknown): HitPayload | null {
  let body: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length > HIT_BODY_MAX_BYTES) return null
    try {
      body = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  const p = str(b.p, 64)
  const c = str(b.c, 64)
  const k = b.k
  if (!PROJECT_RE.test(p) || !CARD_RE.test(c)) return null
  if (!(DIGITAL_CARD_HIT_KINDS as readonly unknown[]).includes(k)) return null
  const out: HitPayload = { p, c, k: k as DigitalCardHitKind }
  if (k === 'click') {
    const l = str(b.l, 64)
    if (!LINK_RE.test(l)) return null
    out.l = l
  }
  const s = str(b.s, 64)
  if (s) out.s = s
  const r = str(b.r, 260).toLowerCase()
  if (r && HOST_RE.test(r)) out.r = r
  return out
}

/**
 * True when `host` is the production custom domain of `projectSlug` — the
 * route table's `custom-domain` row of an `active` project (www. and port
 * folded by normalizeHost). Platform hosts, previews and unknown hosts: false.
 */
export function isProductionHostFor(host: string | null | undefined, projectSlug: string): boolean {
  const route = lookupHostRoute(host)
  if (!route || route.hostKind !== 'custom-domain') return false
  const scope = resolveScopeFromHost(host)
  return !!scope && unbrand(scope.projectSlug) === projectSlug
}

/** A Supabase session cookie (`sb-<ref>-auth-token`, possibly chunked `.0`, `.1`…). */
export function hasSupabaseAuthCookie(cookieNames: readonly string[]): boolean {
  return cookieNames.some((n) => /^sb-[A-Za-z0-9_-]+-auth-token(?:\.\d+)?$/.test(n))
}

export type HitRefusal = 'invalid' | 'not-production' | 'wrong-host' | 'bot' | 'signed-in' | 'rate-limited' | 'unknown'

/** The checks that need no data: run them first, before any Sanity read. */
export function preflightHit(input: {
  payload: HitPayload | null
  production: boolean
  host: string | null | undefined
  userAgent: string | null | undefined
  cookieNames: readonly string[]
}): { ok: true; payload: HitPayload } | { ok: false; reason: HitRefusal } {
  if (!input.payload) return { ok: false, reason: 'invalid' }
  if (!input.production) return { ok: false, reason: 'not-production' }
  if (!isProductionHostFor(input.host, input.payload.p)) return { ok: false, reason: 'wrong-host' }
  if (isBotUserAgent(input.userAgent)) return { ok: false, reason: 'bot' }
  if (hasSupabaseAuthCookie(input.cookieNames)) return { ok: false, reason: 'signed-in' }
  return { ok: true, payload: input.payload }
}

/** The final decision, once the project's live cards are known (null = could not be read → do not count). */
export function hitDecision(
  payload: HitPayload,
  known: readonly DigitalCardKnownIds[] | null | undefined,
): { count: true; hit: DigitalCardHit } | { count: false; reason: HitRefusal } {
  const card = (known ?? []).find((k) => k?.publicId === payload.c)
  if (!card) return { count: false, reason: 'unknown' }
  if (payload.k === 'click' && !(card.linkKeys ?? []).includes(payload.l ?? '')) return { count: false, reason: 'unknown' }
  return {
    count: true,
    hit: {
      projectSlug: payload.p,
      cardId: payload.c,
      kind: payload.k,
      linkKey: payload.k === 'click' ? payload.l : null,
      source: normalizeSource(payload.s ?? null, payload.r ?? null),
    },
  }
}
