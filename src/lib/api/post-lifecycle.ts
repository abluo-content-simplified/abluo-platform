/**
 * Client dashboard — editing live posts and their lifecycle (ADR-025 · wave 2).
 *
 * Same enforcement as post-drafts.ts / post-publish.ts, on every call:
 *   1. `assertModuleAction(ctx, projectId, <permission>)` before any I/O.
 *   2. The id must be a safe post id (`isPostId`); the documents are re-read
 *      and must be `post`s whose own projectSlug is the GRANT's — anything
 *      else (another project, a missing doc) is "not_found", so ids can't be probed.
 *   3. Writes are revision-guarded (`ifRevisionId` / transaction `ifRevisionID`);
 *      a moved revision is "conflict". Other failures are an opaque "failed".
 *
 * Taking a post offline (D5): a guarded patch that sets `expiresAt = now` on
 * the published document. Every website read already filters with POST_IS_LIVE
 * (`publishedAt <= now() && (!defined(expiresAt) || expiresAt > now())`), so the
 * post disappears from lists, its detail URL, the sitemap and hreflang at once,
 * and the dashboard shows it as "offline". Nothing is unpublished or deleted,
 * so "Put back online" (unset expiresAt) restores it with its URLs intact.
 *
 * Lifecycle (ADR-032 D5–D7, slice 4): offline, back online, end date,
 * archive, restore and both deletes are thin wrappers over the one lifecycle
 * service (`@/lib/lifecycle/service`), which also writes the Activity row
 * (D9) after the change succeeded.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { BLOG_POST_WRITE_PERMISSION, isPostId, LIMITS, liveState, PostDraftError, type PostDraftErrorCode, type PostLiveState } from '@/lib/api/post-drafts'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { ContentAuditWriter } from '@/lib/lifecycle/audit'
import * as lifecycle from '@/lib/lifecycle/service'
import { countReferences, type LifecycleDescriptor } from '@/lib/lifecycle/service'

export const BLOG_POST_DELETE_PERMISSION = 'blog.post.delete'
/** Deleting a post that is live on the website (ADR-028: Owner and Site admin). */
export const BLOG_PUBLISHED_DELETE_PERMISSION = 'blog.published.delete'

type LifecycleClient = Pick<typeof sanityWriteClient, 'getDocument' | 'create' | 'patch' | 'transaction' | 'fetch'>
export type PostLifecycleDeps = { client?: LifecycleClient; now?: () => Date; audit?: ContentAuditWriter }

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

/** Fields Sanity owns; never copied into a new document. */
const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new PostDraftError('not_found', 'Unknown post.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === 'post' && doc.projectSlug === projectSlug)
}

async function read(client: LifecycleClient, id: string, projectSlug: string) {
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [
    Doc | undefined,
    Doc | undefined,
  ]
  // A document that exists but is not this project's post makes the whole id unknown.
  if ((published && !ours(published, projectSlug)) || (draft && !ours(draft, projectSlug))) notFound()
  return { published, draft }
}

/** Every mutation: the single-Sanity-project guard first (refusal → 'forbidden'), then the write. */
async function commit(client: LifecycleClient, projectSlug: string, run: () => Promise<unknown>): Promise<void> {
  await assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)
  try {
    await run()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      throw new PostDraftError('conflict', 'This post was changed elsewhere.')
    }
    throw new PostDraftError('failed', 'Could not save.')
  }
}

/**
 * Opens a published post for editing: returns its draft, creating `drafts.<id>`
 * as an exact copy of the published document first when there is none. Every
 * field is preserved — including ones the dashboard doesn't edit (faq,
 * redirectFrom, author, seo*, featured, relatedEvent, …) — so "Update post"
 * changes only what the user changed. The hidden wizard field marks it as an
 * edit that opens on the overview.
 */
