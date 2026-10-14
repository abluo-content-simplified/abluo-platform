import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { CATALOGUE_ITEM_WRITE_PERMISSION } from '@/lib/api/catalogue-lifecycle'
import { catalogueAbilities, getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { OptionListEditor } from '@/components/client/catalogue/OptionListEditor'
import { itemChoices } from '@/components/client/catalogue/choices'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/catalogue/option-lists/new` — an option list, nothing created until it has a name
 * (lazy creation). Needs catalogue.item.write (option lists use the item permissions, ADR-033 C4), checked SERVER-side before any read: a
 * viewer gets a 404 (spec AC 5/6).
 */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue/option-lists/new`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()
  try {
    assertModuleAction(ctx, grant.projectId, CATALOGUE_ITEM_WRITE_PERMISSION)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  const [site, lists] = await Promise.all([getCatalogueSite(ctx, grant.projectId), listCatalogue(ctx, grant.projectId)])
  return (
    <PageShell>
      <OptionListEditor projectSlug={projectSlug} site={site} snapshot={null} items={itemChoices(lists, site.defaultLocale)} can={catalogueAbilities(grant).optionList} listHref={`/${projectSlug}/catalogue?view=optionLists`} />
    </PageShell>
  )
}
