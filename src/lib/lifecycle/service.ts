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
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { audited, type ContentAuditWriter } from './audit'
import { lifecycleAction, snapshotOf, type ContentAction } from './transition'
import { instant, isPublicAt, type PublishedAtRule } from './visibility'

export type LifecycleErrorCode = 'forbidden' | 'not_found' | 'conflict' | 'invalid_value' | 'archived' | 'archive_first' | 'in_use' | 'unpublished_dependencies' | 'failed'

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
  /**
   * Like `dependencies`, but names the blockers (ADR-033 D9: "the refusal names
   * the collections"). When present it replaces `dependencies` for the checks
   * below. Return only the documents that BLOCK — a module decides what blocks
   * (e.g. only public referrers; drafts and archived content do not).
   */
  referrers?: (client: LifecycleClient, id: string, projectSlug: string) => Promise<Referrer[]>
  /** Also run `referrers` before archiving (default: only before a permanent delete). */
  refuseArchiveWhileReferenced?: boolean
  /**
   * ADR-033 D-8 — the documents that block a PERMANENT delete (of a published
   * document or of a never-published draft). When present it replaces
   * `referrers` for deletes; `referrers` keeps deciding archives. Sanity
   * refuses to delete a strongly referenced document anyway — this turns
   * that into a named answer, and also covers weak references (drafts).
   */
  deleteReferrers?: (client: LifecycleClient, id: string, projectSlug: string) => Promise<Referrer[]>
  /**
   * ADR-032 Amendment B — the document's outgoing lifecycle references (ids
   * without the `drafts.` prefix, with their type). Used by `publishTogether`;
   * modules without it are unaffected.
   */
  references?: (doc: Doc) => LifecycleRef[]
  /** A human name for a document, for refusals and the publish preview. */
  label?: (doc: Doc) => string
  /** Whether publishing this document opens a public page of its own (publish preview). */
  opensPage?: (doc: Doc) => boolean
}

/** An outgoing reference of a document, as `references(doc)` names it. */
export type LifecycleRef = { id: string; type: string }

/** A document that blocks an archive or delete. `label` is a human name for the refusal message. */
export type Referrer = { id: string; type: string; label: string }

/** "Used by: A, B" — the message of an `in_use` refusal that names its referrers. */
export function describeReferrers(refs: readonly Referrer[]): string {
  return `Still used by: ${refs.map((r) => r.label).join(', ')}.`
}

