import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { filterSwitchableProjects, loadProjectStatuses } from '@/lib/client/switchable-projects'
import { dashboardHomeHref, resolveProjectGrant } from '@/lib/modules/client-navigation'

/**
 * Bare client-dashboard entry (ADR-017 Phase 2 / task #81) — `/{locale}` with
 * no project in the URL.
 *
 * Lands the user on a project. The active project is always chosen by REDIRECT
 * into the canonical `/{locale}/{projectSlug}/…` URL — the cookie is only a
 * landing HINT, never authoritative:
 *   1. If the `abluo_last_project` cookie names a still-granted project, go
 *      there.
 *   2. Otherwise, the first grant.
 *   3. Zero grants → the localized "no projects" state (no redirect).
 *
 * The destination is the project's dashboard home (`/{projectSlug}/home`). On a tenant host the proxy rewrites
 * `/{locale}` to the public site, so this page renders only on the platform
 * host where the client dashboard lives.
 */
export default async function ClientDashboardEntry({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect(`/login?next=${encodeURIComponent(`/${locale}/account`)}`)
  }

  if (ctx.projects.length === 0) {
    const t = await getTranslations('clientDashboard')
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-xl font-semibold tracking-tight">{t('shell.entryTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('shell.noProjects')}</p>
      </div>
    )
  }

  // Landing hint: last-used project, if still granted; else the first grant.
  const cookieStore = await cookies()
  const lastSlug = cookieStore.get('abluo_last_project')?.value
  // Inactive projects are never the default landing (they stay reachable by URL).
  const switchable = filterSwitchableProjects(ctx.projects, await loadProjectStatuses(ctx.projects.map((g) => g.projectId)))
  const target =
    (lastSlug && resolveProjectGrant(ctx.projects, lastSlug)) || switchable[0] || ctx.projects[0]

  // Every project lands on its dashboard home (S1).
  redirect(`/${locale}${dashboardHomeHref(target.projectSlug)}`)
}
