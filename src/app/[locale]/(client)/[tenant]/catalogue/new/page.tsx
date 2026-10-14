import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { CATALOGUE_ITEM_WRITE_PERMISSION } from '@/lib/api/catalogue-lifecycle'
import { getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { ItemWizard } from '@/components/client/catalogue/ItemWizard'
import { optionListChoices } from '@/components/client/catalogue/choices'

/**
 * `/catalogue/new` — the item wizard with no document (lazy creation): a
 * full-screen flow (listed in the PageShell guard's wizards). Needs
 * catalogue.item.write, checked SERVER-side before any read: a viewer gets a
 * 404 here, not a hidden button (spec AC 5/6).
 */
export const dynamic = 'force-dynamic'

export default async function NewCatalogueItemPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue/new`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()
  try {
    assertModuleAction(ctx, grant.projectId, CATALOGUE_ITEM_WRITE_PERMISSION)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  const [site, lists] = await Promise.all([getCatalogueSite(ctx, grant.projectId), listCatalogue(ctx, grant.projectId)])
  return <ItemWizard projectSlug={projectSlug} site={site} optionLists={optionListChoices(lists, site.defaultLocale)} listHref={`/${projectSlug}/catalogue`} />
}
