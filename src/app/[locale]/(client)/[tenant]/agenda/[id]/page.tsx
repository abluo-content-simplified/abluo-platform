import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { EVENT_DELETE_PERMISSION, EVENT_WRITE_PERMISSION, EventError, getEvent, isEventId, type EventSnapshot } from '@/lib/api/event-drafts'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { taxonomyWritePermission } from '@/lib/taxonomy/permissions'
import { EventEditor } from '@/components/client/events/EventEditor'
import { PageShell } from '@/components/app/ui/PageShell'
import { searchPersons } from '@/lib/api/persons'
import { PEOPLE_READ_PERMISSION, PEOPLE_WRITE_PERMISSION } from '@/lib/api/persons-lifecycle'

/**
 * One event (client dashboard · agenda/<id>): its facts, edited in place.
 * Changes are saved to a draft as you type; "Publish changes" updates the
 * website. Shows the draft when there is one, else the published event (the
 * first change opens the draft — from the browser, never on this GET).
 * Read permission to see it, write permission to change it; anything not this
 * project's event is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function EventPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/agenda/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isEventId(id)) notFound()

  let event: EventSnapshot
  try {
    event = await getEvent(ctx, grant.projectId, id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof EventError && error.code === 'not_found') notFound()
    throw error
  }

  // ADR-043: the hosts field shows only with the People module installed and people.person.read
  // (and the Events Hosts capability, checked in the editor). Hosts already on the event are named here.
  const people =
    grant.enabledModuleIds.includes('people') && grant.permissions.includes(PEOPLE_READ_PERMISSION)
      ? {
          initial: event.hostPeople.length
            ? await searchPersons(ctx, grant.projectId, { ids: event.hostPeople, limit: 1 })
                .then((items) => event.hostPeople.flatMap((pid) => items.filter((i) => i.id === pid)))
                .catch(() => [])
            : [],
          canCreate: grant.permissions.includes(PEOPLE_WRITE_PERMISSION),
        }
      : undefined

  return (
    <PageShell>
      <EventEditor
        projectSlug={projectSlug}
        initial={event}
        canWrite={grant.permissions.includes(EVENT_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(EVENT_DELETE_PERMISSION)}
        canAddCategory={grant.permissions.includes(taxonomyWritePermission('events'))}
        people={people}
      />
    </PageShell>
  )
}
