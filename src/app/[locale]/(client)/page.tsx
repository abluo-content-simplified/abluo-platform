import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'

/**
 * Bare client-dashboard entry (ADR-017 Phase 2 / task #81) — `/{locale}` with
 * no project in the URL.
 *
 * Sends everyone to `/{locale}/sites` (Tom, 2026-10-08): one site → that
 * site's Home, several → the "Your websites" overview. Zero grants → the
 * localized "no projects" state here. On a tenant host the proxy rewrites
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
    redirect(`/login?next=${encodeURIComponent(`/${locale}/sites`)}`)
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

  // One site → its Home; several → the "Your websites" overview (Tom, 2026-10-08).
  redirect(`/${locale}/sites`)
}
