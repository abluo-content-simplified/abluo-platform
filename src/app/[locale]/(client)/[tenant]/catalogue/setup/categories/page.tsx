import { PageShell } from '@/components/app/ui/PageShell'
import { CategoriesSetup } from '@/components/client/catalogue/setup/CategoriesSetup'
import { channelDraftsOf } from '@/components/client/catalogue/setup/setup-model'
import { loadCatalogueSettings } from '@/lib/modules/catalogue/settings/service'
import { listTaxonomy } from '@/lib/modules/catalogue/taxonomy/service'
import { openSetupSection, readOr404 } from '../setup-route'

/**
 * Client dashboard — Catalogue → Setup → Categories & Tags (spec §10.3, C8 §8.3). Open with the
 * Setup permission or `catalogue.taxonomy.write`; the screen offers only the operations the
 * person may run and shows the others disabled with the reason.
 */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupCategoriesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { ctx, grant, projectSlug, backHref } = await openSetupSection(params, 'categories')
  const [taxonomy, settings] = await readOr404(() => Promise.all([listTaxonomy(ctx, grant.projectId), loadCatalogueSettings(ctx, grant.projectId)]))
  return (
    <PageShell>
      <CategoriesSetup projectSlug={projectSlug} initial={taxonomy} channels={channelDraftsOf(settings.channels, settings.locales)} backHref={backHref} />
    </PageShell>
  )
}