export async function openPostForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: PostLifecycleDeps = {}
): Promise<{ id: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(id)) notFound()
  const { published, draft } = await read(client, id, grant.projectSlug)
  if (!published) notFound()
  if (draft) return { id, created: false }

  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(published)) {
    if (!SYSTEM_FIELDS.has(key)) copy[key] = value
  }
  const now = (deps.now ?? (() => new Date()))().toISOString()
  copy._id = `drafts.${id}`
  copy._type = 'post'
  copy.projectSlug = grant.projectSlug
  copy.wizard = { step: 'review', furthest: 'review', mode: 'edit', updatedAt: now }
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    await client.create(copy as { _id: string; _type: string })
  } catch (error) {
    // Two tabs opening at once: the other one created it — use that draft.
    if ((error as { statusCode?: number })?.statusCode === 409) return { id, created: false }
    throw new PostDraftError('failed', 'Could not open the post.')
  }
  return { id, created: true }
}

/** True when `id` is a published post of this project the caller may edit. */
export async function canOpenPublishedPost(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: PostLifecycleDeps = {}
): Promise<boolean> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(id)) return false
  const published = (await client.getDocument(id)) as Doc | undefined
  return ours(published, grant.projectSlug)
}

/**
 * Posts on the one lifecycle service (ADR-032 D5, slice 4). Permissions come
 * from `lifecycleGuard()`; "previously published" is decided from the stored
 * documents; permanent delete needs an archived post nothing links to.
 */
export const POST_LIFECYCLE: LifecycleDescriptor = {
  type: 'post',
  rule: 'required',
  permissions: { write: BLOG_POST_WRITE_PERMISSION, delete: BLOG_POST_DELETE_PERMISSION, deletePublished: BLOG_PUBLISHED_DELETE_PERMISSION },
  isId: (id: unknown): id is string => isPostId(id),
  // Posts declare no `references`, so publishTogether's 'unpublished_dependencies' never arises for them.
  fail: (code, message) => new PostDraftError(code === 'unpublished_dependencies' ? 'invalid_value' : code, message),
  dependencies: (client, id) => countReferences(client, id),
}

type RevInput = { id: string; rev: string }
/** The live state plus the draft's new revision when the draft was changed too (the editor adopts it). */
export type PostLiveStateWithDraft = PostLiveState & { draftRev: string | null }

/** Takes a live or scheduled post off the website now (expiresAt = now). Refused while archived. */
export async function takePostOffline(ctx: TenantAuthorizationContext, projectId: string, input: RevInput, deps: PostLifecycleDeps = {}): Promise<PostLiveState> {
  return liveState((await lifecycle.unpublishNow(POST_LIFECYCLE, ctx, projectId, input, deps)).doc)
}

/** Puts an offline post back on the website (removes its take-offline date). Refused while archived. */
export async function putPostBackOnline(ctx: TenantAuthorizationContext, projectId: string, input: RevInput, deps: PostLifecycleDeps = {}): Promise<PostLiveState> {
  return liveState((await lifecycle.backOnline(POST_LIFECYCLE, ctx, projectId, input, deps)).doc)
}

/** Archives a post (D6): off the website at once, kept with its URLs and references until restored. */
export async function archivePost(ctx: TenantAuthorizationContext, projectId: string, input: RevInput, deps: PostLifecycleDeps = {}): Promise<PostLiveStateWithDraft> {
  const r = await lifecycle.archive(POST_LIFECYCLE, ctx, projectId, input, deps)
  return { ...liveState(r.doc), draftRev: r.draftRev }
}

/** Restores an archived post (D6): it comes back unpublished — never straight onto the website. */
export async function restorePost(ctx: TenantAuthorizationContext, projectId: string, input: RevInput, deps: PostLifecycleDeps = {}): Promise<PostLiveStateWithDraft> {
  const r = await lifecycle.restore(POST_LIFECYCLE, ctx, projectId, input, deps)
  return { ...liveState(r.doc), draftRev: r.draftRev }
}
/** Throws away unpublished changes: deletes `drafts.<id>` of a published post. */
export async function discardPostChanges(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: PostLifecycleDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  const { published, draft } = await read(client, input.id, grant.projectSlug)
  if (!published || !draft) notFound()
  if (draft._rev !== input.rev) throw new PostDraftError('conflict', 'This draft was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () =>
    client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit()
  )
}

