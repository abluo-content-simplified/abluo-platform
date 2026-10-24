import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { EVENT_WRITE_PERMISSION, listEventsWithCategories, type EventListScreen } from '@/lib/api/event-drafts'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { EventList } from '@/components/client/events/EventList'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Events (Events module), in the shared page frame: coming
 * up first, then past events. The segment is `agenda` because `events` is the
 * public website's own route (CLIENT_PROJECT_SEGMENTS stays disjoint from it).
 * Reads through `listEventsWithCategories` (events.event.read, project-scoped:
 * the events plus the project's event categories, in parallel); a project
 * without the Events module gets a 404 like any unknown page.
 */
export const dynamic = 'force-dynamic'

export default async function EventsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/agenda`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  let screen: EventListScreen
  try {
    screen = await listEventsWithCategories(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <EventList
        projectSlug={projectSlug}
        events={screen.events}
        categoryOptions={screen.categoryOptions}
        defaultLocale={screen.defaultLocale}
        canWrite={grant.permissions.includes(EVENT_WRITE_PERMISSION)}
      />
    </PageShell>
  )
}
