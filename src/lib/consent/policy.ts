// ─── Cookie consent — policy derivation (ADR-021) ────────────────────────────
//
// The banner is DERIVED, never configured: a purpose is "in use" when at least
// one enabled integration with a non-empty value (or an enabled custom script)
// belongs to it. Reuses resolveTracking() so the kill switch and the
// enabled/blank-value rules are exactly the ones TrackingScripts renders by.

import type { ProjectIntegrations } from '@/lib/sanity/types'
import { resolveTracking } from '@/lib/tracking/resolve'
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry'
import type { ConsentPolicy, ConsentPurpose, ConsentVendor } from './types'
import { CONSENT_PURPOSES } from './types'

function isPurpose(c: unknown): c is ConsentPurpose {
  return typeof c === 'string' && (CONSENT_PURPOSES as readonly string[]).includes(c)
}

function manifestPurpose(integrationId: string): ConsentPurpose | null {
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

export function deriveConsentPolicy(data: ProjectIntegrations | null | undefined): ConsentPolicy {
  if (!data) return { purposes: {} }
  const t = resolveTracking(data.integrationConfigs, data.privacy)
  if (t.killSwitched) return { purposes: {} }

  const byPurpose: Partial<Record<ConsentPurpose, ConsentVendor[]>> = {}
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

  const purposes: ConsentPolicy['purposes'] = {}
  for (const p of CONSENT_PURPOSES) {
    const vendors = byPurpose[p]
    if (vendors?.length) purposes[p] = { vendors, fingerprint: fingerprintVendors(vendors) }
  }
  return { purposes }
}

/** True when the site uses anything that needs consent — i.e. the banner exists. */
export function requiresConsent(policy: ConsentPolicy): boolean {
  return Object.keys(policy.purposes).length > 0
}
