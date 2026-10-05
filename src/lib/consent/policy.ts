// ─── Cookie consent — policy derivation (ADR-021) ────────────────────────────
//
// The banner is DERIVED, never configured: a purpose is "in use" when at least
// one enabled integration with a non-empty value (or an enabled custom script)
// belongs to it — or, for `externalContent` (amendment 2026-10-05), when the
// site embeds at least one third-party vendor (detectSiteEmbedVendors). Reuses resolveTracking() so the kill switch and the
// enabled/blank-value rules are exactly the ones TrackingScripts renders by.

import type { ProjectIntegrations } from '@/lib/sanity/types'
import { resolveTracking } from '@/lib/tracking/resolve'
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry'
import type { ConsentPolicy, ConsentPurpose, ConsentVendor, ScriptPurpose } from './types'
import { CONSENT_PURPOSES, SCRIPT_PURPOSES } from './types'

/** Scripts can only claim a script purpose — never `externalContent`. */
function isPurpose(c: unknown): c is ScriptPurpose {
  return typeof c === 'string' && (SCRIPT_PURPOSES as readonly string[]).includes(c)
}

function manifestPurpose(integrationId: string): ScriptPurpose | null {
  const m = INTEGRATION_REGISTRY.find((x) => x.id === integrationId)
  return m && isPurpose(m.consentCategory) ? m.consentCategory : null
}

function manifestName(integrationId: string): string {
  return INTEGRATION_REGISTRY.find((x) => x.id === integrationId)?.label ?? integrationId
}

/** Order-independent, stable fingerprint of a vendor set. */
export function fingerprintVendors(vendors: ConsentVendor[]): string {
  return [...new Set(vendors.map((v) => v.id))].sort().join('|')
}

/**
 * @param embedVendors the embed vendors the site uses (detectSiteEmbedVendors).
 *        They form the `externalContent` purpose. The tracking kill switch does
 *        not remove them: it blanks scripts, not page content.
 */
export function deriveConsentPolicy(
  data: ProjectIntegrations | null | undefined,
  embedVendors: ConsentVendor[] = []
): ConsentPolicy {
  const byPurpose: Partial<Record<ConsentPurpose, ConsentVendor[]>> = {}
  if (embedVendors.length) byPurpose.externalContent = [...embedVendors]
  const t = data ? resolveTracking(data.integrationConfigs, data.privacy) : null
  if (t && !t.killSwitched) addTracking(t, byPurpose)

  const purposes: ConsentPolicy['purposes'] = {}
  for (const p of CONSENT_PURPOSES) {
    const vendors = byPurpose[p]
    if (vendors?.length) purposes[p] = { vendors, fingerprint: fingerprintVendors(vendors) }
  }
  return { purposes }
}

function addTracking(
  t: ReturnType<typeof resolveTracking>,
  byPurpose: Partial<Record<ConsentPurpose, ConsentVendor[]>>
): void {
  const add = (purpose: ConsentPurpose | null, vendor: ConsentVendor) => {
    if (!purpose) return
    ;(byPurpose[purpose] ??= []).push(vendor)
  }

  if (t.ga4MeasurementId) add(manifestPurpose('google-analytics'), { id: 'google-analytics', name: manifestName('google-analytics') })
  if (t.gtmContainerId) add(manifestPurpose('google-tag-manager'), { id: 'google-tag-manager', name: manifestName('google-tag-manager') })
  if (t.metaPixelId) add(manifestPurpose('meta-pixel'), { id: 'meta-pixel', name: manifestName('meta-pixel') })

  for (const s of t.customScripts) {
    if (s.enabled !== true || !s.code) continue
    if (!isPurpose(s.consentCategory)) continue // necessary / unset → exempt
    add(s.consentCategory, { id: `custom:${s.label ?? 'script'}`, name: s.label ?? 'Custom script' })
  }
}

/** True when the site uses anything that needs consent — i.e. the banner exists. */
export function requiresConsent(policy: ConsentPolicy): boolean {
  return Object.keys(policy.purposes).length > 0
}
