/**
 * Internal-tag service — lists, renames, merges and deletes the tags of a
 * project's photos (Media Library) or galleries. Server-only.
 *
 * Every function, in this order:
 *   1. The scope's permission, before any I/O — media: `media.library.manage`
 *      (no module); galleries: `gallery.gallery.read` to list,
 *      `gallery.gallery.write` to change (module installed AND role grants it).
 *   2. Reads and writes use the project from the GRANT (`$projectSlug`), and
 *      every fetched document must be of this project and the right type.
 *   3. `assertSingleSanityProject` before the write.
 *   4. All affected documents are patched with `ifRevisionID` in ONE
 *      transaction (a conflict changes nothing). Galleries: the published
 *      document and its draft, each rewritten from its own tags; tags are not
 *      website content, so no "Unpublished changes" appears (as batchGalleries).
 *
 * Tags are internal (ADR-022): nothing public depends on them, so deleting is
 * allowed. A tag exists while an item carries it, or while it is on the
 * scope's `internalTagList` (added in Categories & Tags, not used yet): one
 * document per project and scope, deterministic id, `projectSlug` checked on
 * read. Rename / merge / delete patch that list in the SAME transaction.
 * Undo is the dashboard's (`useUndo` holds the call back for a few seconds
 * and Undo cancels it), so the server only ever sees changes that stand.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { assertProjectAccess, MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import {
  changeAffects,
  cleanChange,
  findDuplicateTag,
  GALLERY_READ,
  GALLERY_WRITE,
  INTERNAL_TAG_LIMITS,
  INTERNAL_TAG_LIST_MAX,
  INTERNAL_TAG_LIST_TYPE,
  internalTagListId,
  normaliseInternalTag,
  rewriteListed,
  rewriteTags,
  type InternalTagScope,
  type TagChange,
  type TagRow,
} from './internal-tags'

export type TagErrorCode = 'invalid_value' | 'duplicate' | 'too_many' | 'conflict' | 'failed'

export class TagError extends Error {
  constructor(
    readonly code: TagErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TagError'
  }
}

type Tx = {
  patch(id: string, patch: { ifRevisionID: string; set: Record<string, unknown>; unset?: string[] }): Tx
  create(doc: { _id: string; _type: string } & Record<string, unknown>): Tx
  commit(): Promise<unknown>
}
type TagClient = {
  fetch<T>(query: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<T>
  transaction: () => Tx
}
export type TagDeps = { client?: TagClient }

/** Most documents one change may touch (one transaction). */
export const TAG_CHANGE_MAX_DOCS = 2000

const MEDIA_QUERY = `*[_type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset) && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && count(tags) > 0]{ _id, _rev, tags }`
const GALLERY_QUERY = `*[_type == "gallery" && projectSlug == $projectSlug && !(_id in path("versions.**")) && count(tags) > 0]{ _id, _rev, tags }`

/** The scope's added-tags list — by its deterministic id AND this project's slug. */
const LIST_QUERY = `*[_type == "${INTERNAL_TAG_LIST_TYPE}" && _id == $listId && projectSlug == $projectSlug][0]{ _id, _rev, tags }`

type Raw = { _id: string; _rev?: string; tags?: unknown }
const tagsOf = (r: Raw): string[] => (Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string' && !!t) : [])

function access(ctx: TenantAuthorizationContext, projectId: string, scope: InternalTagScope, write: boolean) {
  if (scope === 'media') return assertProjectAccess(ctx, projectId, MEDIA_MANAGE_PERMISSION)
  if (scope === 'galleries') {
    assertModuleAction(ctx, projectId, write ? GALLERY_WRITE : GALLERY_READ)
    return ctx.projects.find((p) => p.projectId === projectId)!
  }
  throw new TenantAuthorizationError('Unknown tag list.')
}

/** Whether this person may change the scope's tags (read passed already). */
function canWriteScope(ctx: TenantAuthorizationContext, projectId: string, scope: InternalTagScope): boolean {
  try {
    access(ctx, projectId, scope, true)
    return true
  } catch {
    return false
  }
}

async function readRaw(client: TagClient, scope: InternalTagScope, projectSlug: string): Promise<Raw[]> {
  const rows = await client.fetch<Raw[] | null>(scope === 'media' ? MEDIA_QUERY : GALLERY_QUERY, { projectSlug }, { perspective: 'raw' })
  return Array.isArray(rows) ? rows.filter((r) => r && typeof r._id === 'string') : []
}

async function readList(client: TagClient, scope: InternalTagScope, projectSlug: string): Promise<{ id: string; doc: Raw | null; tags: string[] }> {
  const id = internalTagListId(projectSlug, scope)
  const doc = await client.fetch<Raw | null>(LIST_QUERY, { listId: id, projectSlug }, { perspective: 'raw' })
  const ok = doc && doc._id === id ? doc : null
  return { id, doc: ok, tags: ok ? tagsOf(ok) : [] }
}

const baseId = (id: string) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)

/**
 * Photos / galleries that carry tags, with their tags (a gallery's draft wins
 * over its published version). The dashboard counts and previews from this.
 */
