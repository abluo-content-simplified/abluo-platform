import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CatalogueError, catalogueAbilities, getCatalogueDoc, getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { isCatalogueId } from '@/lib/api/catalogue-lifecycle'
import { OptionListEditor } from '@/components/client/catalogue/OptionListEditor'
import { itemChoices } from '@/components/client/catalogue/choices'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/catalogue/option-lists/<id>` — an option list. Reads with catalogue.item.read (read-only
 * without catalogue.item.write (option lists use the item permissions, ADR-033 C4); every write is refused server-side). Anything that is not
 * this project's option list is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue/option-lists/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isCatalogueId(id)) notFound()
  let snapshot, site, lists
  try {
    ;[snapshot, site, lists] = await Promise.all([getCatalogueDoc(ctx, grant.projectId, 'optionList', id), getCatalogueSite(ctx, grant.projectId), listCatalogue(ctx, grant.projectId)])
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof CatalogueError && error.code === 'not_found') notFound()
    throw error
  }
  return (
    <PageShell>
      <OptionListEditor
        key={snapshot.rev || snapshot.live?.rev || id}
        projectSlug={projectSlug}
        site={site}
        snapshot={snapshot}
        items={itemChoices(lists, site.defaultLocale).filter((i) => i.id !== id)}
        can={catalogueAbilities(grant).optionList}
        listHref={`/${projectSlug}/catalogue?view=optionLists`}
      />
    </PageShell>
  )
}
