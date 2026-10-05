// ─── Cookie consent — server read (ADR-021) ──────────────────────────────────
//
// Reads the visitor's consent cookie for one site and derives everything the
// layout needs. Kept out of `index.ts` because it imports `next/headers`.
// Tenant routes are already `force-dynamic`, so reading a cookie here costs
// no caching.

import { cookies } from 'next/headers'
import type { ProjectIntegrations } from '@/lib/sanity/types'
import { deriveConsentPolicy, requiresConsent } from './policy'
import type { ConsentVendor } from './types'
import { detectSiteEmbedVendors, type SiteEmbedsData } from './site-embeds'
import { siteEmbedsQuery } from '@/lib/sanity/queries'
import { getMapsEmbedKey } from '@/lib/maps/provider'
import { consentCookieName, parseConsentCookie } from './cookie'
import { grantsFrom, shouldShowBanner } from './decide'
import type { ConsentGrants, ConsentPolicy, ConsentRecord } from './types'

export interface ConsentContextData {
  cookieName: string
  policy: ConsentPolicy
  record: ConsentRecord | null
  grants: ConsentGrants
  showBanner: boolean
  requiresConsent: boolean
}

/**
 * @param siteKey the URL project segment — unique per site, including when
 *                several sites share one host (preview.abluo.app/<tenant>).
 * @param embedVendors embed vendors the site uses (detectSiteEmbedVendors) —
 *                the `externalContent` category.
 */
export async function readConsentContext(
  siteKey: string,
  integrations: ProjectIntegrations | null | undefined,
  embedVendors: ConsentVendor[] = []
): Promise<ConsentContextData> {
  const cookieName = consentCookieName(siteKey)
  const jar = await cookies()
  const record = parseConsentCookie(jar.get(cookieName)?.value)
  const policy = deriveConsentPolicy(integrations, embedVendors)
  const now = new Date()
  return {
    cookieName,
    policy,
    record,
    grants: grantsFrom(record, policy, now),
    showBanner: shouldShowBanner(record, policy, now),
    requiresConsent: requiresConsent(policy),
  }
}

/**
 * The embed vendors this site uses — one GROQ read through the caller's
 * tenant-scoped fetch. A failed read yields [] (no category in the banner);
 * every embed then still sits behind its click-to-load placeholder.
 */
export async function readSiteEmbedVendors(
  fetchForTenant: <T>(query: string, params?: Record<string, unknown>) => Promise<T>
): Promise<ConsentVendor[]> {
  try {
    const data = await fetchForTenant<SiteEmbedsData>(siteEmbedsQuery, {})
    return detectSiteEmbedVendors(data, { mapsEmbedEnabled: getMapsEmbedKey() !== null })
  } catch {
    return []
  }
}
