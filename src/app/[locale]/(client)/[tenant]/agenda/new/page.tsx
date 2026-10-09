import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { EVENT_WRITE_PERMISSION, getEventSite } from '@/lib/api/event-drafts'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { NewEventForm } from '@/components/client/events/NewEventForm'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * `/agenda/new` — name the event and pick its start; nothing exists until
 * "Create". Then the event's own page opens to fill in the rest. Needs
 * events.event.write.
 */
export const dynamic = 'force-dynamic'

export default async function NewEventPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/agenda/new`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(EVENT_WRITE_PERMISSION)) notFound()
  try {
    await getEventSite(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <NewEventForm projectSlug={projectSlug} />
    </PageShell>
  )
}
