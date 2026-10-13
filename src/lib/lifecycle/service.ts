/**
 * ADR-032 D5 — the one lifecycle service. Every editorial module that adopts
 * the lifecycle registers a descriptor; the operations below are the only way
 * the dashboard changes publication state. Posts are the first module (slice
 * 4); events, galleries and the Menu join in later phases.
 *
 * Every operation keeps the guarantees of the code it replaces:
 *   1. `lifecycleGuard()` decides the permissions — checked before any I/O.
 *   2. Ownership is re-read: the documents must be this type and this
 *      project's, otherwise "not_found" (ids cannot be probed).
 *   3. Writes are revision-guarded on every version they touch → "conflict".
 *   4. The single-Sanity-project guard runs before the write.
 *   5. Errors are opaque codes (the module's own error class).
 *   6. One Activity row, written only after the content change succeeded
 *      (`audited()`); an Activity failure never turns a done change into an
 *      error the user would retry — it is logged for investigation.
 *
 * Decisions from Tom (slice 4, 2026-10-13):
 *   - "Previously published" is decided from persisted content, never from
 *     the client: a published version exists, or the draft carries a
 *     publishedAt / archivedAt (only copies of published documents do).
 *     Deleting such content permanently needs the module's delete-published
 *     permission AND an archived item.
 *   - Archive also sets expiresAt (now, or keeps an earlier one) on the
 *     published AND the draft version, so code that predates archivedAt
 *     (production, until Phase 1 ships) already hides archived content.
 *   - Archived content cannot go back online by any route — publish, back
 *     online, schedule changes — until it is restored. Restore always lands
 *     on "unpublished"; a future publishedAt is removed (old schedules never
 *     reactivate).
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { audited, type ContentAuditWriter } from './audit'
import { lifecycleAction, snapshotOf, type ContentAction } from './transition'
import { instant, type PublishedAtRule } from './visibility'

export type LifecycleErrorCode = 'forbidden' | 'not_found' | 'conflict' | 'invalid_value' | 'archived' | 'archive_first' | 'in_use' | 'failed'

export type LifecycleDescriptor = {
  /** Sanity document type. */
  type: string
  rule: PublishedAtRule
  permissions: {
    /** Edit, publish, schedule, unpublish, archive, restore. */
    write: string
    /** Delete a never-published draft. */
    delete: string
    /** Additionally required to delete previously published content (Owner / Site admin). */
    deletePublished: string
  }
  isId: (id: unknown) => id is string
  /** The module's error class, so callers keep their opaque codes. */
  fail: (code: LifecycleErrorCode, message: string) => Error
  /** How many other documents still reference this one (permanent delete refuses while > 0). */
  dependencies?: (client: LifecycleClient, id: string, projectSlug: string) => Promise<number>
}

export const LIFECYCLE_OPERATIONS = ['unpublishNow', 'backOnline', 'setEndDate', 'archive', 'restore', 'deleteDraft', 'deletePermanently'] as const
export type LifecycleOperation = (typeof LIFECYCLE_OPERATIONS)[number]

/**
 * D7 — the one operation → permission map (amended 2026-10-13: the separate
 * delete-published permission is kept, Owner / Site admin by default).
 */
export function lifecycleGuard(d: LifecycleDescriptor, op: LifecycleOperation): string[] {
  if (op === 'deleteDraft') return [d.permissions.delete]
  if (op === 'deletePermanently') return [d.permissions.delete, d.permissions.deletePublished]
  return [d.permissions.write]
}

export type LifecycleClient = Pick<typeof sanityWriteClient, 'getDocument' | 'patch' | 'transaction' | 'fetch'>
export type LifecycleDeps = { client?: LifecycleClient; now?: () => Date; audit?: ContentAuditWriter }
export type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

/** Content that was public at some point (or a copy of such content). From persisted fields only. */
export function wasEverPublished(published: Doc | undefined | null, draft: Doc | undefined | null): boolean {
  if (published) return true
  return typeof draft?.publishedAt === 'string' || draft?.archivedAt != null
}

export const isArchived = (doc: Doc | undefined | null) => doc?.archivedAt != null

/**
 * What a state-changing operation returns: the published document as stored
 * after the change (its `_rev` is the new revision), and the draft's new
 * revision when the draft was changed too — an open editor adopts it, or its
 * next save would be refused as "changed elsewhere".
 */
export type LifecycleResult = { doc: Doc; draftRev: string | null }

