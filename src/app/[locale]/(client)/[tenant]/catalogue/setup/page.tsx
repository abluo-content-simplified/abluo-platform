import { PageShell } from '@/components/app/ui/PageShell'
import { SetupOverview } from '@/components/client/catalogue/setup/SetupOverview'
import { labelText } from '@/components/client/catalogue/setup/setup-model'
import { getCatalogueGlance } from '@/lib/api/catalogue-drafts'
import { loadCatalogueSettings } from '@/lib/modules/catalogue/settings/service'
import { listTaxonomy } from '@/lib/modules/catalogue/taxonomy/service'
import { openSetupSection, readOr404 } from './setup-route'

/**
 * Client dashboard — Catalogue → Setup → Overview (ADR-042 N2a, spec §10.1). Setup permission
 * only; a person with only `catalogue.taxonomy.write` lands on Categories & Tags instead.
 */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { ctx, grant, projectSlug } = await openSetupSection(params, 'overview')
  const [settings, taxonomy, glance] = await readOr404(() => Promise.all([loadCatalogueSettings(ctx, grant.projectId), listTaxonomy(ctx, grant.projectId), getCatalogueGlance(ctx, grant.projectId)]))
  return (
    <PageShell>
      <SetupOverview
        projectSlug={projectSlug}
        data={{
          rev: settings.rev,
          completedAt: settings.setup.completedAt,
          source: settings.setup.source,
          counts: {
            items: glance.published + glance.drafts,
            categories: taxonomy.categories.length,
            tags: taxonomy.tags.length,
            channels: settings.channels.length,
            activeChannels: settings.channels.filter((c) => c.active).length,
            formatTemplates: settings.formatTemplates.length,
          },
          publicName: labelText(settings.publicName, settings.defaultLocale, settings.defaultLocale) || null,
          publicSegment: settings.publicSegment,
          currency: settings.currency,
        }}
      />
    </PageShell>
  )
}
