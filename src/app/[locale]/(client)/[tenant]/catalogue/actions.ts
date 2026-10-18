'use server'

/**
 * Client dashboard — Catalogue server actions (ADR-033, spec §10).
 *
 * Thin wrappers over `src/lib/api/catalogue-drafts.ts`, which holds every
 * check (assertModuleAction before any read, ownership re-read, revision
 * guards). Identity is re-resolved server-side on each call; the URL's
 * projectSlug only picks one of the caller's own grants. Failures collapse to
 * opaque codes; `detail` carries the named slug owners (slug_taken), the
 * documents that block an archive / delete (in_use → referrers), or the
 * never-published dependencies a publish needs (unpublished_dependencies →
 * dependencies, ADR-033 D-4).
 */
import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { span, traced, withPerf, type PerfReport } from '@/lib/perf/timing'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import {
  CatalogueError,
  checkCatalogueSlugs,
  createCatalogueDoc,
  discardCatalogueDraft,
  getCatalogueDoc,
  listCatalogue,
  openCatalogueForEdit,
  resolveAmazonLink,
  patchCatalogueDraft,
  previewCataloguePublish,
  publishCatalogueDraft,
  runCatalogueLifecycle,
  type CatalogueErrorCode,
  type CatalogueKind,
  type CatalogueLifecycleOp,
  type CatalogueLists,
  type CataloguePublishInput,
  type CataloguePublishPreview,
  type CatalogueSnapshot,
} from '@/lib/api/catalogue-drafts'
import type { CatalogueErrorDetail } from '@/lib/modules/catalogue/dashboard-patch'
import type { NamedSlugConflict } from '@/lib/modules/catalogue/validation'

export type CatalogueActionError = 'unauthenticated' | CatalogueErrorCode
/** `perf` is present only when perfEnabled() (never in production): op, ms, outcome, span ms. */
type Fail = { ok: false; error: CatalogueActionError; detail?: CatalogueErrorDetail; perf?: PerfReport }
type Result<T> = ({ ok: true; perf?: PerfReport } & T) | Fail

const KINDS: readonly CatalogueKind[] = ['item', 'collection', 'optionList']

async function run<T>(
  op: string,
  projectSlug: unknown,
  fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>
): Promise<Result<T>> {
  // The resolver call (resolveProjectAction) stays in this function's body: the
  // support-mode guard test (client-actions-guard) checks every action reaches it.
  return traced(`catalogue.${op}`, async (): Promise<Result<T>> =>
    withPerf(
      await (async (): Promise<Result<T>> => {
        // Identity + this project's grant, re-resolved from the database (shared helper, scoped to one project).
        const access = await span('auth', () => resolveProjectAction(projectSlug))
        if (!access.ok) return { ok: false, error: access.error }
        try {
          return { ok: true, ...(await fn(access.ctx, access.grant.projectId)) }
        } catch (error) {
          if (error instanceof CatalogueError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail }) }
          if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
          return { ok: false, error: 'failed' }
        }
      })()
    )
  )
}

const kindOf = (kind: unknown): CatalogueKind => {
  if (!KINDS.includes(kind as CatalogueKind)) throw new CatalogueError('invalid_value', 'Unknown kind.')
  return kind as CatalogueKind
}

export async function listCatalogueAction(input: { projectSlug: string }): Promise<Result<{ lists: CatalogueLists }>> {
  return run('list', input?.projectSlug, async (ctx, pid) => ({ lists: await listCatalogue(ctx, pid) }))
}

export async function getCatalogueDocAction(input: { projectSlug: string; kind: CatalogueKind; id: string }): Promise<Result<{ doc: CatalogueSnapshot }>> {
  return run('get', input?.projectSlug, async (ctx, pid) => ({ doc: await getCatalogueDoc(ctx, pid, kindOf(input.kind), input.id) }))
}