type Op<T> = {
  d: LifecycleDescriptor
  op: LifecycleOperation
  intended: ContentAction
  ctx: TenantAuthorizationContext
  projectId: string
  id: unknown
  deps: LifecycleDeps
  run: (x: { grant: { projectSlug: string }; client: LifecycleClient; now: Date; transactionId: string; id: string }) => Promise<{
    value: T
    before: Doc | null
    after: Doc | null
    action?: ContentAction | null
    detail?: Record<string, unknown>
  }>
}

async function operate<T>(o: Op<T>): Promise<T> {
  return audited(
    { ctx: o.ctx, projectId: o.projectId, contentType: o.d.type, contentId: o.d.isId(o.id) ? o.id : null, intended: o.intended, writer: o.deps.audit },
    async (transactionId) => {
      for (const p of lifecycleGuard(o.d, o.op)) assertModuleAction(o.ctx, o.projectId, p)
      const grant = o.ctx.projects.find((p) => p.projectId === o.projectId)!
      if (!o.d.isId(o.id)) throw o.d.fail('not_found', 'Unknown item.')
      const now = (o.deps.now ?? (() => new Date()))()
      const r = await o.run({ grant, client: o.deps.client ?? sanityWriteClient, now, transactionId, id: o.id })
      const state = snapshotOf(r.after)
      const action = r.action !== undefined ? r.action : lifecycleAction(snapshotOf(r.before), state, o.d.rule, now)
      return { value: r.value, action, state, detail: r.detail }
    }
  )
}

/** Both versions, ownership-checked: anything not this project's item is "not_found". */
export async function readPair(d: LifecycleDescriptor, client: LifecycleClient, id: string, projectSlug: string) {
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [Doc | undefined, Doc | undefined]
  const ours = (doc: Doc | undefined) => !doc || (doc._type === d.type && doc.projectSlug === projectSlug)
  if (!ours(published) || !ours(draft)) throw d.fail('not_found', 'Unknown item.')
  return { published, draft }
}

async function commit(d: LifecycleDescriptor, client: LifecycleClient, projectSlug: string, run: () => Promise<unknown>) {
  await assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)
  try {
    await run()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw d.fail('conflict', 'This item was changed elsewhere.')
    throw d.fail('failed', 'Could not save.')
  }
}

const iso = (v: unknown) => (typeof v === 'string' ? v : null)
const notAfter = (v: unknown, t: number) => {
  const at = instant(v)
  return at !== null && at <= t
}

/** A patch applied to the published version and, when it exists, the draft — one transaction, both guarded. */
function bothVersions(client: LifecycleClient, id: string, published: Doc, draft: Doc | undefined, change: { set?: Record<string, unknown>; unset?: string[] }) {
  let tx = client.transaction().patch(id, { ifRevisionID: published._rev ?? '', ...change })
  if (draft?._rev) tx = tx.patch(`drafts.${id}`, { ifRevisionID: draft._rev, ...change })
  return tx
}

function applyChange(doc: Doc, change: { set?: Record<string, unknown>; unset?: string[] }): Doc {
  const next: Doc = { ...doc, ...(change.set ?? {}) }
  for (const k of change.unset ?? []) delete next[k]
  return next
}

/**
 * After a transaction, every document it touched carries the transaction id
 * as its `_rev` (Sanity sets the revision to the transaction id) — so callers
 * get the revisions they need for their next guarded write.
 */
function touchedBoth(published: Doc, draft: Doc | undefined, change: { set?: Record<string, unknown>; unset?: string[] }, transactionId: string) {
  const after = { ...applyChange(published, change), _rev: transactionId }
  return { value: { doc: after, draftRev: draft?._rev ? transactionId : null } as LifecycleResult, before: published, after }
}

// ── Operations ───────────────────────────────────────────────────────────────

type Rev = { rev: string }

/** Unpublish now: expiresAt = now on the published version (D2: never Sanity's Unpublish). */
export function unpublishNow(d: LifecycleDescriptor, ctx: TenantAuthorizationContext, projectId: string, input: { id: string } & Rev, deps: LifecycleDeps = {}) {
  return operate({
    d, op: 'unpublishNow', intended: 'unpublished', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, now, transactionId, id }) => {
      const { published } = await readPair(d, client, id, grant.projectSlug)
      if (!published) throw d.fail('not_found', 'Unknown item.')
      if (isArchived(published)) throw d.fail('archived', 'This item is archived.')
      if (published._rev !== input.rev) throw d.fail('conflict', 'This item was changed elsewhere.')
      const change = { set: { expiresAt: now.toISOString() } }
      let rev = ''
      await commit(d, client, grant.projectSlug, async () => {
        const r = (await client.patch(id).ifRevisionId(input.rev).set(change.set).commit({ transactionId })) as { _rev?: string }
        rev = r._rev ?? ''
      })
      const after = { ...applyChange(published, change), _rev: rev }
      return { value: { doc: after, draftRev: null }, before: published, after }
    },
  })
}

