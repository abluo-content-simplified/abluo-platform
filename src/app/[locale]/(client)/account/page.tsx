import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { Link } from '@/i18n/navigation'
import { dashboardHomeHref } from '@/lib/modules/client-navigation'

/**
 * Minimal authenticated client landing page — ADR-017 slice 4 handoff §5.4.
 *
 * The real client dashboard is a later slice (task #81). This page exists
 * only to prove the login flow works end-to-end and to surface the
 * resolved `TenantAuthorizationContext` (which projects, which role, which
 * modules) for verification during this slice — not as dashboard UI to
 * build on.
 *
 * Gating note: `src/proxy.ts`'s admin-surface gate (`isAdminSurface`) does
 * NOT cover this route — its segment allowlist is admin-only
 * (dashboard/clients/content/media/projects/settings), and the `(client)`
 * route group has no gate of its own yet (a known, pre-existing gap — see
 * the handoff's Security notes, §5.5). This page performs its own
 * authentication check inline rather than relying on proxy.ts, which is
 * the correct boundary until a `(client)`-group-wide gate is designed
 * (out of this slice's scope — flagged, not built, to avoid pre-empting
 * the login-route-sharing decision in handoff §8).
 */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const ctx = await getTenantAuthorizationContext()

  if (!ctx) {
    redirect(`/login?next=${encodeURIComponent(`/${locale}/account`)}`)
  }

  const t = await getTranslations('account')

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {ctx.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
      ) : (
        <ul className="space-y-3">
          {ctx.projects.map((project) => (
            <li key={project.projectId}>
              <Link
                href={dashboardHomeHref(project.projectSlug)}
                className="flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.projectSlug}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t('roleLabel', { role: t(`roles.${project.role}`) })}
                  </span>
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
