'use server'

/**
 * Client dashboard — mint the private preview link of a course in the website
 * timetable. Thin wrapper over `src/lib/api/course-preview.ts`, which holds
 * every check. The editor opens `coursePreviewUrl({ ...result, locale, id })`
 * (`src/lib/client/preview-url.ts`) in a new tab.
 */

import { headers } from 'next/headers'
import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { mintCoursePreview } from '@/lib/api/course-preview'
import { PostPreviewError, type DraftPreviewLink } from '@/lib/api/post-preview'
import type { MintPreviewResult } from '../posts/preview-actions'

export async function mintCoursePreviewAction(input: { projectSlug: string; id: string }): Promise<MintPreviewResult> {
  const access = await resolveProjectAction(input.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https'
    const link: DraftPreviewLink = await mintCoursePreview(ctx, grant.projectId, { id: input.id, host, proto })
    return { ok: true, ...link }
  } catch (error) {
    if (error instanceof PostPreviewError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