/** Back online: removes the unpublish date (and, after a restore, publishes from now). Refused while archived. */
export function backOnline(d: LifecycleDescriptor, ctx: TenantAuthorizationContext, projectId: string, input: { id: string } & Rev, deps: LifecycleDeps = {}) {
  return operate({
    d, op: 'backOnline', intended: 'published', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, now, transactionId, id }) => {
      const { published } = await readPair(d, client, id, grant.projectSlug)
      if (!published) throw d.fail('not_found', 'Unknown item.')
      if (isArchived(published)) throw d.fail('archived', 'Restore this item first.')
      if (published._rev !== input.rev) throw d.fail('conflict', 'This item was changed elsewhere.')
      // A restore removed a future publish date: going back online is the explicit "publish now".
      const change = d.rule === 'required' && !iso(published.publishedAt) ? { unset: ['expiresAt'], set: { publishedAt: now.toISOString() } } : { unset: ['expiresAt'] }
      let rev = ''
      await commit(d, client, grant.projectSlug, async () => {
        let p = client.patch(id).ifRevisionId(input.rev).unset(change.unset)
        if ('set' in change && change.set) p = p.set(change.set)
        const r = (await p.commit({ transactionId })) as { _rev?: string }
        rev = r._rev ?? ''
      })
      const after = { ...applyChange(published, change), _rev: rev }
      return { value: { doc: after, draftRev: null }, before: published, after }
    },
  })
}

/** Sets (or with null removes) the unpublish date — on both versions. Refused while archived. */
export function setEndDate(
  d: LifecycleDescriptor,
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; expiresAt: string | null } & Rev,
  deps: LifecycleDeps = {}
) {
  return operate({
    d, op: 'setEndDate', intended: 'schedule_changed', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, now, transactionId, id }) => {
      let expiresAt: string | null = null
      if (input.expiresAt !== null) {
        if (typeof input.expiresAt !== 'string' || input.expiresAt.length > 40 || Number.isNaN(Date.parse(input.expiresAt))) {
          throw d.fail('invalid_value', 'Unknown date.')
        }
        expiresAt = new Date(Date.parse(input.expiresAt)).toISOString()
        if (Date.parse(expiresAt) <= now.getTime()) throw d.fail('invalid_value', 'The end date must be in the future.')
      }
      const { published, draft } = await readPair(d, client, id, grant.projectSlug)
      if (!published) throw d.fail('not_found', 'Unknown item.')
      if (isArchived(published)) throw d.fail('archived', 'Restore this item first.')
      if (published._rev !== input.rev) throw d.fail('conflict', 'This item was changed elsewhere.')
      const p = instant(published.publishedAt)
      if (expiresAt && p !== null && Date.parse(expiresAt) <= p) throw d.fail('invalid_value', 'The end date must be after the publish date.')
      const change = expiresAt ? { set: { expiresAt } } : { unset: ['expiresAt'] }
      await commit(d, client, grant.projectSlug, () => bothVersions(client, id, published, draft, change).commit({ transactionId }))
      return touchedBoth(published, draft, change, transactionId)
    },
  })
}

/**
 * Archive (D6): from scheduled / published / unpublished. archivedAt + archivedBy,
 * and expiresAt = now unless an earlier one exists — on both versions.
 */
export function archive(d: LifecycleDescriptor, ctx: TenantAuthorizationContext, projectId: string, input: { id: string } & Rev, deps: LifecycleDeps = {}) {
  return operate({
    d, op: 'archive', intended: 'archived', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, now, transactionId, id }) => {
      const { published, draft } = await readPair(d, client, id, grant.projectSlug)
      if (!published) throw d.fail('invalid_value', 'A draft that was never published cannot be archived.')
      if (isArchived(published)) throw d.fail('archived', 'This item is already archived.')
      if (published._rev !== input.rev) throw d.fail('conflict', 'This item was changed elsewhere.')
      const t = now.toISOString()
      const keepEarlier = notAfter(published.expiresAt, now.getTime())
      const change = { set: { archivedAt: t, archivedBy: ctx.userId, ...(keepEarlier ? {} : { expiresAt: t }) } }
      await commit(d, client, grant.projectSlug, () => bothVersions(client, id, published, draft, change).commit({ transactionId }))
      return touchedBoth(published, draft, change, transactionId)
    },
  })
}

