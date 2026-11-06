/**
 * Mints the private preview link of a course in the website timetable
 * (Courses module · ADR-045). Mirrors `post-preview.ts` / `person-preview.ts`;
 * the page it opens is `(website)/[tenant]/preview/course/[id]`: the real
 * timetable in the site's design, with THIS course (its draft, else its
 * published version) in it as if it were published — draft, scheduled or
 * "published with unpublished changes" alike.
 *
 * Gate, in order:
 *   1. `assertModuleAction(ctx, projectId, 'courses.course.write')` — module
 *      installed + the role may edit courses (as for opening a draft).
 *   2. The course is re-read: a `course` of the GRANT's project, else
 *      "not_found" (another project's course and a missing one look the same).
 *   3. A token of kind 'course' binding course + project + user, 15 minutes.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { COURSE_WRITE_PERMISSION, isCourseId } from '@/lib/api/course-lifecycle'
import { previewOrigin, sitePreviewThemes, PostPreviewError, type DraftPreviewLink, type PostPreviewDeps } from '@/lib/api/post-preview'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { previewSecret, signDraftPreviewToken } from '@/lib/preview/draft-preview-token'

type CourseLite = { _type?: string; projectSlug?: string; publicId?: unknown } | null | undefined

export async function mintCoursePreview(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; host?: string | null; proto?: 'https' | 'http' },
  deps: PostPreviewDeps = {},
): Promise<DraftPreviewLink> {
  assertModuleAction(ctx, projectId, COURSE_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const client = deps.client ?? sanityWriteClient

  if (!isCourseId(input?.id)) throw new PostPreviewError('not_found', 'Unknown course.')
  const secret = deps.secret === undefined ? previewSecret() : deps.secret
  if (!secret) throw new PostPreviewError('unavailable', 'Preview is not configured.')

  const doc = ((await client.getDocument(`drafts.${input.id}`)) ?? (await client.getDocument(input.id))) as CourseLite
  if (!doc || doc._type !== 'course' || doc.projectSlug !== grant.projectSlug || typeof doc.publicId !== 'string' || !doc.publicId) {
    throw new PostPreviewError('not_found', 'Unknown course.')
  }

  const themes = await sitePreviewThemes(client, grant.projectSlug)
  const { token, exp } = signDraftPreviewToken(
    { kind: 'course', draftId: input.id, projectSlug: grant.projectSlug, userId: ctx.userId },
    { secret, now: deps.now },
  )
  return {
    token,
    exp,
    origin: previewOrigin(input.host, { projectId: grant.projectId, projectSlug: grant.projectSlug }, input.proto),
    projectSlug: grant.projectSlug,
    themes,
  }
}
