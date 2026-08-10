import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import {
  buildClientNavItems,
  resolveProjectGrant,
} from '@/lib/modules/client-navigation'

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
 * The destination sub-page is the first module-driven nav item for that grant,
 * falling back to `posts` (the wired page). On a tenant host the proxy rewrites
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
    redirect('/login?next=/account')
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
  const target =
    (lastSlug && resolveProjectGrant(ctx.projects, lastSlug)) || ctx.projects[0]

  // First module-driven destination for the target project; fall back to posts.
  const firstNav = buildClientNavItems(target)[0]
  const href = firstNav?.href ?? `/${target.projectSlug}/posts`

  redirect(`/${locale}${href}`)
}
