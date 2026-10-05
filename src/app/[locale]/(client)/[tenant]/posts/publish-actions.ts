'use server'

/**
 * Client dashboard — publish a blog post draft (ADR-025 · S5).
 *
 * Thin wrapper over `src/lib/api/post-publish.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug is
 * only used to pick one of the caller's own grants. Failures collapse to the
 * small set of opaque codes documented in post-publish.ts.
 *
 * No revalidation call is needed: website post routes are force-dynamic and
 * read Sanity without the CDN, so the next request already sees the change.
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PostDraftError } from '@/lib/api/post-drafts'
import { publishPostDraft, PostPublishError, type PostPublishErrorCode } from '@/lib/api/post-publish'

export type PublishActionError = 'unauthenticated' | PostPublishErrorCode

export type PublishDraftResult =
  | { ok: true; id: string; publishedAt: string; slugs: Record<string, string> }
  | { ok: false; error: PublishActionError }

function toError(error: unknown): PublishActionError {
  if (error instanceof PostPublishError || error instanceof PostDraftError) return error.code
  if (error instanceof TenantAuthorizationError) return 'forbidden'
  return 'failed'
}

export async function publishPostDraftAction(input: {
  projectSlug: string
  id: string
  rev: string
  mode: 'now' | 'schedule' | 'keep'
  publishAt?: string
  expiresAt?: string | null
}): Promise<PublishDraftResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = resolveProjectGrant(ctx.projects, input?.projectSlug)
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    const r = await publishPostDraft(ctx, grant.projectId, {
      id: input.id,
      rev: input.rev,
      mode: input.mode,
      publishAt: input.publishAt,
      expiresAt: input.expiresAt,
    })
    return { ok: true, id: r.id, publishedAt: r.publishedAt, slugs: r.slugs }
  } catch (error) {
    return { ok: false, error: toError(error) }
  }
}
