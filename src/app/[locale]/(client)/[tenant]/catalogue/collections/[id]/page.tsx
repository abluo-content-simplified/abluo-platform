import { notFound, redirect } from 'next/navigation'
import { span, traced } from '@/lib/perf/timing'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CatalogueError, catalogueAbilities, getCatalogueDoc, getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { isCatalogueId } from '@/lib/api/catalogue-lifecycle'
import { CollectionBuilder } from '@/components/client/catalogue/CollectionBuilder'
import { itemChoices } from '@/components/client/catalogue/choices'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/catalogue/collections/<id>` — the collection builder. Reads with catalogue.item.read (read-only
 * without catalogue.collection.write; every write is refused server-side). Anything that is not
 * this project's collection is a 404.
 */
export const dynamic = 'force-dynamic'

async function PageInner({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue/collections/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isCatalogueId(id)) notFound()
  let snapshot, site, lists
  try {
    ;[snapshot, site, lists] = await Promise.all([span('doc', () => getCatalogueDoc(ctx, grant.projectId, 'collection', id)), span('site', () => getCatalogueSite(ctx, grant.projectId)), span('listCatalogue', () => listCatalogue(ctx, grant.projectId))])
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof CatalogueError && error.code === 'not_found') notFound()
    throw error
  }
  return (
    <PageShell>
      <CollectionBuilder
        key={snapshot.rev || snapshot.live?.rev || id}
        projectSlug={projectSlug}
        site={site}
        snapshot={snapshot}
        items={itemChoices(lists, site.defaultLocale).filter((i) => i.id !== id)}
        can={catalogueAbilities(grant).collection}
        listHref={`/${projectSlug}/catalogue?view=collections`}
      />
    </PageShell>
  )
}

export default function Page(props: Parameters<typeof PageInner>[0]) {
  return traced('catalogue.collectionEditorPage', () => PageInner(props))
}
