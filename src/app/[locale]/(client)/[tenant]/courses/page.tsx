import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { COURSE_DELETE_PERMISSION, COURSE_READ_PERMISSION, COURSE_WRITE_PERMISSION, listCourses, type CourseListItem, type CourseSite } from '@/lib/api/course-drafts'
import { courseScheduleDeps, SCHEDULE_WRITE_PERMISSION } from '@/lib/api/course-schedule'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CoursesBrowser } from '@/components/client/courses/CoursesBrowser'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Courses (ADR-045), in the shared page frame: the
 * project's courses as a table (or cards) with the shared list toolbar. Reads
 * through `listCourses` (courses.course.read, project-scoped); a project
 * without the Courses module gets a 404 like any unknown page. Filters live in
 * the query string; `?new=1` opens "New course".
 *
 * `/courses/timetable` (the Timetable page) is a static segment next to `[id]`
 * and wins over it; the header links to it.
 */
export const dynamic = 'force-dynamic'

export default async function CoursesPage({
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
  if (!ctx) redirect(`/login?next=/${projectSlug}/courses`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(COURSE_READ_PERMISSION) || !grant.enabledModuleIds.includes('courses')) notFound()

  let courses: CourseListItem[]
  let site: CourseSite
  try {
    const result = await listCourses(ctx, grant.projectId, courseScheduleDeps(grant.projectSlug))
    courses = result.courses
    site = result.site
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <CoursesBrowser
        projectSlug={projectSlug}
        courses={courses}
        defaultLocale={site.defaultLocale}
        timeZone={site.timeZone}
        canWrite={grant.permissions.includes(COURSE_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(COURSE_DELETE_PERMISSION)}
        canScheduleWrite={grant.permissions.includes(SCHEDULE_WRITE_PERMISSION)}
        initialQuery={query.toString()}
      />
    </PageShell>
  )
}
