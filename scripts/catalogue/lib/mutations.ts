// ── Catalogue rollout scripts — mutations, batching, in-memory application ────
//
// Pure. The data steps express every write as Sanity Mutations API objects
// (create / createIfNotExists / createOrReplace / delete / patch with set,
// unset, ifRevisionID). The SAME function applies them in memory for dry runs,
// the pre-flight simulation and the test client, so a dry run shows exactly
// what --apply would write.
//
// Batching (C10-6 "Writer identity and payload limit"): mutations are grouped
// per document pair (published + drafts.* + versions.* of one base id, or a
// project's config documents); a group is never split across transactions;
// transactions are filled against SANITY_MUTATION_MAX_BYTES with the shared
// 20 % margin (checkMutationSize). Transaction ids are
// `abluo-migr-<migrationId>-<n>` (catalogueTransactionId, C9 prefix list).

import { checkMutationSize, estimateMutationBytes } from '../../../src/lib/sanity/limits'
import { catalogueTransactionId } from '../../../src/lib/sanity/studio/catalogue-posture'
import type { Doc } from './docs'

export type PatchBody = { id: string; ifRevisionID?: string; set?: Record<string, unknown>; unset?: string[] }
export type Mutation =
  | { create: Doc }
  | { createIfNotExists: Doc }
  | { createOrReplace: Doc }
  | { delete: { id: string } }
  | { patch: PatchBody }

/** Mutations that must commit together (one document pair / one project's config). */
export type MutationGroup = { key: string; mutations: Mutation[] }

export type Transaction = { transactionId: string; mutations: Mutation[]; groups: string[] }

export class BatchError extends Error {
  constructor(public code: 'groupTooLarge', public groupKey: string, public bytes: number, public budget: number) {
    super(`mutation group ${groupKey} needs ${bytes} bytes, more than one transaction allows (${budget})`)
  }
}

/** Groups → transactions. Never splits a group; refuses a group that alone exceeds the budget. */
export function batchGroups(groups: readonly MutationGroup[], opts: { migrationId: string; limit?: number; startAt?: number }): Transaction[] {
  const out: Transaction[] = []
  let current: MutationGroup[] = []
  let n = opts.startAt ?? 1
  const flush = () => {
    if (!current.length) return
    out.push({ transactionId: catalogueTransactionId('migr', String(n++), { migrationId: opts.migrationId }), mutations: current.flatMap((g) => g.mutations), groups: current.map((g) => g.key) })
    current = []
  }
  for (const g of groups) {
    if (!g.mutations.length) continue
    const alone = checkMutationSize(estimateMutationBytes(g.mutations), { limit: opts.limit })
    if (!alone.fits) throw new BatchError('groupTooLarge', g.key, alone.bytes, alone.budget)
    const candidate = [...current, g].flatMap((x) => x.mutations)
    if (!checkMutationSize(estimateMutationBytes(candidate), { limit: opts.limit }).fits) flush()
    current.push(g)
  }
  flush()
  return out
}

// ── paths ─────────────────────────────────────────────────────────────────────

type Segment = { field: string; key?: string }

