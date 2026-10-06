'use server'

/**
 * Client dashboard — AI assistance server actions (ADR-026).
 *
 * Thin wrappers over `src/lib/api/post-ai.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Nothing is written: the result is a
 * suggestion the UI shows side by side (Accept → normal autosave).
 */

import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { improvePostBody, improvePostLine, PostAiError, type PostAiErrorCode } from '@/lib/api/post-ai'

export type AiActionError = 'unauthenticated' | 'failed' | PostAiErrorCode

export type ImproveBodyResult = { ok: true; blocks: unknown[] } | { ok: false; error: AiActionError }

export async function improvePostBodyAction(input: {
  projectSlug: string
  locale: string
  blocks: unknown[]
}): Promise<ImproveBodyResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = resolveProjectGrant(ctx.projects, input?.projectSlug)
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    const { blocks } = await improvePostBody(ctx, grant.projectId, { locale: input.locale, blocks: input.blocks })
    return { ok: true, blocks }
  } catch (error) {
    if (error instanceof PostAiError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export type ImproveLineActionResult = { ok: true; text: string } | { ok: false; error: AiActionError }

/** "Improve title" / "Improve subtitle" — same gates as the body (see post-ai.ts). */
export async function improvePostLineAction(input: {
  projectSlug: string
  locale: string
  field: 'title' | 'subtitle'
  text: string
  title?: string
}): Promise<ImproveLineActionResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'unauthenticated' }
  const grant = resolveProjectGrant(ctx.projects, input?.projectSlug)
  if (!grant) return { ok: false, error: 'forbidden' }
  try {
    const { text } = await improvePostLine(ctx, grant.projectId, {
      locale: input.locale,
      field: input.field,
      text: input.text,
      title: input.title,
    })
    return { ok: true, text }
  } catch (error) {
    if (error instanceof PostAiError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}