/** The module's `in_use` error with the blocking documents attached as `referrers`. */
function inUse(d: LifecycleDescriptor, refs: readonly Referrer[]): Error {
  return Object.assign(d.fail('in_use', describeReferrers(refs)), { referrers: [...refs] })
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
      if (d.referrers && d.refuseArchiveWhileReferenced) {
        const refs = await d.referrers(client, id, grant.projectSlug)
        if (refs.length > 0) throw inUse(d, refs)
      }
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
      // D-8: a never-published draft may be referenced (weakly) by other drafts.
      if (d.deleteReferrers) {
        const named = await d.deleteReferrers(client, id, grant.projectSlug)
        if (named.length > 0) throw inUse(d, named)
      }
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
      const blockers = d.deleteReferrers ?? d.referrers
      if (blockers) {
        const named = await blockers(client, id, grant.projectSlug)
        if (named.length > 0) throw inUse(d, named)
      } else {
        const refs = d.dependencies ? await d.dependencies(client, id, grant.projectSlug) : 0
        if (refs > 0) throw d.fail('in_use', 'Other content still links to this item.')
      }
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

// ── Publishing together (ADR-032 Amendment B; ADR-033 D-4, D-5) ─────────────

/** A document taking part in a publish: the root, or a never-published dependency. */
export type PublishNode = { d: LifecycleDescriptor; id: string; draft: Doc; published: Doc | undefined; isRoot: boolean }

export type PublishPlan = {
  root: PublishNode
  /** Never-published dependencies reachable from the root (cycles visited once), in discovery order. */
  dependencies: PublishNode[]
  /** Dependencies the editor may not publish (permission). */
  forbidden: Referrer[]
  /** References to documents that exist in no version (deleted, or another project's). */
  missing: Referrer[]
  /** Dependencies with a published version that will NOT be live when the root goes live (never modified). */
  notLive: Referrer[]
}

const stripDraft = (id: string) => id.replace(/^drafts\./, '')
const refOf = (n: { d: LifecycleDescriptor; id: string; draft?: Doc; published?: Doc }): Referrer => ({
  id: n.id,
  type: n.d.type,
  label: (n.d.label?.(n.draft ?? n.published ?? {}) ?? '') || n.id,
})

/**
 * Walks the never-published dependencies of `root` through each descriptor's
 * `references` (read-only). Cycles are safe: every document is visited once.
 * Dependencies that have a published version stop the walk — they are never
 * modified, so their own references are not this publish's business — and are
 * reported in `notLive` when they will not be live at `liveAt`. With
 * `withDependencies: false` the walk stops at the root's direct references.
 */
export async function planPublish(
  descriptors: readonly LifecycleDescriptor[],
  ctx: TenantAuthorizationContext,
  projectId: string,
  client: LifecycleClient,
  projectSlug: string,
  root: { type: string; id: string },
  opts: { liveAt: Date; withDependencies: boolean }
): Promise<PublishPlan> {
  const byType = new Map(descriptors.map((x) => [x.type, x]))
  const rd = byType.get(root.type)
  if (!rd) throw new Error(`planPublish: no descriptor for ${root.type}`)
  const rootPair = await readPair(rd, client, root.id, projectSlug)
  if (!rootPair.draft) throw rd.fail('not_found', 'Unknown item.')
  const rootNode: PublishNode = { d: rd, id: root.id, draft: rootPair.draft, published: rootPair.published, isRoot: true }
  const plan: PublishPlan = { root: rootNode, dependencies: [], forbidden: [], missing: [], notLive: [] }
  const seen = new Set<string>([root.id])
  const queue: PublishNode[] = [rootNode]
  while (queue.length) {
    const node = queue.shift()!
    for (const ref of node.d.references?.(node.draft) ?? []) {
      const id = stripDraft(ref.id)
      if (seen.has(id)) continue
      seen.add(id)
      const td = byType.get(ref.type)
      if (!td || !td.isId(id)) continue
      let pair: { published: Doc | undefined; draft: Doc | undefined }
      try {
        pair = await readPair(td, client, id, projectSlug)
      } catch {
        pair = { published: undefined, draft: undefined }
      }
      if (pair.published) {
        if (!isPublicAt(pair.published as never, td.rule, opts.liveAt)) plan.notLive.push(refOf({ d: td, id, published: pair.published }))
        continue
      }
      if (!pair.draft) {
        plan.missing.push({ id, type: td.type, label: id })
        continue
      }
      const dep: PublishNode = { d: td, id, draft: pair.draft, published: undefined, isRoot: false }
      plan.dependencies.push(dep)
      try {
        assertModuleAction(ctx, projectId, td.permissions.write)
      } catch (e) {
        if (!(e instanceof TenantAuthorizationError)) throw e
        plan.forbidden.push(refOf(dep))
      }
      if (opts.withDependencies) queue.push(dep)
    }
  }
  return plan
}

/** Removes `_weak` / `_strengthenOnPublish` from every reference in a document (D-4: explicit strengthening). */
export function strengthenReferences<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => strengthenReferences(v)) as T
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  const isRef = typeof (value as Record<string, unknown>)._ref === 'string'
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isRef && (k === '_weak' || k === '_strengthenOnPublish')) continue
    out[k] = strengthenReferences(v)
  }
  return out as T
}

/** Lifecycle fields live on the published version; the service sets them (never copied blindly from a draft). */
const PUBLISH_LIFECYCLE_FIELDS = ['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'] as const

/**
 * The module's part of a publish: validate one document and return the
 * published version to write (without lifecycle fields — the service sets
 * them). Throw the module's error to refuse; nothing is written then.
 */
export type PublishPrepare = (node: PublishNode, x: { client: LifecycleClient; projectSlug: string; now: Date; publishedAt: string }) => Promise<Doc>

export type PublishTogetherInput = {
  root: { type: string; id: string; rev: string }
  /** Include never-published dependencies (D-5). false = refuse when there are any (D-4). */
  withDependencies: boolean
  /**
   * The root's dates, decided by the caller from the stored versions (publish
   * now / schedule / keep). Throw to refuse.
   */
  timing: (root: PublishNode, now: Date) => { publishedAt: string; expiresAt: string | null }
}

export type PublishTogetherResult = {
  root: Doc
  /** Every document published or scheduled by this call, root first. */
  published: Array<{ type: string; id: string; publishedAt: string }>
  /** Published-but-not-live dependencies (valid, untouched) — warn the editor. */
  notLive: Referrer[]
}

function dependencyError(d: LifecycleDescriptor, code: LifecycleErrorCode, message: string, refs: readonly Referrer[]): Error {
  return Object.assign(d.fail(code, message), { dependencies: [...refs] })
}

/**
 * ADR-032 Amendment B — publish (or schedule) a document together with its
 * never-published dependencies, or (withDependencies: false) refuse while it
 * has any. In order, before anything is written:
 *   1. the root's write permission (before any I/O);
 *   2. the dependency tree (planPublish; cycles safe), refusing missing
 *      targets, dependencies the editor may not publish, or — single publish —
 *      any never-published dependency, NAMING each;
 *   3. every document validated by the module (`prepare`).
 * Then ONE transaction, revision-guarded on every version it touches:
 * included dependencies take the root's publishedAt unless they carry their
 * own schedule (never overwritten); documents that already have a published
 * version are never touched; every reference of every written document is
 * strengthened explicitly. Any failure publishes nothing. One Activity row
 * per document, all with the transaction id.
 */
