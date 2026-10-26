import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { listProjectConnections } from '@/lib/connections/manage'
import { createSupabaseConnectionsStore } from '@/lib/connections/supabase-store'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { ConnectedAppsBrowser } from '@/components/client/connections/ConnectedAppsBrowser'
import { AffiliatePrograms } from '@/components/client/connections/AffiliatePrograms'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { SettingsError, loadSettings, SETTINGS_READ } from '@/lib/settings/service'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'

export const dynamic = 'force-dynamic'

/**
 * Client dashboard — Connected apps (ADR-031 D2, D8.4). Two kinds of outside
 * accounts linked to this site:
 *   - Affiliate programs (Amazon, Awin, the disclosure text; moved here from
 *     Settings on 2026-10-26): `site.details.read` sees them, Owner and Site
 *     admin change them.
 *   - Partner apps that read this site's data (`connections.manage`): pause,
 *     resume or disconnect.
 * Someone with neither gets a 404, exactly like a site they do not have.
 */
export default async function ConnectedAppsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/apps`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const r = await listProjectConnections(ctx, grant.projectId, { store: createSupabaseConnectionsStore() })
  const connections = r.ok ? r.connections : null

  let settings = null
  if (grant.permissions.includes(SETTINGS_READ)) {
    try {
      settings = await loadSettings(ctx, grant.projectId)
    } catch (error) {
      if (!(error instanceof TenantAuthorizationError) && !(error instanceof SettingsError)) throw error
    }
  }
  if (!connections && !settings) notFound()

  // The website's own standard disclosure sentence per site language (same function the website uses).
  const standardWording = settings ? Object.fromEntries(settings.locales.map((l) => [l, getCatalogueWebsiteMessages(l).affiliateDisclosureDefault])) : {}
  const t = await getTranslations('clientDashboard')
  return (
    <PageShell>
      <ConnectedAppsBrowser
        title={t('connections.title')}
        projectSlug={projectSlug}
        locale={await getLocale()}
        connections={connections}
        readOnly={Boolean(ctx.support)}
      >
        {settings ? <AffiliatePrograms projectSlug={projectSlug} initial={settings} standardWording={standardWording} readOnly={Boolean(ctx.support)} /> : null}
      </ConnectedAppsBrowser>
    </PageShell>
  )
}
