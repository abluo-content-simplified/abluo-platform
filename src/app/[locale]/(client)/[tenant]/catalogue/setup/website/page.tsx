import { PageShell } from '@/components/app/ui/PageShell'
import { PublicWebsite } from '@/components/client/catalogue/setup/PublicWebsite'
import { setupHref } from '@/components/client/catalogue/setup/setup-model'
import { getCatalogueSite } from '@/lib/api/catalogue-drafts'
import { getProjectSiteDomain } from '@/lib/api/client-dashboard'
import { loadCatalogueSettings } from '@/lib/modules/catalogue/settings/service'
import { catalogueCurrencies, openSetupSection, readOr404 } from '../setup-route'

/**
 * Client dashboard — Catalogue → Setup → Public Website (spec §5.1, §10.8). Setup permission
 * only. The currency list is the Catalogue manifest's (the one the settings service validates).
 */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupWebsitePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { ctx, grant, projectSlug } = await openSetupSection(params, 'website')
  const [settings, site, domain] = await readOr404(() =>
    Promise.all([loadCatalogueSettings(ctx, grant.projectId), getCatalogueSite(ctx, grant.projectId), getProjectSiteDomain(ctx, grant.projectId).catch(() => null)]),
  )
  return (
    <PageShell>
      <PublicWebsite
        projectSlug={projectSlug}
        initial={settings}
        backHref={setupHref(projectSlug, 'overview')}
        currencies={catalogueCurrencies()}
        timeZone={site.timeZone}
        settingsHref={`/${projectSlug}/settings`}
        siteAddress={domain}
      />
    </PageShell>
  )
}