export function publishTogether(
  descriptors: readonly LifecycleDescriptor[],
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: PublishTogetherInput,
  prepare: PublishPrepare,
  deps: LifecycleDeps = {}
): Promise<PublishTogetherResult> {
  const rd = descriptors.find((x) => x.type === input?.root?.type)
  if (!rd) throw new Error(`publishTogether: no descriptor for ${String(input?.root?.type)}`)
  const intended: ContentAction = 'published'
  return audited(
    { ctx, projectId, contentType: rd.type, contentId: rd.isId(input.root.id) ? input.root.id : null, intended, writer: deps.audit },
    async (transactionId) => {
      assertModuleAction(ctx, projectId, rd.permissions.write)
      const grant = ctx.projects.find((p) => p.projectId === projectId)!
      if (!rd.isId(input.root.id)) throw rd.fail('not_found', 'Unknown item.')
      if (typeof input.root.rev !== 'string' || !input.root.rev) throw rd.fail('conflict', 'Missing revision.')
      const client = deps.client ?? sanityWriteClient
      const now = (deps.now ?? (() => new Date()))()
      const rootPair = await readPair(rd, client, input.root.id, grant.projectSlug)
      if (!rootPair.draft) throw rd.fail('not_found', 'Unknown item.')
      if (rootPair.draft._rev !== input.root.rev) throw rd.fail('conflict', 'This item was edited elsewhere.')
      if (isArchived(rootPair.published)) throw rd.fail('archived', 'Restore this item first.')
      const rootNode: PublishNode = { d: rd, id: input.root.id, draft: rootPair.draft, published: rootPair.published, isRoot: true }
      const { publishedAt, expiresAt } = input.timing(rootNode, now)
      const plan = await planPublish(descriptors, ctx, projectId, client, grant.projectSlug, input.root, {
        liveAt: new Date(Math.max(Date.parse(publishedAt), now.getTime())),
        withDependencies: input.withDependencies,
      })
      if (plan.missing.length) throw dependencyError(rd, 'unpublished_dependencies', 'Something this links to no longer exists.', plan.missing)
      if (!input.withDependencies && plan.dependencies.length) {
        throw dependencyError(rd, 'unpublished_dependencies', 'This links to content that was never published.', plan.dependencies.map((n) => refOf(n)))
      }
      if (plan.forbidden.length) throw dependencyError(rd, 'forbidden', 'You may not publish some of what this links to.', plan.forbidden)
      for (const n of plan.dependencies) if (isArchived(n.draft)) throw dependencyError(rd, 'archived', 'Something this links to is archived.', [refOf(n)])

      // Validate EVERYTHING before writing anything.
      const nodes = [rootNode, ...plan.dependencies]
      const docs: Doc[] = []
      for (const n of nodes) {
        const own = n.isRoot ? null : { publishedAt: iso(n.draft.publishedAt), expiresAt: iso(n.draft.expiresAt) }
        const at = own?.publishedAt ?? publishedAt
        const doc = strengthenReferences(await prepare(n, { client, projectSlug: grant.projectSlug, now, publishedAt: at }))
        for (const k of PUBLISH_LIFECYCLE_FIELDS) delete doc[k]
        doc._id = n.id
        doc._type = n.d.type
        doc.projectSlug = grant.projectSlug
        doc.publishedAt = at
        const exp = n.isRoot ? expiresAt : own?.expiresAt
        if (exp) doc.expiresAt = exp
        docs.push(doc)
      }

      await commit(rd, client, grant.projectSlug, () => {
        let tx = client.transaction()
        nodes.forEach((n, i) => {
          const doc = docs[i]
          tx = tx.patch(`drafts.${n.id}`, { ifRevisionID: n.draft._rev ?? '', unset: ['_publishGuard'] })
          if (n.published?._rev) {
            tx = tx.patch(n.id, { ifRevisionID: n.published._rev, unset: ['_publishGuard'] })
            tx = tx.createOrReplace(doc as { _id: string; _type: string })
          } else tx = tx.create(doc as { _id: string; _type: string })
          tx = tx.delete(`drafts.${n.id}`)
        })
        return tx.commit({ transactionId })
      })

      const rootDoc = { ...docs[0], _rev: transactionId }
      const state = snapshotOf(rootDoc)
      return {
        value: {
          root: rootDoc,
          published: nodes.map((n, i) => ({ type: n.d.type, id: n.id, publishedAt: docs[i].publishedAt as string })),
          notLive: plan.notLive,
        },
        action: lifecycleAction(snapshotOf(rootPair.published ?? null), state, rd.rule, now),
        state,
        also: plan.dependencies.map((n, i) => {
          const st = snapshotOf(docs[i + 1])
          return { contentType: n.d.type, contentId: n.id, action: lifecycleAction(null, st, n.d.rule, now), state: st }
        }),
      }
    }
  )
}
