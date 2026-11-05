import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { COURSE_READ_PERMISSION } from '@/lib/api/course-drafts'
import { SCHEDULE_WRITE_PERMISSION, timetable, type TimetableScreen } from '@/lib/api/course-schedule'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { Timetable } from '@/components/client/courses/Timetable'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — the Timetable (ADR-045): every weekly class of the site as
 * a grid of places × weekdays, with terms, holidays and (for the owner) online
 * rooms. A static segment next to `courses/[id]`, so it wins over it. Needs
 * courses.course.read; changing anything needs courses.schedule.write. A project
 * without the Courses module gets a 404.
 */
export const dynamic = 'force-dynamic'

export default async function TimetablePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/courses/timetable`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(COURSE_READ_PERMISSION) || !grant.enabledModuleIds.includes('courses')) notFound()

  let screen: TimetableScreen
  try {
    screen = await timetable(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <Timetable projectSlug={projectSlug} initial={screen} canWrite={grant.permissions.includes(SCHEDULE_WRITE_PERMISSION)} />
    </PageShell>
  )
}
