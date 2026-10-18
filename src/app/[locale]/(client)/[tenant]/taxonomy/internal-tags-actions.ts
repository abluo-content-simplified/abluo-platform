'use server'

/**
 * Client dashboard — internal tags of photos and galleries (Categories & Tags
 * → Media / Galleries tabs). Thin wrappers over `src/lib/tags/service.ts`,
 * which holds every check (scope permission before any I/O, project from the
 * grant, revision guard, one transaction).
 */
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { span, traced } from '@/lib/perf/timing'
import { changeInternalTags, listInternalTagRows, TagError, type TagChangeResult, type TagErrorCode } from '@/lib/tags/service'
import type { InternalTagScope, TagChange, TagRow } from '@/lib/tags/internal-tags'

export type InternalTagsError = 'unauthenticated' | 'forbidden' | TagErrorCode
type Result<T> = ({ ok: true } & T) | { ok: false; error: InternalTagsError }

async function run<T>(op: string, projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  // The resolver call stays in this body: client-actions-guard checks every action reaches it.
  return traced(`internalTags.${op}`, async (): Promise<Result<T>> => {
    const access = await span('auth', () => resolveProjectAction(projectSlug))
    if (!access.ok) return { ok: false, error: access.error }
    try {
      return { ok: true, ...(await fn(access.ctx, access.grant.projectId)) }
    } catch (error) {
      if (error instanceof TagError) return { ok: false, error: error.code }
      if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
      return { ok: false, error: 'failed' }
    }
  })
}

const isScope = (s: unknown): s is InternalTagScope => s === 'media' || s === 'galleries'

/** Photos (or galleries) that carry tags, with their tags. */
export async function listInternalTagsAction(input: { projectSlug: string; scope: InternalTagScope }): Promise<Result<{ rows: TagRow[]; canWrite: boolean }>> {
  return run('list', input?.projectSlug, (ctx, pid) => {
    if (!isScope(input.scope)) throw new TagError('invalid_value', 'Unknown list.')
    return listInternalTagRows(ctx, pid, input.scope)
  })
}

/** Rename / merge (`op: 'merge'`) or delete tags on every photo or gallery that carries them. */
export async function changeInternalTagsAction(input: { projectSlug: string; scope: InternalTagScope; change: TagChange }): Promise<Result<TagChangeResult>> {
  return run('change', input?.projectSlug, (ctx, pid) => {
    if (!isScope(input.scope)) throw new TagError('invalid_value', 'Unknown list.')
    return changeInternalTags(ctx, pid, input.scope, input.change)
  })
}