/**
 * Restore (D6): archived → unpublished. Unsets archivedAt / archivedBy; expiresAt
 * = now unless an earlier one exists; a future publishedAt is removed so an old
 * schedule never reactivates. Both versions.
 */
export function restore(d: LifecycleDescriptor, ctx: TenantAuthorizationContext, projectId: string, input: { id: string } & Rev, deps: LifecycleDeps = {}) {
  return operate({
    d, op: 'restore', intended: 'restored', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, now, transactionId, id }) => {
      const { published, draft } = await readPair(d, client, id, grant.projectSlug)
      if (!published) throw d.fail('not_found', 'Unknown item.')
      if (!isArchived(published)) throw d.fail('invalid_value', 'This item is not archived.')
      if (published._rev !== input.rev) throw d.fail('conflict', 'This item was changed elsewhere.')
      const t = now.getTime()
      const unset = ['archivedAt', 'archivedBy']
      const p = instant(published.publishedAt)
      if (p !== null && p > t) unset.push('publishedAt')
      const change = { unset, ...(notAfter(published.expiresAt, t) ? {} : { set: { expiresAt: now.toISOString() } }) }
      await commit(d, client, grant.projectSlug, () => bothVersions(client, id, published, draft, change).commit({ transactionId }))
      return touchedBoth(published, draft, change, transactionId)
    },
  })
}

/**
 * Deletes a draft that was never published. Content that was published at some
 * point (persisted fields, never the client's word) needs the delete-published
 * permission too.
 */
export function deleteDraft(d: LifecycleDescriptor, ctx: TenantAuthorizationContext, projectId: string, input: { id: string } & Rev, deps: LifecycleDeps = {}) {
  return operate({
    d, op: 'deleteDraft', intended: 'deleted', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, transactionId, id }) => {
      const { published, draft } = await readPair(d, client, id, grant.projectSlug)
      if (!draft) throw d.fail('not_found', 'Unknown item.')
      // A draft over a published item is "discard changes"; the item itself goes through archive → delete.
      if (published) throw d.fail('archive_first', 'This item is published.')
      if (wasEverPublished(null, draft)) assertModuleAction(ctx, projectId, d.permissions.deletePublished)
      if (draft._rev !== input.rev) throw d.fail('conflict', 'This draft was edited elsewhere.')
      const draftId = `drafts.${id}`
      await commit(d, client, grant.projectSlug, () =>
        client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit({ transactionId })
      )
      return { value: undefined, before: null, after: null, action: 'deleted' as const, detail: { draftOnly: true } }
    },
  })
}

/**
 * Permanent delete (D6/D7): archived items only, Owner / Site admin, no other
 * document may still reference it. Removes the published version and the draft.
 */
export function deletePermanently(d: LifecycleDescriptor, ctx: TenantAuthorizationContext, projectId: string, input: { id: string } & Rev, deps: LifecycleDeps = {}) {
  return operate({
    d, op: 'deletePermanently', intended: 'deleted', ctx, projectId, id: input?.id, deps,
    run: async ({ grant, client, transactionId, id }) => {
      const { published, draft } = await readPair(d, client, id, grant.projectSlug)
      if (!published) throw d.fail('not_found', 'Unknown item.')
      if (!isArchived(published)) throw d.fail('archive_first', 'Archive this item before deleting it permanently.')
      if (published._rev !== input.rev) throw d.fail('conflict', 'This item was changed elsewhere.')
      const refs = d.dependencies ? await d.dependencies(client, id, grant.projectSlug) : 0
      if (refs > 0) throw d.fail('in_use', 'Other content still links to this item.')
      await commit(d, client, grant.projectSlug, () => {
        let tx = client.transaction().patch(id, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] })
        if (draft?._rev) tx = tx.patch(`drafts.${id}`, { ifRevisionID: draft._rev, unset: ['_lifecycleGuard'] })
        tx = tx.delete(id)
        if (draft) tx = tx.delete(`drafts.${id}`)
        return tx.commit({ transactionId })
      })
      return { value: undefined, before: published, after: null }
    },
  })
}

/** Documents (other than the item's own versions) that reference `id` — the dependency check. */
export async function countReferences(client: LifecycleClient, id: string): Promise<number> {
  const n = await client.fetch<number | null>(
    `count(*[references($id) && !(_id in [$id, $draftId])])`,
    { id, draftId: `drafts.${id}` },
    { perspective: 'raw' }
  )
  return typeof n === 'number' ? n : 0
}
