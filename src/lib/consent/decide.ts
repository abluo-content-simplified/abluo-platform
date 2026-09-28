// ─── Cookie consent — decision rules (ADR-021) ───────────────────────────────
//
// Legal floor (Garante 2021 + Omnibus Art. 88a proposal):
//   - closing with the X = reject;
//   - after a refusal, do not ask again for at least 6 months.
// Our choice (no nagging): every decision is respected for 12 months; a purpose
// is re-asked early only when its vendors changed — immediately if it had been
// accepted, and only after the 6-month floor if it had been refused.

import type {
  ConsentDecision,
  ConsentGrants,
  ConsentPolicy,
  ConsentPurpose,
  ConsentRecord,
} from './types'
import { CONSENT_PURPOSES } from './types'
import { emptyRecord } from './cookie'

const DAY = 24 * 60 * 60 * 1000
export const DECISION_VALIDITY_MS = 365 * DAY // 12 months
export const REFUSAL_FLOOR_MS = 183 * DAY // ≥ 6 months

function age(d: ConsentDecision, now: Date): number {
  return now.getTime() - Date.parse(d.decidedAt)
}

/** Whether ONE purpose in use needs a fresh answer from the visitor. */
export function purposeNeedsAnswer(
  decision: ConsentDecision | undefined,
  fingerprint: string,
  now: Date
): boolean {
  if (!decision) return true // never asked
  const a = age(decision, now)
  if (a < 0) return true // clock skew / tampered → ask
  if (a >= DECISION_VALIDITY_MS) return true // 12 months passed
  if (decision.fingerprint === fingerprint) return false // unchanged
  // Vendors changed:
  return decision.granted ? true : a >= REFUSAL_FLOOR_MS
}

export function shouldShowBanner(
  record: ConsentRecord | null,
  policy: ConsentPolicy,
  now: Date = new Date()
): boolean {
  return CONSENT_PURPOSES.some((p) => {
    const inUse = policy.purposes[p]
    return inUse ? purposeNeedsAnswer(record?.purposes[p], inUse.fingerprint, now) : false
  })
}

/**
 * What may load right now. A purpose is granted only when the visitor said yes
 * to exactly the vendors in use and that answer is still valid. Anything else
 * — no record, expired, changed — fails closed.
 */
export function grantsFrom(
  record: ConsentRecord | null,
  policy: ConsentPolicy,
  now: Date = new Date()
): ConsentGrants {
  const out: ConsentGrants = { analytics: false, marketing: false, functional: false }
  for (const p of CONSENT_PURPOSES) {
    const inUse = policy.purposes[p]
    const d = record?.purposes[p]
    if (!inUse || !d || !d.granted) continue
    const a = age(d, now)
    out[p] = a >= 0 && a < DECISION_VALIDITY_MS && d.fingerprint === inUse.fingerprint
  }
  return out
}

/**
 * Applies a banner/settings answer. Only purposes in use are written; others
 * keep their previous decision. "Reject all" and the X both call this with
 * every purpose false.
 */
export function applyChoice(
  previous: ConsentRecord | null,
  policy: ConsentPolicy,
  choice: Partial<Record<ConsentPurpose, boolean>>,
  now: Date = new Date()
): ConsentRecord {
  const rec: ConsentRecord = previous
    ? { v: 1, purposes: { ...previous.purposes }, vendors: { ...previous.vendors } }
    : emptyRecord()
  const at = now.toISOString()
  for (const p of CONSENT_PURPOSES) {
    const inUse = policy.purposes[p]
    if (!inUse) continue
    rec.purposes[p] = { granted: choice[p] === true, decidedAt: at, fingerprint: inUse.fingerprint }
  }
  return rec
}

export const acceptAll = (policy: ConsentPolicy): Partial<Record<ConsentPurpose, boolean>> =>
  Object.fromEntries(Object.keys(policy.purposes).map((p) => [p, true]))

/** Reject all — also what closing the banner with the X records. */
export const rejectAll = (): Partial<Record<ConsentPurpose, boolean>> => ({})

/** Embed vendors (click-to-load). Valid for 12 months once allowed. */
export function vendorAllowed(record: ConsentRecord | null, vendorId: string, now: Date = new Date()): boolean {
  const d = record?.vendors[vendorId]
  if (!d?.granted) return false
  const a = age(d, now)
  return a >= 0 && a < DECISION_VALIDITY_MS
}

export function allowVendor(previous: ConsentRecord | null, vendorId: string, now: Date = new Date()): ConsentRecord {
  const rec: ConsentRecord = previous
    ? { v: 1, purposes: { ...previous.purposes }, vendors: { ...previous.vendors } }
    : emptyRecord()
  rec.vendors[vendorId] = { granted: true, decidedAt: now.toISOString() }
  return rec
}

/** Embed vendors the visitor currently allows (still within 12 months). */
export function allowedVendorIds(record: ConsentRecord | null, now: Date = new Date()): string[] {
  return Object.keys(record?.vendors ?? {}).filter((id) => vendorAllowed(record, id, now))
}

/**
 * Applies embed choices from the settings panel. `false` withdraws — the entry
 * is removed, so the placeholder shows again and nothing is remembered.
 */
export function applyVendorChoices(
  previous: ConsentRecord | null,
  choices: Record<string, boolean>,
  now: Date = new Date()
): ConsentRecord {
  const rec: ConsentRecord = previous
    ? { v: 1, purposes: { ...previous.purposes }, vendors: { ...previous.vendors } }
    : emptyRecord()
  for (const [id, allowed] of Object.entries(choices)) {
    if (allowed) {
      if (!vendorAllowed(rec, id, now)) rec.vendors[id] = { granted: true, decidedAt: now.toISOString() }
    } else {
      delete rec.vendors[id]
    }
  }
  return rec
}
