'use server'

/**
 * Client dashboard — mint the private preview link of a person's profile page.
 * Thin wrapper over `src/lib/api/person-preview.ts`, which holds every check.
 * The editor opens `personPreviewUrl({ ...result, locale, id })`
 * (`src/lib/client/preview-url.ts`) in a new tab.
 */

import { headers } from 'next/headers'
import { resolveProjectAction } from '@/lib/api/project-action'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { mintPersonPreview } from '@/lib/api/person-preview'
import { PostPreviewError, type DraftPreviewLink } from '@/lib/api/post-preview'
import type { MintPreviewResult } from '../posts/preview-actions'

export async function mintPersonPreviewAction(input: { projectSlug: string; id: string }): Promise<MintPreviewResult> {
  const access = await resolveProjectAction(input.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https'
    const link: DraftPreviewLink = await mintPersonPreview(ctx, grant.projectId, { id: input.id, host, proto })
    return { ok: true, ...link }
  } catch (error) {
    if (error instanceof PostPreviewError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
