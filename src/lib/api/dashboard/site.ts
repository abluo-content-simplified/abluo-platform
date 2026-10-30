/**
 * Dashboard provider — the site's address and whether it is live. Read-only,
 * nothing configurable: the state comes from `projects.status` as the edge
 * routing table already carries it (generated from Supabase, see
 * `src/lib/tenancy/host-scope.ts`), and the public domain from the existing
 * `getProjectSiteDomain` (any member of the project may see it).
 */
import { getProjectSiteDomain } from '@/lib/api/client-dashboard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { hostsForProjectId, type GeneratedHostRoute } from '@/lib/tenancy/host-scope'
import { settle } from '@/lib/api/dashboard/settle'
import { previewSiteUrl } from '@/lib/admin/projects-filter'

/** live = public on its own address · preview = only on the private preview address · offline = not served. */
export type SiteState = 'live' | 'preview' | 'offline'
export type SiteStatusData = { state: SiteState; host: string | null; url: string | null }

/**
 * Pure. `routes` are the project's rows in the routing table; `domain` is the
 * Sanity custom domain. A project missing from the (build-time) table falls
 * back to the domain, which is what Home always showed.
 *
 * A site that is not live is shown on the shared preview address
 * `preview.abluo.app/<project>` — the same one the admin project page links
 * (`previewSiteUrl`). Never the `<project>.preview.abluo.app` subdomain (Tom,
 * 2026-10-30: that is not where previews are given out).
 */
export function siteStatusFrom(routes: readonly Pick<GeneratedHostRoute, 'host' | 'hostKind' | 'status' | 'projectSlug'>[], domain: string | null): SiteStatusData {
  const status = routes[0]?.status
  const at = (host: string | null | undefined): SiteStatusData['url'] => (host ? `https://${host}` : null)
  if (!status) return domain ? { state: 'live', host: domain, url: at(domain) } : { state: 'offline', host: null, url: null }
  const slug = routes.find((r) => r.projectSlug)?.projectSlug
  const preview: SiteStatusData | null = slug ? { state: 'preview', host: `preview.abluo.app/${slug}`, url: previewSiteUrl(slug) } : null
  if (status === 'active') {
    const host = domain ?? routes.find((r) => r.hostKind === 'custom-domain')?.host ?? null
    if (host) return { state: 'live', host, url: at(host) }
    return preview ? { ...preview, state: 'live' } : { state: 'live', host: null, url: null }
  }
  if (status === 'preview') return preview ?? { state: 'preview', host: null, url: null }
  return { state: 'offline', host: domain, url: null }
}

/**
 * Pure. Is the site live on its OWN domain (not only on an Abluo address)?
 * Used by the setup checklist ("Your domain is connected").
 */
export function isOnOwnDomain(routes: readonly Pick<GeneratedHostRoute, 'hostKind' | 'status'>[], domain: string | null, state: SiteState): boolean {
  if (state !== 'live') return false
  return Boolean(domain) || routes.some((r) => r.hostKind === 'custom-domain')
}

export async function getSiteStatus(
  ctx: TenantAuthorizationContext,
  projectId: string,
): Promise<(SiteStatusData & { ownDomain: boolean }) | null> {
  if (!ctx.projects.some((p) => p.projectId === projectId)) return null
  const domain = await settle('site.domain', () => getProjectSiteDomain(ctx, projectId))
  const routes = hostsForProjectId(projectId)
  const status = siteStatusFrom(routes, domain)
  return { ...status, ownDomain: isOnOwnDomain(routes, domain, status.state) }
}
