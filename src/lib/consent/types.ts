// ─── Cookie consent — core types (ADR-021) ───────────────────────────────────
//
// Pure, framework-free. The consent record is what the visitor decided; the
// consent policy is what the site currently uses. Everything the banner, the
// script gate and the footer link do is derived from comparing the two.

/** Purposes a tracking integration or custom script can belong to. */
export type ScriptPurpose = 'analytics' | 'marketing' | 'functional'

/**
 * Purposes that need consent. `necessary` is never asked — it is exempt.
 * `externalContent` (amendment 2026-10-05) covers third-party embeds — videos
 * and maps — and is derived from the site's sections, never from scripts.
 */
export type ConsentPurpose = ScriptPurpose | 'externalContent'

export const SCRIPT_PURPOSES: readonly ScriptPurpose[] = ['analytics', 'marketing', 'functional']

export const CONSENT_PURPOSES: readonly ConsentPurpose[] = [...SCRIPT_PURPOSES, 'externalContent']

/** One remembered decision — for a purpose or for an embed vendor. */
export interface ConsentDecision {
  granted: boolean
  /** ISO timestamp of the decision. Drives the 6-month / 12-month rules. */
  decidedAt: string
  /**
   * Purposes only: fingerprint of the vendors in that purpose at decision
   * time. A change means "the purpose changed" (ADR-021 re-ask rules).
   */
  fingerprint?: string
}

/** What is stored in the `abluo_consent_<projectSlug>` cookie. */
export interface ConsentRecord {
  v: 1
  purposes: Partial<Record<ConsentPurpose, ConsentDecision>>
  /** Per-vendor click-to-load choices for embeds (e.g. `google-maps`). */
  vendors: Record<string, ConsentDecision>
}

/** One vendor in use on the site, as shown in the banner's second layer. */
export interface ConsentVendor {
  /**
   * Stable id — integration id, `custom:<label>` for custom scripts, or an
   * embed vendor id (`youtube`, `google-maps`, `embed:<host>`, …).
   */
  id: string
  /** Display name (a proper noun — not translated). */
  name: string
}

/** What the site uses right now, derived from the enabled integrations and the site's embeds. */
export interface ConsentPolicy {
  /** Only purposes actually in use; empty means no banner. */
  purposes: Partial<Record<ConsentPurpose, { vendors: ConsentVendor[]; fingerprint: string }>>
}

/** Resolved gate for script rendering — true means allowed to load. */
export type ConsentGrants = Record<ConsentPurpose, boolean>
