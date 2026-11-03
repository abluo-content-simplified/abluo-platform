import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageShell } from '@/components/app/ui/PageShell'
import { SetupHeader } from '@/components/client/catalogue/setup/setup-ui'
import { setupHref } from '@/components/client/catalogue/setup/setup-model'
import { openSetupSection } from '../setup-route'

/**
 * Client dashboard — Catalogue → Setup → Starter Structures (spec §10.2, §12, C7).
 *
 * PLACEHOLDER SLOT (R2-B): the route, its permission (Setup permission only) and its card on the
 * Overview exist. The packs screen (choose, preview in full, apply, Start Empty) is built by the
 * starter-structures workstream, which replaces THIS FILE and adds its components under
 * `src/components/client/catalogue/setup/starters/**`.
 */
export const dynamic = 'force-dynamic'

export default async function CatalogueSetupStartersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { projectSlug } = await openSetupSection(params, 'starters')
  const t = await getTranslations('catalogue.setup.starters')
  return (
    <PageShell>
      <SetupHeader title={t('title')} backHref={setupHref(projectSlug, 'overview')} />
      <EmptyState title={t('placeholderTitle')} body={t('placeholderBody')} />
    </PageShell>
  )
}
