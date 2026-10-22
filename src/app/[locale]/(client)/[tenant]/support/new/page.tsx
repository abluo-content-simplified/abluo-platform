import { notFound, redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { NewRequestForm } from '@/components/client/tickets/NewRequestForm'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { ticketAccess } from '@/lib/support-tickets/access'
import { cleanFrom, cleanRelatedTo } from '@/lib/support-tickets/client-form'

/**
 * Client dashboard — Support › New Request (ADR-039). People who may not send
 * requests (read-only roles, an Abluo admin viewing as the client) go back to
 * the list, which says why. `?from=` is the page the person was on (the
 * "Report a Problem" menu item) and `?relatedTo=ABL-…` the closed request this
 * follows; both are only context for Abluo Support.
 */
export const dynamic = 'force-dynamic'

export default async function NewSupportRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ from?: string | string[]; relatedTo?: string | string[] }>
}) {
  const { tenant: projectSlug } = await params
  const query = await searchParams
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/support/new`)
  if (!resolveProjectGrant(ctx.projects, projectSlug)) notFound()
  const access = ticketAccess(ctx, projectSlug)
  if (!access || !access.canWrite) redirect(`/${projectSlug}/support`)

  return (
    <PageShell>
      <NewRequestForm projectSlug={projectSlug} from={cleanFrom(query.from)} relatedTo={cleanRelatedTo(query.relatedTo)} />
    </PageShell>
  )
}
