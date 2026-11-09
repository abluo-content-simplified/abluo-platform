/**
 * POST /api/cards/hit — Digital Cards visit / click counter (ADR-049 D11).
 *
 * Called by the card page's beacon (navigator.sendBeacon, CardBeacon.tsx) with
 * `{p, c, k, l?, s?, r?}`. ALWAYS answers 204 with no body, so nothing can be
 * learned from it. Counts only on the production deployment, on the project's
 * own production domain, for a known live card (and link), from a browser that
 * is not a bot and not signed in, within a per-instance rate limit — see
 * src/lib/modules/digital-cards/hit.ts. No IP is read, stored or logged; the
 * aggregate +1 goes through recordHit() (service role, migration 068).
 *
 * The project comes from the body but is only used after the host check proved
 * the request arrived on THAT project's domain (the same "resolve the scope
 * server-side" rule as the forms submission route).
 */
import { NextResponse } from 'next/server'
import { isProduction } from '@/lib/deployment'
import { tenantClient } from '@/lib/sanity/client'
import { asProjectSlug } from '@/lib/tenancy/ids'
import { recordHit } from '@/lib/api/digital-card-stats'
import { DIGITAL_CARD_KNOWN_IDS_QUERY } from '@/lib/modules/digital-cards/queries'
import type { DigitalCardKnownIds } from '@/lib/modules/digital-cards/projection'
import { HIT_BODY_MAX_BYTES, hitDecision, parseHitBody, preflightHit } from '@/lib/modules/digital-cards/hit'
import { createFixedWindowLimiter } from '@/lib/modules/digital-cards/website'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Per instance: 300 hits a minute per card is far above any real card and well below a flood. */
const limiter = createFixedWindowLimiter({ limit: 300, windowMs: 60_000 })

/** The live card ids of a project, cached per instance for a minute (cards change rarely; a new card counts within 60 s). */
const KNOWN_TTL_MS = 60_000
const known = new Map<string, { at: number; ids: DigitalCardKnownIds[] | null }>()

async function knownIds(projectSlug: string): Promise<DigitalCardKnownIds[] | null> {
  const hit = known.get(projectSlug)
  if (hit && Date.now() - hit.at < KNOWN_TTL_MS) return hit.ids
  let ids: DigitalCardKnownIds[] | null = null
  try {
    const { fetchForTenant } = tenantClient(asProjectSlug(projectSlug))
    const rows = await fetchForTenant<DigitalCardKnownIds[] | null>(DIGITAL_CARD_KNOWN_IDS_QUERY, {})
    ids = Array.isArray(rows) ? rows : []
  } catch {
    ids = null // Sanity unreachable: do not count, retry on the next hit
  }
  if (ids) known.set(projectSlug, { at: Date.now(), ids })
  return ids
}

const noContent = () => new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })

async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > HIT_BODY_MAX_BYTES) return null
  try {
    const raw = await request.text()
    return raw.length > HIT_BODY_MAX_BYTES ? null : raw
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const raw = await readBody(request)
    const pre = preflightHit({
      payload: raw === null ? null : parseHitBody(raw),
      production: isProduction(),
      host: request.headers.get('host'),
      userAgent: request.headers.get('user-agent'),
      cookieNames: (request.headers.get('cookie') ?? '')
        .split(';')
        .map((c) => c.split('=')[0]?.trim() ?? '')
        .filter(Boolean),
    })
    if (!pre.ok) return noContent()
    if (!limiter.take(`${pre.payload.p}:${pre.payload.c}`)) return noContent()
    const decision = hitDecision(pre.payload, await knownIds(pre.payload.p))
    if (decision.count) await recordHit(decision.hit)
  } catch {
    // Never an error to the browser, never a log line with request data.
  }
  return noContent()
}
