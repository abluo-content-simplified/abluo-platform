'use server'

/**
 * Client dashboard — Media screen server actions. Thin wrappers over
 * `src/lib/api/media-library.ts` and the shared Media Library code; every
 * check lives there. Gate: MEDIA_MANAGE_PERMISSION (owner/editor).
 */

import { span, traced, withPerf, type PerfReport } from '@/lib/perf/timing'
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { listMediaLibrary, type MediaLibraryItem } from '@/lib/api/media-library'
import {
  getProjectMediaStatus,
  PostMediaError,
  uploadProjectImage,
  type MediaUploadStatus,
  type PostMediaErrorCode,
  type UploadedPostImage,
} from '@/lib/api/post-media'
import { GalleryError, type GalleryErrorCode } from '@/lib/api/gallery-drafts'
import { batchUpdatePhotos, updateGalleryPhoto, type BatchPhotosInput, type UpdateGalleryPhotoInput } from '@/lib/api/gallery-photos'

export type MediaScreenError = 'unauthenticated' | PostMediaErrorCode | GalleryErrorCode
/** `perf` is present only when perfEnabled() (never in production). */
type Result<T> = ({ ok: true; perf?: PerfReport } & T) | { ok: false; error: MediaScreenError; perf?: PerfReport }

async function run<T>(
  projectSlug: unknown,
  fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>,
  op = 'media.action'
): Promise<Result<T>> {
  // The resolver call stays in this function's body: the support-mode guard
  // test (client-actions-guard) checks every action reaches it through a local helper.
  return traced(op, async (): Promise<Result<T>> =>
    withPerf(
      await (async (): Promise<Result<T>> => {
        const access = await span('auth', () => resolveProjectAction(projectSlug))
        if (!access.ok) return { ok: false, error: access.error }
        const { ctx, grant } = access
        try {
          return { ok: true, ...(await fn(ctx, grant.projectId)) }
        } catch (error) {
          if (error instanceof PostMediaError || error instanceof GalleryError) return { ok: false, error: error.code }
          if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
          return { ok: false, error: 'failed' }
        }
      })()
    )
  )
}

export async function listMediaLibraryAction(input: {
  projectSlug: string
  cursor?: string | null
  q?: string | null
  tags?: string[] | null
}): Promise<Result<{ items: MediaLibraryItem[]; nextCursor: string | null; tags: string[]; tagCounts: { tag: string; count: number }[] }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    listMediaLibrary(ctx, pid, { cursor: input.cursor ?? null, q: input.q ?? null, tags: input.tags ?? null })
  )
}

/**
 * FormData: `projectSlug`, `file`, optional `background=1` (ADR-035: answer
 * once the record exists; poll `mediaStatusAction`). Files the photo in the
 * Media Library (no tag).
 */
export async function uploadMediaImageAction(formData: FormData): Promise<Result<UploadedPostImage>> {
  const file = formData?.get?.('file')
  const background = formData?.get?.('background') === '1'
  return run(formData?.get?.('projectSlug'), async (ctx, pid) => {
    if (!(file instanceof File)) throw new PostMediaError('invalid_value', 'No file.')
    return uploadProjectImage(ctx, pid, file, { tag: '', permission: MEDIA_MANAGE_PERMISSION, background })
  }, 'media.upload')
}

/** Where background uploads are (ADR-035). */
export async function mediaStatusAction(input: { projectSlug: string; assetIds: string[] }): Promise<Result<{ items: MediaUploadStatus[] }>> {
  return run(input?.projectSlug, (ctx, pid) => getProjectMediaStatus(ctx, pid, input?.assetIds, {}, MEDIA_MANAGE_PERMISSION), 'media.status')
}

export async function updateMediaPhotoAction(
  input: { projectSlug: string } & UpdateGalleryPhotoInput
): Promise<Result<Awaited<ReturnType<typeof updateGalleryPhoto>>>> {
  return run(input?.projectSlug, (ctx, pid) =>
    updateGalleryPhoto(
      ctx,
      pid,
      { assetId: input.assetId, rev: input.rev, name: input.name, alt: input.alt, title: input.title, caption: input.caption, tags: input.tags, focal: input.focal },
      {},
      MEDIA_MANAGE_PERMISSION
    )
  )
}

/** Rename (base name + number), add tags and/or describe up to 100 photos; each is checked on its own. */
export async function batchMediaPhotosAction(
  input: { projectSlug: string } & BatchPhotosInput
): Promise<Result<Awaited<ReturnType<typeof batchUpdatePhotos>>>> {
  return run(input?.projectSlug, (ctx, pid) =>
    batchUpdatePhotos(ctx, pid, { assetIds: input.assetIds, baseName: input.baseName, addTags: input.addTags, alt: input.alt }, {}, MEDIA_MANAGE_PERMISSION)
  )
}
