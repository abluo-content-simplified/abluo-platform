import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { FAQ_DELETE_PERMISSION, FAQ_READ_PERMISSION, FAQ_WRITE_PERMISSION, FaqSetError, getFaqSet, isFaqSetId, type FaqSetSnapshot } from '@/lib/api/faq-sets'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { FaqSetEditor } from '@/components/client/faq/FaqSetEditor'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * One FAQ set's editor (client dashboard · FAQ Sets, ADR-037 D9), in the
 * shared page frame. Shows the draft when there is one, else the published
 * set; GET never creates a draft (the editor opens one from the browser on
 * the first change). Needs faq.set.read; without faq.set.write the editor is
 * read-only. Anything not this project's set is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function FaqSetPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/faq-sets/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isFaqSetId(id) || !grant.permissions.includes(FAQ_READ_PERMISSION)) notFound()

  let set: FaqSetSnapshot
  try {
    set = await getFaqSet(ctx, grant.projectId, id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof FaqSetError && error.code === 'not_found') notFound()
    throw error
  }

  return (
    <PageShell>
      <FaqSetEditor
        key={set.id}
        projectSlug={projectSlug}
        initial={set}
        mode="page"
        canWrite={grant.permissions.includes(FAQ_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(FAQ_DELETE_PERMISSION)}
      />
    </PageShell>
  )
}
