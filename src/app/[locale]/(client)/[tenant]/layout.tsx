import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { APP_TEXT_SIZE_COOKIE, APP_THEME_COOKIE, parseAppTextSize, parseAppTheme } from '@/lib/app-theme'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getViewerAccount } from '@/lib/api/viewer-account'
import {
  buildClientNavItems,
  dashboardHomeHref,
  resolveProjectGrant,
} from '@/lib/modules/client-navigation'
import { filterSwitchableProjects, loadProjectStatuses } from '@/lib/client/switchable-projects'
import { ClientSidebar } from '@/components/client/ClientSidebar'
import { AddContentRoot } from '@/components/client/create/AddContentRoot'
import { buildCreateMenu } from '@/lib/modules/create-menu'

/**
 * Project-scoped client dashboard shell (ADR-017 Phase 2 / task #81).
 *
 * Wraps every `/{locale}/{projectSlug}/…` client-dashboard route. The
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
 * The sidebar nav comes from the tenant surface registry (ADR-029):
 * `buildClientNavItems(activeGrant)` returns only the destinations this person
 * may see on this project, as localized, href-based items. The signed-in
 * person's own details and the Help link (`ABLUO_HELP_URL`, configuration) go
 * to the account menu.
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
    redirect(`/login?next=/${projectSlug}/home`)
  }

  // Re-validate the URL slug against the caller's grants — never substitute.
  const activeGrant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!activeGrant) {
    notFound()
  }

  const navItems = buildClientNavItems(activeGrant)
  const viewer = await getViewerAccount(ctx.userId)
  const statuses = await loadProjectStatuses(ctx.projects.map((grant) => grant.projectId))
  const projects = filterSwitchableProjects(ctx.projects, statuses, activeGrant.projectSlug).map((grant) => ({
    projectSlug: grant.projectSlug,
  }))
  const jar = await cookies()
  const theme = parseAppTheme(jar.get(APP_THEME_COOKIE)?.value)
  const textSize = parseAppTextSize(jar.get(APP_TEXT_SIZE_COOKIE)?.value)

  return (
    <AddContentRoot
      projectSlug={activeGrant.projectSlug}
      menu={buildCreateMenu(activeGrant)}
      mediaLibrary={navItems.some((i) => i.moduleId === 'media')}
      contactEmail={process.env.ABLUO_CONTACT_EMAIL || null}
    >
      <div className="min-h-screen md:flex">
        <ClientSidebar
          navItems={navItems}
          projects={projects}
          activeSlug={activeGrant.projectSlug}
          account={{
            name: viewer.name,
            email: viewer.email,
            avatarUrl: viewer.avatarUrl,
            theme,
            textSize,
            helpUrl: process.env.ABLUO_HELP_URL || null,
          }}
          homeHref={dashboardHomeHref(activeGrant.projectSlug)}
        />
        {/* #client-main: the main scroll container (the floating "+" listens to it and to the window). */}
        <div id="client-main" className="min-h-screen min-w-0 flex-1 md:ml-56">
          <main className="p-4 pb-28 md:p-6">{children}</main>
        </div>
      </div>
    </AddContentRoot>
  )
}
