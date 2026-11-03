import { PageShell } from '@/components/app/ui/PageShell'
import { StarterStructures } from '@/components/client/catalogue/setup/starters/StarterStructures'
import { setupHref } from '@/components/client/catalogue/setup/setup-model'
import { loadStarterStructures } from '@/lib/modules/catalogue/packs/service'
import { openSetupSection, readOr404 } from '../setup-route'

/**
 * Client dashboard — Catalogue → Setup → Starter Structures (spec §10.2, §12, C7): choose a pack,
 * preview exactly what it adds, apply it in one transaction, see what was applied and review
 * optional updates. Setup permission only (`catalogue.setup.manage`).
 */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupStartersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { ctx, grant, projectSlug } = await openSetupSection(params, 'starters')
  const view = await readOr404(() => loadStarterStructures(ctx, grant.projectId))
  return (
    <PageShell>
      <StarterStructures projectSlug={projectSlug} initial={view} backHref={setupHref(projectSlug, 'overview')} />
    </PageShell>
  )
}
