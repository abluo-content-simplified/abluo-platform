import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  COURSE_DELETE_PERMISSION,
  COURSE_READ_PERMISSION,
  COURSE_WRITE_PERMISSION,
  CourseError,
  getCourseForEdit,
  isCourseId,
  type CourseSnapshot,
} from '@/lib/api/course-drafts'
import { listClasses, SCHEDULE_WRITE_PERMISSION, type ClassesScreen } from '@/lib/api/course-schedule'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CourseEditor } from '@/components/client/courses/CourseEditor'
import { CourseClasses } from '@/components/client/courses/CourseClasses'
import { Notice } from '@/components/app/ui/Notice'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * One course's editor (client dashboard · Courses, ADR-045), in the shared page
 * frame. Shows the draft when there is one, else the published course; GET
 * never creates a draft (the editor opens one on the first change). Needs
 * courses.course.read; without courses.course.write the editor is read-only.
 * Anything not this project's course is a 404.
 *
 * The Classes panel mounts through the editor's `classes` prop (the course's
 * weekly classes; editing needs courses.schedule.write). If the schedule cannot
 * be read, the rest of the editor still works and the panel says so.
 */
export const dynamic = 'force-dynamic'

export default async function CoursePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/courses/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isCourseId(id) || !grant.permissions.includes(COURSE_READ_PERMISSION) || !grant.enabledModuleIds.includes('courses')) notFound()

  let course: CourseSnapshot
  try {
    course = await getCourseForEdit(ctx, grant.projectId, id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof CourseError && error.code === 'not_found') notFound()
    throw error
  }

  let classesScreen: ClassesScreen | null = null
  try {
    classesScreen = await listClasses(ctx, grant.projectId, { courseId: course.publicId })
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    classesScreen = null
  }
  const mayEditClasses = grant.permissions.includes(SCHEDULE_WRITE_PERMISSION) && !course.archivedAt
  // Classes belong to the PUBLISHED course (the schedule guard checks it): a draft-only course is published first.
  const canSchedule = mayEditClasses && course.isPublished
  const tc = await getTranslations('clientDashboard.courses.classes')

  return (
    <PageShell>
      <CourseEditor
        key={course.id}
        projectSlug={projectSlug}
        initial={course}
        canWrite={grant.permissions.includes(COURSE_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(COURSE_DELETE_PERMISSION)}
        classes={
          classesScreen ? (
            <CourseClasses key={course.id} projectSlug={projectSlug} courseId={course.publicId} initial={classesScreen} canEdit={canSchedule} publishFirst={mayEditClasses && !course.isPublished} />
          ) : (
            <Notice tone="error">{tc('loadError')}</Notice>
          )
        }
      />
    </PageShell>
  )
}
