import 'server-only'
// Reads, from Sanity, the two facts the Booking rules page needs that are not
// tenant data: the Reservations capabilities (Studio → Modules → Reservations,
// ADR-044 D13) and the site languages (siteConfig). Read-only.
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { siteFactsOf, type SiteFacts } from './settings-service'

export const RESERVATIONS_SITE_QUERY = /* groq */ `{
  "config": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "reservations" && enabled != false][0].config,
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }
}`

export async function readSiteFacts(projectSlug: string): Promise<SiteFacts> {
  const r = await sanityWriteClient.fetch<Parameters<typeof siteFactsOf>[0]>(RESERVATIONS_SITE_QUERY, { projectSlug }, { perspective: 'raw' })
  return siteFactsOf(r)
}
