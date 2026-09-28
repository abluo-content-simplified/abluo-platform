// ─── Cookie consent — cookie (de)serialization (ADR-021) ─────────────────────
//
// One cookie PER PROJECT: several tenants share a host on preview
// (preview.abluo.app/<tenant>), so a shared name would leak one site's consent
// onto another. The cookie itself is strictly necessary (it stores the choice)
// and therefore exempt from consent.
//
// Parsing is defensive: anything unreadable is "no record", which fails closed.

import type { ConsentDecision, ConsentRecord } from './types'
import { CONSENT_PURPOSES } from './types'

export const CONSENT_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365 // 12 months

export function consentCookieName(projectSlug: string): string {
  return `abluo_consent_${projectSlug.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

export function emptyRecord(): ConsentRecord {
  return { v: 1, purposes: {}, vendors: {} }
}

function readDecision(x: unknown): ConsentDecision | null {
  if (!x || typeof x !== 'object') return null
  const d = x as Record<string, unknown>
  if (typeof d.granted !== 'boolean' || typeof d.decidedAt !== 'string') return null
  if (Number.isNaN(Date.parse(d.decidedAt))) return null
  const out: ConsentDecision = { granted: d.granted, decidedAt: d.decidedAt }
  if (typeof d.fingerprint === 'string') out.fingerprint = d.fingerprint
  return out
}

export function parseConsentCookie(raw: string | null | undefined): ConsentRecord | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(decodeURIComponent(raw))
  } catch {
    return null
  }
  if (!json || typeof json !== 'object' || (json as { v?: unknown }).v !== 1) return null
  const src = json as { purposes?: unknown; vendors?: unknown }
  const rec = emptyRecord()
  if (src.purposes && typeof src.purposes === 'object') {
    for (const p of CONSENT_PURPOSES) {
      const d = readDecision((src.purposes as Record<string, unknown>)[p])
      if (d) rec.purposes[p] = d
    }
  }
  if (src.vendors && typeof src.vendors === 'object') {
    for (const [id, v] of Object.entries(src.vendors as Record<string, unknown>)) {
      const d = readDecision(v)
      if (d && /^[a-z0-9:_-]{1,64}$/i.test(id)) rec.vendors[id] = d
    }
  }
  return rec
}

export function serializeConsentCookie(record: ConsentRecord): string {
  return encodeURIComponent(JSON.stringify(record))
}