export async function listInternalTagRows(
  ctx: TenantAuthorizationContext,
  projectId: string,
  scope: InternalTagScope,
  deps: TagDeps = {}
): Promise<{ rows: TagRow[]; listed: string[]; canWrite: boolean }> {
  const grant = access(ctx, projectId, scope, false)
  const client = deps.client ?? (sanityWriteClient as unknown as TagClient)
  const [raw, list] = await Promise.all([readRaw(client, scope, grant.projectSlug), readList(client, scope, grant.projectSlug)])
  const byId = new Map<string, Raw>()
  for (const r of raw) {
    const id = baseId(r._id)
    const have = byId.get(id)
    if (!have || r._id.startsWith('drafts.')) byId.set(id, r)
  }
  const rows = [...byId].map(([id, r]) => ({ id, tags: tagsOf(r) }))
  return { rows, listed: list.tags, canWrite: canWriteScope(ctx, projectId, scope) }
}

export type TagAddResult = { tag: string; listed: string[] }

/**
 * Adds a tag no item uses yet (Categories & Tags → "Add a tag"): it goes on the
 * scope's list and shows as "Not used yet". Refused when it matches a tag that
 * exists already (items or list), ignoring case and accents. Write permission;
 * the list is created on first use (create, so two first adds cannot both win)
 * or patched with its revision.
 */
export async function addInternalTag(
  ctx: TenantAuthorizationContext,
  projectId: string,
  scope: InternalTagScope,
  name: unknown,
  deps: TagDeps = {}
): Promise<TagAddResult> {
  const grant = access(ctx, projectId, scope, true)
  const client = deps.client ?? (sanityWriteClient as unknown as TagClient)
  const tag = typeof name === 'string' ? normaliseInternalTag(name) : ''
  if (!tag) throw new TagError('invalid_value', 'Give the tag a name.')

  const [raw, list] = await Promise.all([readRaw(client, scope, grant.projectSlug), readList(client, scope, grant.projectSlug)])
  const existing = [...new Set([...raw.flatMap(tagsOf), ...list.tags])]
  if (findDuplicateTag(tag, existing)) throw new TagError('duplicate', 'That tag exists already.')
  if (list.tags.length >= INTERNAL_TAG_LIST_MAX) throw new TagError('too_many', 'Too many unused tags.')

  const listed = [...list.tags, tag]
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  const tx = list.doc?._rev
    ? client.transaction().patch(list.id, { ifRevisionID: list.doc._rev, set: { tags: listed } })
    : client.transaction().create({ _id: list.id, _type: INTERNAL_TAG_LIST_TYPE, projectSlug: grant.projectSlug, scope, tags: listed })
  try {
    await tx.commit()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new TagError('conflict', 'The tags were changed elsewhere.')
    throw new TagError('failed', 'Could not save.')
  }
  return { tag, listed }
}

export type TagChangeResult = { changed: number }

/**
 * Renames (a merge of one), merges or deletes tags on every photo/gallery
 * that carries them. `ifRevisionID` on each patch, one transaction; a
 * document that would end up with more than 10 tags is refused before
 * anything is written (a merge never adds tags, so only old data can).
 */
export async function changeInternalTags(
  ctx: TenantAuthorizationContext,
  projectId: string,
  scope: InternalTagScope,
  input: TagChange,
  deps: TagDeps = {}
): Promise<TagChangeResult> {
  const grant = access(ctx, projectId, scope, true)
  const client = deps.client ?? (sanityWriteClient as unknown as TagClient)
  const change = cleanChange(input)
  if (!change) throw new TagError('invalid_value', 'Nothing to change.')

  const [raw, list] = await Promise.all([readRaw(client, scope, grant.projectSlug), readList(client, scope, grant.projectSlug)])
  const docs = raw.filter((d) => d._rev && changeAffects(tagsOf(d), change))
  // The added-tags list follows the change (a rename / merge / delete of a tag nothing uses yet only touches it).
  const listPatch = list.doc?._rev && changeAffects(list.tags, change) ? { rev: list.doc._rev, tags: rewriteListed(list.tags, change) } : null
  if (!docs.length && !listPatch) return { changed: 0 }
  if (docs.length > TAG_CHANGE_MAX_DOCS) throw new TagError('failed', 'Too many items at once.')
  const patches = docs.map((d) => ({ id: d._id, rev: d._rev as string, tags: rewriteTags(tagsOf(d), change) }))
  if (patches.some((p) => p.tags.length > INTERNAL_TAG_LIMITS.perItem)) throw new TagError('invalid_value', 'Up to 10 tags.')

  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  let tx = client.transaction()
  for (const p of patches) {
    tx = tx.patch(p.id, p.tags.length ? { ifRevisionID: p.rev, set: { tags: p.tags } } : { ifRevisionID: p.rev, set: {}, unset: ['tags'] })
  }
  if (listPatch) tx = tx.patch(list.id, { ifRevisionID: listPatch.rev, set: { tags: listPatch.tags } })
  try {
    await tx.commit()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new TagError('conflict', 'A tag was changed elsewhere.')
    throw new TagError('failed', 'Could not save.')
  }
  return { changed: new Set(patches.map((p) => baseId(p.id))).size }
}
