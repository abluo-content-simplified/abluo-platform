'use server'

/**
 * Client dashboard — mint the private gallery preview link. Thin wrapper over
 * `src/lib/api/gallery-preview.ts`, which holds every check (same shape as
 * posts/preview-actions.ts).
 */

import { headers } from 'next/headers'
import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PostPreviewError, type DraftPreviewLink, type PostPreviewErrorCode } from '@/lib/api/post-preview'
import { mintGalleryPreview } from '@/lib/api/gallery-preview'

export type GalleryPreviewResult =
  | ({ ok: true; pageId: string | null } & DraftPreviewLink)
  | { ok: false; error: 'unauthenticated' | PostPreviewErrorCode }

export async function mintGalleryPreviewAction(input: {
  projectSlug: string
  id: string
  pageId?: string | null
}): Promise<GalleryPreviewResult> {
  const access = await resolveProjectAction(input.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  let host: string | null = null
  let proto: 'http' | 'https' = 'https'
  try {
    const h = await headers()
    host = h.get('x-forwarded-host') ?? h.get('host')
    proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https'
  } catch {
    // No request scope (tests): same-origin link.
  }
  try {
    return { ok: true, ...(await mintGalleryPreview(ctx, grant.projectId, { id: input.id, pageId: input.pageId, host, proto })) }
  } catch (error) {
    if (error instanceof PostPreviewError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
