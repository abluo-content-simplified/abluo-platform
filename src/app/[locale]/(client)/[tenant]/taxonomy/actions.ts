'use server'

/**
 * Client dashboard — Categories & Tags server actions (ADR-033 Amendment J,
 * slice 3).
 *
 * Thin wrappers over `src/lib/taxonomy/service.ts`, which holds every check
 * (`<module>.taxonomy.write` via assertModuleAction before any I/O, the
 * manifest's declared kinds, project-scoped reads, deterministic ids, the
 * where-used guard on delete). Identity is re-resolved server-side on each
 * call; the URL's projectSlug only picks one of the caller's own grants.
 * Failures collapse to opaque codes; `detail` carries the using items on
 * `in_use`. Writes are immediate (no drafts).
 */
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { span, traced, withPerf, type PerfReport } from '@/lib/perf/timing'
import {
  TaxonomyError,
  createTerm,
  deleteTerm,
  listTerms,
  reorderTerms,
  updateTerm,
  type TaxonomyErrorCode,
  type TaxonomyErrorDetail,
  type TermList,
  type TermView,
} from '@/lib/taxonomy/service'

export type TaxonomyActionError = 'unauthenticated' | 'forbidden' | TaxonomyErrorCode
/** `perf` is present only when perfEnabled() (never in production). */
type Fail = { ok: false; error: TaxonomyActionError; detail?: TaxonomyErrorDetail; perf?: PerfReport }
type Result<T> = ({ ok: true; perf?: PerfReport } & T) | Fail

async function run<T>(
  op: string,
  projectSlug: unknown,
  fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>
): Promise<Result<T>> {
  // The resolver call (resolveProjectAction) stays in this function's body: the
  // support-mode guard test (client-actions-guard) checks every action reaches it.
  return traced(`taxonomy.${op}`, async (): Promise<Result<T>> =>
    withPerf(
      await (async (): Promise<Result<T>> => {
        const access = await span('auth', () => resolveProjectAction(projectSlug))
        if (!access.ok) return { ok: false, error: access.error }
        try {
          return { ok: true, ...(await fn(access.ctx, access.grant.projectId)) }
        } catch (error) {
          if (error instanceof TaxonomyError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
          if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
          return { ok: false, error: 'failed' }
        }
      })()
    )
  )
}

type Scope = { projectSlug: string; module: string; kind: string }

/** Terms of one module + kind with usage counts and per-language coverage. */
export async function listTaxonomyTermsAction(input: Scope): Promise<Result<{ list: TermList }>> {
  return run('list', input?.projectSlug, async (ctx, pid) => ({ list: await listTerms(ctx, pid, input.module, input.kind) }))
}

/**
 * Creates a term (inline "+ Add category" or the manager). `labels` needs the
 * default language; the result is the term to select at once. `created` is
 * false when a term with the same label already existed.
 */
export async function createTaxonomyTermAction(
  input: Scope & { labels: Record<string, string>; color?: string | null }
): Promise<Result<{ term: TermView; created: boolean }>> {
  return run('create', input?.projectSlug, (ctx, pid) => createTerm(ctx, pid, input.module, input.kind, { labels: input.labels, color: input.color }))
}

/** Labels / colour only. The key is immutable (`nextKey` other than `key` → key_immutable). */
export async function updateTaxonomyTermAction(
  input: Scope & { key: string; labels?: Record<string, string | null>; color?: string | null; nextKey?: string; rev?: string }
): Promise<Result<{ term: TermView }>> {
  return run('update', input?.projectSlug, (ctx, pid) =>
    updateTerm(ctx, pid, input.module, input.kind, input.key, { labels: input.labels, color: input.color, nextKey: input.nextKey, rev: input.rev })
  )
}

/** The listed keys first, in this order; unlisted terms follow. */
export async function reorderTaxonomyTermsAction(input: Scope & { keys: string[] }): Promise<Result<{ order: Array<{ key: string; order: number }> }>> {
  return run('reorder', input?.projectSlug, (ctx, pid) => reorderTerms(ctx, pid, input.module, input.kind, input.keys))
}

/** Unused terms only; a used one is refused with `in_use` + `detail.{count, items}`. */
export async function deleteTaxonomyTermAction(input: Scope & { key: string }): Promise<Result<{ key: string }>> {
  return run('delete', input?.projectSlug, (ctx, pid) => deleteTerm(ctx, pid, input.module, input.kind, input.key))
}
