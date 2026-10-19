import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { FAQ_DELETE_PERMISSION, FAQ_READ_PERMISSION, FAQ_WRITE_PERMISSION, listFaqSets, type FaqSetListItem, type FaqSite } from '@/lib/api/faq-sets'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { FaqSetsBrowser } from '@/components/client/faq/FaqSetsBrowser'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — FAQ Sets (ADR-037 D9), in the shared page frame: the
 * library of the project's FAQ sets as a table (or cards) with the shared
 * list toolbar. Reads through `listFaqSets` (faq.set.read, project-scoped);
 * a project without the FAQ module gets a 404 like any unknown page. Filters
 * live in the query string; `?new=1` opens "New FAQ set".
 */
export const dynamic = 'force-dynamic'

export default async function FaqSetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') query.set(k, v)
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/faq-sets`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(FAQ_READ_PERMISSION)) notFound()

  let sets: FaqSetListItem[]
  let site: FaqSite
  try {
    const result = await listFaqSets(ctx, grant.projectId)
    sets = result.sets
    site = result.site
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <FaqSetsBrowser
        projectSlug={projectSlug}
        sets={sets}
        site={site}
        canWrite={grant.permissions.includes(FAQ_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(FAQ_DELETE_PERMISSION)}
        initialQuery={query.toString()}
      />
    </PageShell>
  )
}
