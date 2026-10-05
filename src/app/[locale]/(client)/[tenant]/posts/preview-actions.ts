'use server'

/**
 * Client dashboard — mint the private draft-preview link (ADR-025 · preview).
 *
 * Thin wrapper over `src/lib/api/post-preview.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. The request host decides whether the
 * preview loads from the same origin or from the project's own host.
 */

import { headers } from 'next/headers'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { mintDraftPreview, PostPreviewError, type DraftPreviewLink, type PostPreviewErrorCode } from '@/lib/api/post-preview'

export type PreviewActionError = 'unauthenticated' | PostPreviewErrorCode
export type MintPreviewResult = ({ ok: true } & DraftPreviewLink) | { ok: false; error: PreviewActionError }

export async function mintDraftPreviewAction(input: { projectSlug: string; id: string }): Promise<MintPreviewResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = typeof input?.projectSlug === 'string' ? resolveProjectGrant(ctx.projects, input.projectSlug) : null
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https'
    return { ok: true, ...(await mintDraftPreview(ctx, grant.projectId, { id: input.id, host, proto })) }
  } catch (error) {
    if (error instanceof PostPreviewError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
