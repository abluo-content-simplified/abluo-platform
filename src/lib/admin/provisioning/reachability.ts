/**
 * "What's next" on a finished setup — does the version running now already
 * know this site? (Tom, 2026-11-05: "is there any change on this page?")
 *
 * Which address opens which site is the generated route table
 * (`src/lib/tenancy/generated/route-config.ts`), regenerated from Supabase with
 * `npm run routes:generate` and shipped by a deploy. The module THIS server
 * imported is the table of the version running now, so comparing it with the
 * project's current Supabase row answers, per step:
 *
 *   - preview: is the project in the running table at all?
 *   - domain:  is the Supabase `custom_domain` in the running table for it?
 *   - status:  does the running table carry the Supabase status (e.g. active)?
 *
 * Pure: the routes and the row come in as arguments.
 */
import type { GeneratedHostRoute } from '@/lib/tenancy/generated/route-config'

export type Reachability = {
  /** The project is in the route table of the version running now. */
  previewLive: boolean
  /** `projects.custom_domain` in Supabase now (normalised), or null. */
  customDomain: string | null
  /** That domain is in the running table, for this project. */
  domainLive: boolean
  /** `projects.status` in Supabase now, and in the running table (null when not there). */
  status: string | null
  deployedStatus: string | null
}

export function normaliseDomain(value: string | null | undefined): string | null {
  const d = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '')
  return d || null
}

export function reachability(
  routes: readonly GeneratedHostRoute[],
  project: { id: string; slug: string; customDomain?: string | null; status?: string | null }
): Reachability {
  const mine = routes.filter((r) => r.projectId === project.id || (!r.projectId && r.projectSlug === project.slug))
  const customDomain = normaliseDomain(project.customDomain)
  const preview = mine.find((r) => r.hostKind === 'preview-subdomain') ?? mine[0] ?? null
  return {
    previewLive: mine.length > 0,
    customDomain,
    domainLive: !!customDomain && mine.some((r) => r.hostKind === 'custom-domain' && r.host === customDomain),
    status: project.status ?? null,
    deployedStatus: preview?.status ?? null,
  }
}
