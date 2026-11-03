import { PageShell } from '@/components/app/ui/PageShell'
import { ItemDefaults } from '@/components/client/catalogue/setup/ItemDefaults'
import { setupHref } from '@/components/client/catalogue/setup/setup-model'
import { loadCatalogueSettings } from '@/lib/modules/catalogue/settings/service'
import { openSetupSection, readOr404 } from '../setup-route'

/** Client dashboard — Catalogue → Setup → Item Defaults (spec §10.6, C3-6). Setup permission only. */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupDefaultsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { ctx, grant, projectSlug } = await openSetupSection(params, 'defaults')
  const settings = await readOr404(() => loadCatalogueSettings(ctx, grant.projectId))
  return (
    <PageShell>
      <ItemDefaults projectSlug={projectSlug} initial={settings} backHref={setupHref(projectSlug, 'overview')} />
    </PageShell>
  )
}
