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
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { BLOG_POST_WRITE_PERMISSION, isPostId, liveState, PostDraftError, type PostLiveState } from '@/lib/api/post-drafts'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'

export const BLOG_POST_DELETE_PERMISSION = 'blog.post.delete'

type LifecycleClient = Pick<typeof sanityWriteClient, 'getDocument' | 'create' | 'patch' | 'transaction' | 'fetch'>
export type PostLifecycleDeps = { client?: LifecycleClient; now?: () => Date }

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

/** Takes a live or scheduled post off the website now (expiresAt = now). */
export async function takePostOffline(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: PostLifecycleDeps = {}
): Promise<PostLiveState> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  const { published } = await read(client, input.id, grant.projectSlug)
  if (!published) notFound()
  if (published._rev !== input.rev) throw new PostDraftError('conflict', 'This post was changed elsewhere.')
  const now = (deps.now ?? (() => new Date()))().toISOString()
  let rev = ''
  await commit(client, grant.projectSlug, async () => {
    const r = (await client.patch(input.id).ifRevisionId(input.rev).set({ expiresAt: now }).commit()) as { _rev?: string }
    rev = r._rev ?? ''
  })
  return liveState({ ...published, _rev: rev, expiresAt: now })
}

/** Puts an offline post back on the website (removes its take-offline date). */
export async function putPostBackOnline(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: PostLifecycleDeps = {}
): Promise<PostLiveState> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  const { published } = await read(client, input.id, grant.projectSlug)
  if (!published) notFound()
  if (published._rev !== input.rev) throw new PostDraftError('conflict', 'This post was changed elsewhere.')
  let rev = ''
  await commit(client, grant.projectSlug, async () => {
    const r = (await client.patch(input.id).ifRevisionId(input.rev).unset(['expiresAt']).commit()) as { _rev?: string }
    rev = r._rev ?? ''
  })
  const next: Doc = { ...published, _rev: rev }
  delete next.expiresAt
  return liveState(next)
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

/** Deletes a draft that was never published. */
export async function deletePostDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: PostLifecycleDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  const { published, draft } = await read(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  // A draft over a live post is "Discard changes", never a delete of the post.
  if (published) throw new PostDraftError('invalid_value', 'This post is published.')
  if (draft._rev !== input.rev) throw new PostDraftError('conflict', 'This draft was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () =>
    client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit()
  )
}

/**
 * Permanently deletes a published post (and its draft). Owners only, and only
 * when the role holds blog.post.delete. The UI asks for confirmation with the title.
 */
export async function deletePublishedPost(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: PostLifecycleDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, BLOG_POST_DELETE_PERMISSION)
  if (grant.role !== 'owner') throw new TenantAuthorizationError('Only owners can delete a published post.')
  const client = deps.client ?? sanityWriteClient
  if (!isPostId(input?.id)) notFound()
  const { published, draft } = await read(client, input.id, grant.projectSlug)
  if (!published) notFound()
  if (published._rev !== input.rev) throw new PostDraftError('conflict', 'This post was changed elsewhere.')
  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction().patch(input.id, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] })
    if (draft?._rev) tx = tx.patch(`drafts.${input.id}`, { ifRevisionID: draft._rev, unset: ['_lifecycleGuard'] })
    tx = tx.delete(input.id)
    if (draft) tx = tx.delete(`drafts.${input.id}`)
    return tx.commit()
  })
}

/** Whether this grant may delete published posts (UI hint; the server re-checks). */
export function canDeletePublished(grant: { role: string; permissions: string[] }): boolean {
  return grant.role === 'owner' && grant.permissions.includes(BLOG_POST_DELETE_PERMISSION)
}
