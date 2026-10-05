'use server'

/**
 * Client dashboard — post images (cover step of the Create flow, ADR-025).
 *
 * Thin wrappers over `src/lib/api/post-media.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug is
 * only used to pick one of the caller's own grants. Failures collapse to the
 * small set of opaque codes the Cover step understands.
 *
 * Upload body size: next.config sets `experimental.serverActions.bodySizeLimit`
 * to 4 MB (under Vercel's 4.5 MB request limit). The Cover step only
 * pre-resizes photos above that (see `planUpload` in
 * src/lib/client/upload-plan.ts), so TinyPNG compresses the original.
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  getPostCover,
  listProjectMedia,
  PostMediaError,
  setPostCover,
  uploadPostImage,
  type PostCover,
  type PostMediaErrorCode,
  type ProjectMediaItem,
  type UploadedPostImage,
} from '@/lib/api/post-media'

export type MediaActionError = 'unauthenticated' | PostMediaErrorCode

export type UploadPostImageResult = ({ ok: true } & UploadedPostImage) | { ok: false; error: MediaActionError }
export type ListProjectMediaResult =
  | { ok: true; items: ProjectMediaItem[]; nextCursor: string | null; tags: string[] }
  | { ok: false; error: MediaActionError }
export type SetPostCoverResult = { ok: true; rev: string; cover: PostCover | null } | { ok: false; error: MediaActionError }
export type GetPostCoverResult = { ok: true; cover: PostCover | null } | { ok: false; error: MediaActionError }

async function resolve(projectSlug: unknown) {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { error: 'unauthenticated' as const }
  const grant = typeof projectSlug === 'string' ? resolveProjectGrant(ctx.projects, projectSlug) : null
  if (!grant) return { error: 'forbidden' as const }
  return { ctx, grant }
}

function toError(error: unknown): MediaActionError {
  if (error instanceof PostMediaError) return error.code
  if (error instanceof TenantAuthorizationError) return 'forbidden'
  return 'failed'
}

/** FormData: `projectSlug`, `file`. */
export async function uploadPostImageAction(formData: FormData): Promise<UploadPostImageResult> {
  const r = await resolve(formData?.get?.('projectSlug'))
  if ('error' in r) return { ok: false, error: r.error! }
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'invalid_value' }
  try {
    return { ok: true, ...(await uploadPostImage(r.ctx, r.grant.projectId, file)) }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}

export async function listProjectMediaAction(input: {
  projectSlug: string
  cursor?: string | null
  q?: string | null
  tags?: string[] | null
}): Promise<ListProjectMediaResult> {
  const r = await resolve(input?.projectSlug)
  if ('error' in r) return { ok: false, error: r.error! }
  try {
    const page = await listProjectMedia(r.ctx, r.grant.projectId, {
      cursor: input.cursor ?? null,
      q: input.q ?? null,
      tags: input.tags ?? null,
    })
    return { ok: true, ...page }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}

export async function setPostCoverAction(
  input:
    | {
        projectSlug: string
        id: string
        rev: string
        assetId: string
        alt?: Record<string, string> | null
        focal?: { x: number; y: number } | null
      }
    | { projectSlug: string; id: string; rev: string; remove: true }
): Promise<SetPostCoverResult> {
  const r = await resolve(input?.projectSlug)
  if ('error' in r) return { ok: false, error: r.error! }
  try {
    const payload =
      'remove' in input
        ? { id: input.id, rev: input.rev, remove: input.remove }
        : { id: input.id, rev: input.rev, assetId: input.assetId, alt: input.alt, focal: input.focal }
    return { ok: true, ...(await setPostCover(r.ctx, r.grant.projectId, payload)) }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}

export async function getPostCoverAction(input: { projectSlug: string; id: string }): Promise<GetPostCoverResult> {
  const r = await resolve(input?.projectSlug)
  if ('error' in r) return { ok: false, error: r.error! }
  try {
    return { ok: true, cover: await getPostCover(r.ctx, r.grant.projectId, { id: input.id }) }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}
