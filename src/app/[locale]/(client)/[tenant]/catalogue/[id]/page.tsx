import { notFound, redirect } from 'next/navigation'
import { span, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CatalogueError, catalogueAbilities, getCatalogueDoc, getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { isCatalogueId } from '@/lib/api/catalogue-lifecycle'
import { taxonomyWritePermission } from '@/lib/taxonomy/permissions'
import { ItemEditor } from '@/components/client/catalogue/ItemEditor'
import { optionListChoices } from '@/components/client/catalogue/choices'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/catalogue/<id>` — the item editor (tabbed). Reads with catalogue.item.read
 * (a viewer sees it read-only; every write is refused server-side). Anything
 * that is not this project's item is a 404.
 */
export const dynamic = 'force-dynamic'

async function CatalogueItemPageInner({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isCatalogueId(id)) notFound()
  let snapshot, site, lists
  try {
    ;[snapshot, site, lists] = await Promise.all([span('doc', () => getCatalogueDoc(ctx, grant.projectId, 'item', id)), span('site', () => getCatalogueSite(ctx, grant.projectId)), span('listCatalogue', () => listCatalogue(ctx, grant.projectId))])
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof CatalogueError && error.code === 'not_found') notFound()
    throw error
  }
  return (
    <PageShell>
      <ItemEditor
        key={snapshot.rev || snapshot.live?.rev || id}
        projectSlug={projectSlug}
        site={site}
        snapshot={snapshot}
        optionLists={optionListChoices(lists, site.defaultLocale)}
        can={catalogueAbilities(grant).item}
        canAddCategory={grant.permissions.includes(taxonomyWritePermission('catalogue'))}
        listHref={`/${projectSlug}/catalogue`}
      />
      {perfBeacon()}
    </PageShell>
  )
}

export default function CatalogueItemPage(props: Parameters<typeof CatalogueItemPageInner>[0]) {
  return traced('catalogue.itemEditorPage', () => CatalogueItemPageInner(props))
}