export async function createCatalogueDocAction(input: {
  projectSlug: string
  kind: CatalogueKind
  name?: string
  itemProfile?: string
  collectionType?: string
}): Promise<Result<{ id: string; rev: string }>> {
  return run('create', input?.projectSlug, (ctx, pid) => createCatalogueDoc(ctx, pid, kindOf(input.kind), { name: input.name, itemProfile: input.itemProfile, collectionType: input.collectionType }))
}

/** Creates drafts.<id> from the published document when missing. Call before the first edit. */
export async function openCatalogueForEditAction(input: { projectSlug: string; kind: CatalogueKind; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run('open', input?.projectSlug, (ctx, pid) => openCatalogueForEdit(ctx, pid, kindOf(input.kind), input.id))
}

export async function patchCatalogueDraftAction(input: {
  projectSlug: string
  kind: CatalogueKind
  id: string
  rev: string
  set: Record<string, unknown>
  /** First edit of a published document: the live revision the editor loaded (rev is then ''). */
  openFrom?: string
}): Promise<Result<{ rev: string }>> {
  return run('patch', input?.projectSlug, (ctx, pid) =>
    patchCatalogueDraft(ctx, pid, kindOf(input.kind), { id: input.id, rev: input.rev, set: input.set, openFrom: typeof input.openFrom === 'string' ? input.openFrom : undefined })
  )
}

/** Amazon app link → the product URL it opens (null = could not be read; the editor keeps the link and says so). */
export async function resolveAmazonLinkAction(input: { projectSlug: string; url: string }): Promise<Result<{ url: string | null }>> {
  return run('resolveAmazon', input?.projectSlug, (ctx, pid) => resolveAmazonLink(ctx, pid, input.url))
}

export async function publishCatalogueDraftAction(
  input: { projectSlug: string; kind: CatalogueKind } & CataloguePublishInput
): Promise<Result<Awaited<ReturnType<typeof publishCatalogueDraft>>>> {
  return run('publish', input?.projectSlug, (ctx, pid) =>
    publishCatalogueDraft(ctx, pid, kindOf(input.kind), {
      id: input.id,
      rev: input.rev,
      mode: input.mode,
      publishAt: input.publishAt,
      expiresAt: input.expiresAt,
      withDependencies: input.withDependencies === true,
    })
  )
}

/** D-5 — what "Publish … and dependencies" would publish (read-only, for the confirmation panel). */
export async function previewCataloguePublishAction(input: { projectSlug: string; kind: CatalogueKind; id: string; publishAt?: string | null }): Promise<Result<{ preview: CataloguePublishPreview }>> {
  return run('publishPreview', input?.projectSlug, async (ctx, pid) => ({ preview: await previewCataloguePublish(ctx, pid, kindOf(input.kind), { id: input.id, publishAt: input.publishAt }) }))
}

export async function discardCatalogueDraftAction(input: { projectSlug: string; kind: CatalogueKind; id: string; rev: string }): Promise<Result<object>> {
  return run('discard', input?.projectSlug, async (ctx, pid) => {
    await discardCatalogueDraft(ctx, pid, kindOf(input.kind), { id: input.id, rev: input.rev })
    return {}
  })
}

export async function catalogueLifecycleAction(input: {
  projectSlug: string
  kind: CatalogueKind
  op: CatalogueLifecycleOp
  id: string
  rev?: string
  expiresAt?: string | null
}): Promise<Result<{ rev: string | null }>> {
  return run('lifecycle', input?.projectSlug, (ctx, pid) => runCatalogueLifecycle(ctx, pid, kindOf(input.kind), { op: input.op, id: input.id, rev: input.rev, expiresAt: input.expiresAt }))
}

/** Which other item or collection already uses these addresses (named). */
export async function checkCatalogueSlugsAction(input: { projectSlug: string; id: string; slugs: Record<string, string> }): Promise<Result<{ conflicts: NamedSlugConflict[] }>> {
  return run('checkSlugs', input?.projectSlug, async (ctx, pid) => ({ conflicts: await checkCatalogueSlugs(ctx, pid, { id: input.id, slugs: input.slugs }) }))
}
