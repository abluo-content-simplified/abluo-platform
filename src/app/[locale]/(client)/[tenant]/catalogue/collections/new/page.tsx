import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { CATALOGUE_COLLECTION_WRITE_PERMISSION } from '@/lib/api/catalogue-lifecycle'
import { catalogueAbilities, getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { CollectionBuilder } from '@/components/client/catalogue/CollectionBuilder'
import { itemChoices } from '@/components/client/catalogue/choices'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/catalogue/collections/new` — the collection builder, nothing created until it has a name
 * (lazy creation). Needs catalogue.collection.write, checked SERVER-side before any read: a
 * viewer gets a 404 (spec AC 5/6).
 */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue/collections/new`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()
  try {
    assertModuleAction(ctx, grant.projectId, CATALOGUE_COLLECTION_WRITE_PERMISSION)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  const [site, lists] = await Promise.all([getCatalogueSite(ctx, grant.projectId), listCatalogue(ctx, grant.projectId)])
  return (
    <PageShell>
      <CollectionBuilder projectSlug={projectSlug} site={site} snapshot={null} items={itemChoices(lists, site.defaultLocale)} can={catalogueAbilities(grant).collection} listHref={`/${projectSlug}/catalogue?view=collections`} />
    </PageShell>
  )
}
