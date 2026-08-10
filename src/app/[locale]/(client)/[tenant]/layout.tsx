import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import {
  buildClientNavItems,
  resolveProjectGrant,
} from '@/lib/modules/client-navigation'
import { ClientSidebar } from '@/components/client/ClientSidebar'

/**
 * Project-scoped client dashboard shell (ADR-017 Phase 2 / task #81).
 *
 * Wraps every `/{locale}/{projectSlug}/{posts,leads,analytics}` route. The
 * dynamic folder is named `[tenant]` — NOT `[projectSlug]` — because
 * `(website)/[tenant]` already occupies the `/[locale]/[…]` position and
 * Next.js forbids two different slug names at the same dynamic path. The URL
 * shape Tom locked (`/{locale}/{projectSlug}/…`) is unchanged; only the folder
 * name differs. `params.tenant` carries the projectSlug value.
 *
 * ADR-017 no-silent-substitute rule (Tom's locked decision #1): the projectSlug
 * from the URL is re-validated against `ctx.projects` on EVERY request via
 * `resolveProjectGrant`. An unmatched/ungranted slug is a `notFound()` (404) —
 * never a silent fallback to `ctx.projects[0]`. The URL is authoritative.
 *
 * The sidebar nav is module-driven: `buildClientNavItems(activeGrant)` projects
 * the active project's enabled modules into localized, href-based items.
 */
export default async function ClientProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenant: string }>
}) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect(`/login?next=/${projectSlug}/posts`)
  }

  // Re-validate the URL slug against the caller's grants — never substitute.
  const activeGrant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!activeGrant) {
    notFound()
  }

  const navItems = buildClientNavItems(activeGrant)
  const projects = ctx.projects.map((grant) => ({ projectSlug: grant.projectSlug }))

  return (
    <div className="flex min-h-screen">
      <ClientSidebar
        navItems={navItems}
        projects={projects}
        activeSlug={activeGrant.projectSlug}
      />
      <div className="min-h-screen flex-1 md:ml-56">
        <main className="p-6">{children}</main>
      </div>
    </div>
  )
}