/**
 * Deletes a draft that was never published (blog.post.delete). A draft whose
 * stored fields show it was published before also needs blog.published.delete;
 * a draft over a published post is "Discard changes", never a delete.
 */
export async function deletePostDraft(ctx: TenantAuthorizationContext, projectId: string, input: RevInput, deps: PostLifecycleDeps = {}): Promise<void> {
  await lifecycle.deleteDraft(POST_LIFECYCLE, ctx, projectId, input, deps)
}

/**
 * Permanently deletes a previously published post and its draft (D6/D7):
 * blog.post.delete + blog.published.delete (Owner / Site admin), the post must
 * be archived first, and no other content may still link to it.
 */
export async function deletePublishedPost(ctx: TenantAuthorizationContext, projectId: string, input: RevInput, deps: PostLifecycleDeps = {}): Promise<void> {
  await lifecycle.deletePermanently(POST_LIFECYCLE, ctx, projectId, input, deps)
}

/** Whether this grant may delete published posts (UI hint; the server re-checks). */
export function canDeletePublished(grant: { permissions: readonly string[] }): boolean {
  return grant.permissions.includes(BLOG_POST_DELETE_PERMISSION) && grant.permissions.includes(BLOG_PUBLISHED_DELETE_PERMISSION)
}

// ── End date and topics (Posts list, single and batch) ───────────────────────

/**
 * Sets (or with null removes) the date a post goes offline by itself
 * (`expiresAt`, D5) — on the live version and its draft. Refused while archived.
 */
export async function setPostEndDate(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: RevInput & { expiresAt: string | null },
  deps: PostLifecycleDeps = {}
): Promise<PostLiveState> {
  return liveState((await lifecycle.setEndDate(POST_LIFECYCLE, ctx, projectId, input, deps)).doc)
}

/**
 * Replaces a post's topics (blog categories of THIS site only) on whatever
 * versions exist — live and draft — revision-guarded on each.
 */
export async function setPostCategories(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; categories: string[] },
  deps: PostLifecycleDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  if (!Array.isArray(input.categories) || input.categories.length > LIMITS.categories) {
    throw new PostDraftError('invalid_value', 'Categories must be a short list.')
  }
  const keys = [...new Set(input.categories)]
  const allowed = await client.fetch<string[] | null>(
    `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == "blog"][0].config.categories[].value`,
    { projectSlug: grant.projectSlug }
  )
  if (!keys.every((k) => typeof k === 'string' && (allowed ?? []).includes(k))) {
    throw new PostDraftError('invalid_value', 'Unknown category.')
  }
  const { published, draft } = await read(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  const change = keys.length ? { set: { categories: keys } } : { unset: ['categories'] }
  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction()
    if (published?._rev) tx = tx.patch(input.id, { ifRevisionID: published._rev, ...change })
    if (draft?._rev) tx = tx.patch(`drafts.${input.id}`, { ifRevisionID: draft._rev, ...change })
    return tx.commit()
  })
}

/**
 * Marks a post as featured (or not): the `featured` boolean the website uses
 * to pin posts first in its lists and for "Featured only" blog sections. Set
 * on whatever versions exist — live and draft (so "Update post" keeps it) —
 * revision-guarded on each, read fresh just before.
 */
export async function setPostFeatured(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; featured: boolean },
  deps: PostLifecycleDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  if (typeof input.featured !== 'boolean') throw new PostDraftError('invalid_value', 'Featured must be true or false.')
  const { published, draft } = await read(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  const change = { set: { featured: input.featured } }
  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction()
    if (published?._rev) tx = tx.patch(input.id, { ifRevisionID: published._rev, ...change })
    if (draft?._rev) tx = tx.patch(`drafts.${input.id}`, { ifRevisionID: draft._rev, ...change })
    return tx.commit()
  })
}

// ── Batch (Posts list selection) ─────────────────────────────────────────────

