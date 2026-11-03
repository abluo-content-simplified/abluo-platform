import { PageShell } from '@/components/app/ui/PageShell'
import { ServiceChannels } from '@/components/client/catalogue/setup/ServiceChannels'
import { setupHref } from '@/components/client/catalogue/setup/setup-model'
import { loadCatalogueSettings } from '@/lib/modules/catalogue/settings/service'
import { openSetupSection, readOr404 } from '../setup-route'

/** Client dashboard — Catalogue → Setup → Service Channels (spec §10.4, C2). Setup permission only. */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupChannelsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { ctx, grant, projectSlug } = await openSetupSection(params, 'channels')
  const settings = await readOr404(() => loadCatalogueSettings(ctx, grant.projectId))
  return (
    <PageShell>
      <ServiceChannels projectSlug={projectSlug} initial={settings} backHref={setupHref(projectSlug, 'overview')} />
    </PageShell>
  )
}
