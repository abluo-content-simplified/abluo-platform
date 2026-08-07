import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'

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
export default async function AccountPage() {
  const ctx = await getTenantAuthorizationContext()

  if (!ctx) {
    redirect('/login?next=/account')
  }

  const t = await getTranslations('account')

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {ctx.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noProjects')}</p>
      ) : (
        <ul className="space-y-3">
          {ctx.projects.map((project) => (
            <li
              key={project.projectId}
              className="rounded border border-border p-4"
            >
              <p className="font-medium">{project.projectSlug}</p>
              <p className="text-sm text-muted-foreground">
                {t('roleLabel', { role: t(`roles.${project.role}`) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
