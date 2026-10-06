import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { APP_TEXT_SIZE_COOKIE, APP_THEME_COOKIE, parseAppTextSize, parseAppTheme } from '@/lib/app-theme'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import {
  buildClientNavItems,
  dashboardHomeHref,
  mediaNavItems,
  resolveProjectGrant,
} from '@/lib/modules/client-navigation'
import { ClientSidebar } from '@/components/client/ClientSidebar'
import { AddContentRoot } from '@/components/client/create/AddContentRoot'
import { buildCreateMenu } from '@/lib/modules/create-menu'

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
    redirect(`/login?next=/${projectSlug}/home`)
  }

  // Re-validate the URL slug against the caller's grants — never substitute.
  const activeGrant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!activeGrant) {
    notFound()
  }

  const navItems = [...buildClientNavItems(activeGrant), ...mediaNavItems(activeGrant)]
  const projects = ctx.projects.map((grant) => ({ projectSlug: grant.projectSlug }))
  const theme = parseAppTheme((await cookies()).get(APP_THEME_COOKIE)?.value)
  const textSize = parseAppTextSize((await cookies()).get(APP_TEXT_SIZE_COOKIE)?.value)

  return (
    <AddContentRoot
      projectSlug={activeGrant.projectSlug}
      menu={buildCreateMenu(activeGrant)}
      mediaLibrary={mediaNavItems(activeGrant).length > 0}
      contactEmail={process.env.ABLUO_CONTACT_EMAIL || null}
    >
      <div className="min-h-screen md:flex">
        <ClientSidebar
          navItems={navItems}
          projects={projects}
          activeSlug={activeGrant.projectSlug}
          theme={theme}
          textSize={textSize}
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
