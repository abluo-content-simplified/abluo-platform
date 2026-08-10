import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'

/**
 * Client dashboard — Analytics (project-scoped stub, ADR-017 Phase 2 / task #81).
 *
 * Renders under the dashboard shell + gate; no data this phase. Still
 * re-validates the URL projectSlug against `ctx.projects` (no silent
 * substitute) so the route never renders for an ungranted project.
 */
export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ tenant: string }>
}) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx || !resolveProjectGrant(ctx.projects, projectSlug)) {
    notFound()
  }

  const t = await getTranslations('clientDashboard')

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">{t('analytics.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('analytics.comingSoon')}</p>
    </div>
  )
}
