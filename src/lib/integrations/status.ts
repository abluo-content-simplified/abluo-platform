// ── Integration status derivation ─────────────────────────────────────────────
// ADR-014 Phase B, slice 2. Pure helper consumed by IntegrationsPane (Studio
// UI) to render a per-integration status badge without duplicating the
// "what does 'configured' mean" logic in the component itself.
//
// Deliberately framework-free: no 'sanity' or 'react' imports, so this stays
// trivially unit-testable (mirrors the house convention set by
// src/lib/integrations/validate.ts and schema.ts — pure functions over
// IntegrationManifest/IntegrationConfig, no I/O).

import type { IntegrationConfig, IntegrationManifest } from './types'

// ── Privacy settings shape ────────────────────────────────────────────────────
// Mirrors project.privacy (src/lib/sanity/schema.ts ~L1925–1943). No TS type
// exists yet for the Sanity-generated shape (types.ts is hand-maintained and
// project.privacy has no consumer until this pane) — declared narrowly here
// rather than widening src/lib/sanity/types.ts for a two-field object. AI
// decides: if a second consumer needs this shape, promote it there instead of
// duplicating.
export interface PrivacySettings {
  consentModeEnabled?: boolean
  trackingKillSwitch?: boolean
}

// ── Status value ───────────────────────────────────────────────────────────────
export type IntegrationStatusValue = 'not-configured' | 'disabled' | 'enabled'

export interface IntegrationStatus {
  /** Primary lifecycle status for this integration on this project. */
  status: IntegrationStatusValue
  /**
   * True when global consent mode is on AND this integration's
   * consentCategory is one that consent mode gates (analytics | marketing |
   * functional — 'necessary' is never gated, matching TrackingScripts'
   * fail-closed behavior, ADR-013/014).
   */
  consentGated: boolean
  /** True when the project-level tracking kill switch is on. */
  killSwitched: boolean
}

const CONSENT_GATED_CATEGORIES = new Set<IntegrationManifest['consentCategory']>([
  'analytics',
  'marketing',
  'functional',
])

/**
 * True when every field the manifest marks `required: true` has a
 * non-empty value set in `values`. A field with no `required` flag never
 * blocks "configured" status, regardless of its own value.
 *
 * `customScriptArray` fields (required: false in every current manifest) are
 * intentionally not special-cased — the array field's own arbitrary
 * per-script requiredness (label/description/code/consentCategory) is a
 * Studio-form-level concern (schema.ts validation), not a status-derivation
 * concern here.
 */
function hasAllRequiredValues(
  manifest: IntegrationManifest,
  values: Record<string, unknown> | undefined
): boolean {
  for (const field of manifest.fields) {
    if (!field.required) continue
    const value = values?.[field.id]
    if (value === undefined || value === null || value === '') {
      return false
    }
  }
  return true
}

/**
 * Derives an integration's Studio status for a given project.
 *
 * Precedence:
 *   1. No config entry at all → 'not-configured'.
 *   2. Config entry exists but is missing a required value → 'not-configured'
 *      (an integration cannot be meaningfully "disabled" if it was never
 *      validly configured in the first place).
 *   3. Config entry exists, fully configured, `enabled !== true` → 'disabled'.
 *   4. Config entry exists, fully configured, `enabled === true` → 'enabled'.
 *
 * `consentGated` and `killSwitched` are independent booleans, not folded into
 * `status` — an integration can be 'enabled' and still consent-gated or
 * kill-switched at runtime (Phase C's TrackingScripts concern; this pane only
 * surfaces the fact via the badge, per the task brief).
 */
export function getIntegrationStatus(
  manifest: IntegrationManifest,
  config: IntegrationConfig | undefined,
  privacy: PrivacySettings | undefined
): IntegrationStatus {
  const consentGated =
    privacy?.consentModeEnabled === true && CONSENT_GATED_CATEGORIES.has(manifest.consentCategory)
  const killSwitched = privacy?.trackingKillSwitch === true

  if (!config || !hasAllRequiredValues(manifest, config.values)) {
    return { status: 'not-configured', consentGated, killSwitched }
  }

  if (config.enabled !== true) {
    return { status: 'disabled', consentGated, killSwitched }
  }

  return { status: 'enabled', consentGated, killSwitched }
}
