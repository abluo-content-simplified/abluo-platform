import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { listProjectConnections } from '@/lib/connections/manage'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { ConnectedAppsBrowser } from '@/components/client/connections/ConnectedAppsBrowser'

export const dynamic = 'force-dynamic'

/**
 * Client dashboard — Connected apps (ADR-031 D2, D8.4). Owners and Site
 * admins (`connections.manage`) see which partner apps read this site's data,
 * what they read, when they last did, and can pause, resume or disconnect
 * them. Anyone else gets a 404, exactly like a site they do not have.
 */
export default async function ConnectedAppsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/apps`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const r = await listProjectConnections(ctx, grant.projectId, { store: createSupabaseConnectionsStore() })
  if (!r.ok) notFound()

  const t = await getTranslations('clientDashboard')
  return (
    <PageShell>
      <ConnectedAppsBrowser
        title={t('connections.title')}
        projectSlug={projectSlug}
        locale={await getLocale()}
        connections={r.connections}
        readOnly={Boolean(ctx.support)}
      />
    </PageShell>
  )
}