/** `a.b[_key=="k"].c` → segments. Only the forms the data steps write. */
export function parsePath(path: string): Segment[] {
  const out: Segment[] = []
  const re = /([A-Za-z_][A-Za-z0-9_]*)(?:\[_key=="([^"]+)"\])?(?:\.|$)/y
  let at = 0
  while (at < path.length) {
    re.lastIndex = at
    const m = re.exec(path)
    if (!m) throw new Error(`unsupported patch path: ${path}`)
    out.push({ field: m[1], ...(m[2] !== undefined && { key: m[2] }) })
    at = re.lastIndex
  }
  return out
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

function setPath(doc: Record<string, unknown>, path: string, value: unknown) {
  const segs = parsePath(path)
  let node: Record<string, unknown> = doc
  segs.forEach((s, i) => {
    const last = i === segs.length - 1
    if (s.key === undefined) {
      if (last) node[s.field] = clone(value)
      else {
        if (!node[s.field] || typeof node[s.field] !== 'object') throw new Error(`path ${path}: ${s.field} does not exist`)
        node = node[s.field] as Record<string, unknown>
      }
      return
    }
    const arr = node[s.field]
    const at = Array.isArray(arr) ? (arr as Record<string, unknown>[]).findIndex((x) => x?._key === s.key) : -1
    if (at < 0) throw new Error(`path ${path}: no element ${s.key}`)
    if (last) (arr as unknown[])[at] = clone(value)
    else node = (arr as Record<string, unknown>[])[at]
  })
}

function unsetPath(doc: Record<string, unknown>, path: string) {
  const segs = parsePath(path)
  let node: Record<string, unknown> | undefined = doc
  for (let i = 0; i < segs.length && node; i++) {
    const s = segs[i]
    const last = i === segs.length - 1
    if (s.key === undefined) {
      if (last) delete node[s.field]
      else node = node[s.field] as Record<string, unknown> | undefined
    } else {
      const arr: unknown = node[s.field]
      if (!Array.isArray(arr)) return
      if (last) node[s.field] = arr.filter((x) => (x as { _key?: unknown })?._key !== s.key)
      else node = arr.find((x) => (x as { _key?: unknown })?._key === s.key) as Record<string, unknown> | undefined
    }
  }
}

// ── in-memory application ─────────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(public id: string, public reason: 'revision' | 'exists' | 'missing') {
    super(`conflict on ${id}: ${reason}`)
  }
}

let revCounter = 0
const nextRev = () => `mem-${(++revCounter).toString(36)}`

/**
 * Apply mutations atomically to a Map of documents (all or nothing), as the
 * Content Lake does: ifRevisionID must match, create refuses an existing id,
 * patch refuses a missing one. Returns the new Map; the input is untouched.
 */
export function applyMutations(docs: ReadonlyMap<string, Doc>, mutations: readonly Mutation[]): Map<string, Doc> {
  const out = new Map(docs)
  const touched = new Set<string>()
  for (const m of mutations) {
    if ('create' in m) {
      if (out.has(m.create._id)) throw new ConflictError(m.create._id, 'exists')
      out.set(m.create._id, { ...clone(m.create), _rev: nextRev() })
      touched.add(m.create._id)
    } else if ('createIfNotExists' in m) {
      if (!out.has(m.createIfNotExists._id)) {
        out.set(m.createIfNotExists._id, { ...clone(m.createIfNotExists), _rev: nextRev() })
        touched.add(m.createIfNotExists._id)
      }
    } else if ('createOrReplace' in m) {
      out.set(m.createOrReplace._id, { ...clone(m.createOrReplace), _rev: nextRev() })
      touched.add(m.createOrReplace._id)
    } else if ('delete' in m) {
      out.delete(m.delete.id)
    } else {
      const p = m.patch
      const cur = out.get(p.id)
      if (!cur) throw new ConflictError(p.id, 'missing')
      // Within one transaction the revision is checked against the state before it.
      if (p.ifRevisionID !== undefined && !touched.has(p.id) && cur._rev !== p.ifRevisionID) throw new ConflictError(p.id, 'revision')
      const next = clone(cur) as Doc
      for (const [path, value] of Object.entries(p.set ?? {})) setPath(next, path, value)
      for (const path of p.unset ?? []) unsetPath(next, path)
      next._rev = nextRev()
      out.set(p.id, next)
      touched.add(p.id)
    }
  }
  return out
}

export const docsToMap = (docs: readonly Doc[]) => new Map(docs.map((d) => [d._id, d]))

/** Simulate a list of groups on a snapshot (dry run). */
export function simulate(docs: readonly Doc[], groups: readonly MutationGroup[]): Doc[] {
  let map = docsToMap(docs)
  for (const g of groups) map = applyMutations(map, g.mutations)
  return [...map.values()]
}

/** The path of the Catalogue installation's config on a project document. */
export const configPath = (installationKey: string) => `moduleInstallations[_key=="${installationKey}"].config`
