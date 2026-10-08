// Server-only: reads every project's integration config with the server Sanity client.
import { sanityServerReadClient } from '@/lib/sanity/server-clients'

/**
 * Where the snapshot job learns WHICH Google properties to read (ADR-029 §3.4).
 * The Abluo admin stores them in Studio → Project Settings → Integrations
 * (`project.integrationConfigs`, ADR-014's one configuration surface):
 *
 *   google-analytics       values.ga4PropertyId   numeric GA4 property ID
 *   google-search-console  values.siteUrl         sc-domain:… or https://…/
 *
 * Rules:
 *   - GA4: the property ID is read whether or not the integration is
 *     `enabled` — `enabled` switches the website TAG, and a site may load GA4
 *     another way (e.g. GTM) and still want its numbers.
 *   - Search Console has no tag, so its `enabled` switch is the reporting
 *     switch: read only when `enabled === true` (fail-closed, like the registry).
 *   - A value that fails the manifest's format is ignored (→ not connected).
 *
 * Tenants never see this configuration; only the numbers (via snapshots).
 */

export const GA4_INTEGRATION_ID = 'google-analytics'
export const GSC_INTEGRATION_ID = 'google-search-console'

type ConfigEntry = { integrationId?: string; enabled?: boolean; values?: Record<string, unknown> | null }

const GA4_PROPERTY_RE = /^[0-9]{6,12}$/
const GSC_SITE_RE = /^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/[^\s/]+(\/[^\s]*)?\/)$/

/** Pure: the two reporting IDs from a project's integrationConfigs. */
export function analyticsIdsFrom(configs: readonly ConfigEntry[] | null | undefined): {
  ga4PropertyId: string | null
  gscSiteUrl: string | null
} {
  const ga4 = configs?.find((c) => c.integrationId === GA4_INTEGRATION_ID)
  const gsc = configs?.find((c) => c.integrationId === GSC_INTEGRATION_ID)
  const prop = typeof ga4?.values?.ga4PropertyId === 'string' ? ga4.values.ga4PropertyId.trim() : ''
  const site = gsc?.enabled === true && typeof gsc.values?.siteUrl === 'string' ? gsc.values.siteUrl.trim() : ''
  return {
    ga4PropertyId: GA4_PROPERTY_RE.test(prop) ? prop : null,
    gscSiteUrl: GSC_SITE_RE.test(site) ? site : null,
  }
}

const QUERY = /* groq */ `
  *[_type == "project" && projectSlug in $slugs] {
    projectSlug,
    "configs": integrationConfigs[integrationId in $ids] { integrationId, enabled, values }
  }
`

/**
 * slug → reporting IDs for the given project slugs, in one Sanity read.
 * Admin / system use only (cron, admin pages) — never call from a tenant page.
 */
export async function loadAnalyticsIds(
  slugs: readonly string[],
  deps: { fetch?: (query: string, params: Record<string, unknown>) => Promise<unknown> } = {},
): Promise<Map<string, { ga4PropertyId: string | null; gscSiteUrl: string | null }>> {
  const out = new Map<string, { ga4PropertyId: string | null; gscSiteUrl: string | null }>()
  if (!slugs.length) return out
  const run = deps.fetch ?? ((q: string, p: Record<string, unknown>) => sanityServerReadClient.fetch(q, p))
  const docs = ((await run(QUERY, { slugs: [...slugs], ids: [GA4_INTEGRATION_ID, GSC_INTEGRATION_ID] })) ?? []) as {
    projectSlug?: string
    configs?: ConfigEntry[] | null
  }[]
  for (const d of docs) if (d.projectSlug) out.set(d.projectSlug, analyticsIdsFrom(d.configs))
  return out
}