export const POST_BATCH_LIMIT = 100
export const POST_BATCH_OPS = ['offline', 'online', 'archive', 'restore', 'delete', 'endDate', 'categories', 'featured'] as const
export type PostBatchOp = (typeof POST_BATCH_OPS)[number]
/**
 * Per-post result. A lifecycle change returns the post's new live state and
 * the revision it replaced, so the list can show the change at once even when
 * its next read is a moment behind (ADR-032 slice 6).
 */
export type PostBatchItem =
  | { id: string; ok: true; live?: PostLiveState; previousRev?: string }
  | { id: string; ok: false; error: PostDraftErrorCode }

/**
 * Runs one lifecycle action over several posts by looping over the per-post
 * functions above — each does its own `assertModuleAction`, ownership re-read
 * and revision guard. The revision each one needs is read just before (the
 * list's copy may be minutes old). At most POST_BATCH_LIMIT ids; per-item
 * results, never all-or-nothing.
 */
export async function runPostBatch(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { ids: unknown; op: PostBatchOp; expiresAt?: string | null; categories?: string[]; featured?: boolean },
  deps: PostLifecycleDeps = {}
): Promise<PostBatchItem[]> {
  // The gate before any I/O (each item re-checks).
  grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  if (!(POST_BATCH_OPS as readonly unknown[]).includes(input?.op)) throw new PostDraftError('invalid_value', 'Unknown action.')
  if (!Array.isArray(input.ids) || input.ids.length === 0) throw new PostDraftError('invalid_value', 'Nothing selected.')
  if (input.ids.length > POST_BATCH_LIMIT) throw new PostDraftError('too_large', `At most ${POST_BATCH_LIMIT} posts at once.`)
  const ids = [...new Set(input.ids)].filter((id): id is string => typeof id === 'string')
  const client = deps.client ?? sanityWriteClient
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const results: PostBatchItem[] = []
  for (const id of ids) {
    try {
      if (!isPostId(id)) notFound()
      let live: PostLiveState | undefined
      let previousRev: string | undefined
      if (input.op === 'categories') {
        await setPostCategories(ctx, projectId, { id, categories: input.categories ?? [] }, deps)
      } else if (input.op === 'featured') {
        await setPostFeatured(ctx, projectId, { id, featured: input.featured as boolean }, deps)
      } else {
        const { published, draft } = await read(client, id, grant.projectSlug)
        if (input.op === 'delete') {
          // A published post: permanent delete (refused unless archived — "archive_first").
          if (published) await deletePublishedPost(ctx, projectId, { id, rev: published._rev ?? '' }, deps)
          else if (draft) await deletePostDraft(ctx, projectId, { id, rev: draft._rev ?? '' }, deps)
          else notFound()
        } else {
          if (!published && !draft) notFound()
          if (!published) throw new PostDraftError('invalid_value', 'This post is not published.')
          const rev = published._rev ?? ''
          previousRev = rev
          if (input.op === 'offline') live = await takePostOffline(ctx, projectId, { id, rev }, deps)
          else if (input.op === 'online') live = await putPostBackOnline(ctx, projectId, { id, rev }, deps)
          else if (input.op === 'archive') live = await archivePost(ctx, projectId, { id, rev }, deps)
          else if (input.op === 'restore') live = await restorePost(ctx, projectId, { id, rev }, deps)
          else live = await setPostEndDate(ctx, projectId, { id, rev, expiresAt: input.expiresAt ?? null }, deps)
        }
      }
      results.push(live ? { id, ok: true, live: { rev: live.rev, publishedAt: live.publishedAt, expiresAt: live.expiresAt, archivedAt: live.archivedAt, slugs: live.slugs }, previousRev } : { id, ok: true })
    } catch (error) {
      if (error instanceof PostDraftError) results.push({ id, ok: false, error: error.code })
      else if (error instanceof TenantAuthorizationError) results.push({ id, ok: false, error: 'forbidden' })
      else results.push({ id, ok: false, error: 'failed' })
    }
  }
  return results
}
