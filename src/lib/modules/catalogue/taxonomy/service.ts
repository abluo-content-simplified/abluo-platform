/**
 * CatalogueTaxonomyService — the ONLY writer of Catalogue categories and tags
 * (contract C1.7, K-4, D-2/D-3). Server-only: it imports the token-carrying
 * Sanity write client.
 *
 * Every operation, in this order:
 *   1. `assertCatalogueOperation(ctx, projectId, op)` for every capability of
 *      C8 `capabilitiesFor(op)` — BEFORE any I/O (delete is the one operation
 *      whose capability depends on stored data: the caller must hold one of the
 *      two category permissions first; the route is then derived server-side
 *      from C1 `deletionRoute(deletionBlockers(…))`, never from the client).
 *   2. Reads through `tenantScopedSanityClient` (raw perspective: drafts count),
 *      `assertSingleSanityProject` before any mutation.
 *   3. Every write to `catalogue-taxonomy.<slug>` is ONE mutation guarded by
 *      `ifRevisionID` (C1.7a). Idempotent operations re-plan against the fresh
 *      document and retry (≤ 3, jitter); user-intent operations never retry
 *      silently: `category_conflict` with { rev, tree, changedKeys }.
 *   4. The first write for a project SEEDS the document from its legacy term
 *      records with `seedTaxonomyFromTerms` (the D1 function, createIfNotExists,
 *      never overwrites).
 *   5. Transaction ids `abluo-setup-<op>-<id>` (C9 writer prefixes); C12 audit
 *      rows through `recordCatalogueActivity` after the commit, content-free.
 *
 * Tree logic (moves, cycles, paths, "unused") is tree.ts; stored rows are
 * write-model.ts. Inline category creation from the item editor calls
 * `createCategory` — the same function as Setup (D-3, P-21).
 */
import { randomUUID } from 'node:crypto'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient, type TenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { assertCatalogueCapabilities, assertCatalogueOperation, CatalogueForbidden, holdsCatalogueCapability } from '@/lib/api/catalogue-capability-guard'
import { span } from '@/lib/perf/timing'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { catalogueTransactionId } from '@/lib/sanity/studio/catalogue-posture'
import { deriveTermKey, ORDER_STEP } from '@/lib/taxonomy/rules'
import { isValidTermKey } from '@/lib/taxonomy/ids'
import { auditEntry, type CatalogueAuditEntry, type CatalogueAuditKind, type CatalogueAuditPayload } from '../audit/events'
import { recordCatalogueActivity, type CatalogueAuditWriter } from '../audit/writer'
import { readChannelRule, scheduleIssues } from '../commerce/availability-schedule'
import { CATEGORY_RULES, availabilityInputsOf, type ItemAvailabilityInput } from '../commerce/channel-availability'
import { readChannels, type ChannelSet } from '../commerce/channels'
import { asChannelKey } from '../commerce/commerce-types'
import { availabilityImpact } from '../commerce/impact'
import { availabilityItemsOf, ITEM_AVAILABILITY_QUERY, type ItemAvailabilityRow } from './availability-items'
import { IN_USE_SAMPLE_LIMIT, MAX_CATEGORIES, MAX_DEPTH, MAX_TAGS } from './limits'
import { catalogueTaxonomyId, CATALOGUE_TAXONOMY_TYPE, itemCategoryAssignment, readCategoryNodes, readTagNodes } from './read'
import { categoryReferenceSources, gatherCategoryReferences, itemCategoryReferenceSources } from './reference-sources'
import { seedTaxonomyFromTerms } from './seed'
import { buildTree, deletionBlockers, deletionRoute, descendantsOf, pathOf, planCategoryDeletion, planReassign, treeOrder, validateMove } from './tree'
import type {
  CategoryNode,
  CategoryPath,
  CategoryReferenceSource,
  CategoryRef,
  CategoryTree,
  ChannelAvailabilityRule,
  DeletionBlocker,
  DeletionRoute,
  TagNode,
  TreeIssue,
} from './types'
import {
  applyMovePatches,
  assignmentPatch,
  auditImpactCounts,
  changedKeys,
  mergeLabels,
  newCategoryRow,
  newTagRow,
  planUnassign,
  removeRow,
  rowHashes,
  ruleSummary,
  setRuleOnRows,
  siblingWithLabel,
  updateRows,
  type StoredRow,
} from './write-model'
import type { ImpactCounts, RuleSummary } from '../audit/events'

// ── Errors (C1.7 stable codes) ────────────────────────────────────────────────

export type CatalogueTaxonomyErrorCode =
  | 'category_unknown'
  | 'category_parent_unknown'
  | 'category_cycle'
  | 'category_depth_exceeded'
  | 'category_archived_parent'
  | 'category_archived_target'
  | 'category_key_invalid'
  | 'category_key_immutable'
  | 'category_label_required'
  | 'category_label_too_long'
  | 'category_label_duplicate_sibling'
  | 'category_limit'
  | 'category_rule_unknown_channel'
  | 'category_primary_required'
  | 'category_duplicate'
  | 'category_too_many'
  | 'category_has_children'
  | 'category_in_use'
  | 'category_referenced'
  | 'category_setup_required'
  | 'category_cleanup_unresolvable'
  | 'category_rule_schedule_invalid'
  | 'category_conflict'
  | 'category_failed'
  | 'tag_unknown'
  | 'tag_key_immutable'
  | 'tag_label_required'
  | 'tag_label_too_long'
  | 'tag_limit'
  | 'tag_in_use'
  | 'tag_conflict'
  /** Malformed input that no specific code covers (missing parent choice, missing rev, unknown language …). */
  | 'invalid_input'

export type CatalogueTaxonomyErrorDetail = {
  /** category_conflict / tag_conflict: the fresh state, so the UI can show "Changed elsewhere — review". */
  rev?: string
  tree?: readonly CategoryNode[]
  tags?: readonly TagNode[]
  changedKeys?: readonly string[]
  /** in_use / referenced / setup_required / unresolvable. */
  blockers?: readonly DeletionBlocker[]
  count?: number
  sample?: readonly CategoryRef[]
  /** setup_required: the capability the operation needs. */
  capability?: 'catalogue.setup.manage'
  /** rule_schedule_invalid: the C5a code (e.g. availability.scheduleOverlap). */
  code?: string
  field?: string
  key?: string
}

export class CatalogueTaxonomyError extends Error {
  constructor(
    readonly code: CatalogueTaxonomyErrorCode,
    message: string,
    readonly detail?: CatalogueTaxonomyErrorDetail,
  ) {
    super(message)
    this.name = 'CatalogueTaxonomyError'
  }
}

const fail = (code: CatalogueTaxonomyErrorCode, message: string, detail?: CatalogueTaxonomyErrorDetail): never => {
  throw new CatalogueTaxonomyError(code, message, detail)
}

// ── Deps ──────────────────────────────────────────────────────────────────────

type Client = Pick<typeof sanityWriteClient, 'fetch' | 'transaction'>
export type CatalogueTaxonomyDeps = {
  client?: Client
  now?: () => Date
  /** Unique part of transaction ids (default randomUUID). */
  uuid?: () => string
  audit?: CatalogueAuditWriter
  /** Reference sources besides the built-in item sources (default: the registered ones). */
  sources?: readonly CategoryReferenceSource[]
  /** Retry back-off (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

const RAW = { perspective: 'raw' } as const
const MAX_ATTEMPTS = 3
/** Item documents per reassignment transaction (C1.7a: chunked ≤ 100). */
export const REASSIGN_CHUNK = 100

// ── Queries (all project-scoped by $projectSlug) ──────────────────────────────

const SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
export const TAXONOMY_DOC_QUERY = /* groq */ `*[_type == "${CATALOGUE_TAXONOMY_TYPE}" && _id == $id && projectSlug == $projectSlug][0]{ _id, _rev, categories, tags }`
export const TERM_RECORDS_QUERY = /* groq */ `*[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "catalogue" && !(_id in path("drafts.**"))] | order(order asc, key asc){ kind, key, label, order, color }`
export const CATALOGUE_CONFIG_QUERY = /* groq */ `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ "config": moduleInstallations[moduleId == "catalogue"][0].config{ serviceChannels, categories } }`
/** Every item document copy (drafts included, versions excluded): category and tag fields only. */
export const ITEM_TERMS_QUERY = /* groq */ `*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, _rev, primaryCategory, additionalCategories, categories, tags, "name": coalesce(name[$locale], name[$defaultLocale], name.en, "") }`
const OPTION_LISTS_QUERY = /* groq */ `*[_type == "catalogueOptionList" && projectSlug == $projectSlug && (_id in $ids || _id in $draftIds)]._id`

// ── Access + reads ────────────────────────────────────────────────────────────

type Site = { defaultLocale: string; locales: string[] }
type Access = { ctx: TenantAuthorizationContext; projectId: string; projectSlug: string; id: string; client: Client; scoped: TenantScopedSanityClient; deps: CatalogueTaxonomyDeps }

function open(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueTaxonomyDeps): Access {
  const client = deps.client ?? sanityWriteClient
  const scoped = tenantScopedSanityClient(ctx, projectId, {
    fetch: <T>(query: string, params?: Record<string, unknown>) => client.fetch(query, params ?? {}, RAW) as Promise<T>,
  })
  return { ctx, projectId, projectSlug: scoped.projectSlug, id: catalogueTaxonomyId(scoped.projectSlug), client, scoped, deps }
}

async function readSite(a: Access): Promise<Site> {
  const r = await span('sanity.readSite', () => a.scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(SITE_QUERY))
  const supported = r?.supportedLocales?.length ? r.supportedLocales : []
  const defaultLocale = r?.defaultLocale || supported[0]
  if (!defaultLocale) fail('category_failed', 'Site languages are not configured.')
  return { defaultLocale: defaultLocale!, locales: [defaultLocale!, ...supported.filter((l) => l !== defaultLocale)] }
}

type RawDoc = { _id: string; _rev: string; categories?: unknown; tags?: unknown } | null
type Config = { serviceChannels?: unknown; categories?: unknown } | null

export type TaxonomyState = {
  /** '' = the document does not exist yet (virtual, seeded from term records). */
  rev: string
  exists: boolean
  categoryRows: StoredRow[]
  tagRows: StoredRow[]
  tree: CategoryTree
  tags: TagNode[]
  site: Site
  channels: ChannelSet
  config: Config
}

const asRows = (v: unknown): StoredRow[] => (Array.isArray(v) ? v.filter((r): r is StoredRow => !!r && typeof r === 'object') : [])

function stateOf(doc: RawDoc, seed: { categories: StoredRow[]; tags: StoredRow[] } | null, site: Site, config: Config): TaxonomyState {
  const categoryRows = doc ? asRows(doc.categories) : (seed?.categories ?? [])
  const tagRows = doc ? asRows(doc.tags) : (seed?.tags ?? [])
  return {
    rev: doc?._rev ?? '',
    exists: !!doc,
    categoryRows,
    tagRows,
    tree: buildTree(readCategoryNodes(categoryRows)),
    tags: readTagNodes(tagRows),
    site,
    channels: readChannels(config?.serviceChannels).channels,
    config,
  }
}

async function readSeed(a: Access, config: Config): Promise<{ categories: StoredRow[]; tags: StoredRow[] }> {
  const terms = await span('sanity.readTerms', () => a.scoped.fetch<unknown[] | null>(TERM_RECORDS_QUERY))
  const seed = seedTaxonomyFromTerms((terms ?? []) as never, (Array.isArray(config?.categories) ? config!.categories : []) as never)
  return { categories: seed.categories as unknown as StoredRow[], tags: seed.tags as unknown as StoredRow[] }
}

/** The current state; a missing document is shown as its seed (what the first write will create). */
export async function readState(a: Access): Promise<TaxonomyState> {
  const [site, doc, project] = await Promise.all([
    readSite(a),
    span('sanity.readTaxonomy', () => a.scoped.fetch<RawDoc>(TAXONOMY_DOC_QUERY, { id: a.id })),
    span('sanity.readConfig', () => a.scoped.fetch<{ config?: Config } | null>(CATALOGUE_CONFIG_QUERY)),
  ])
  const config = project?.config ?? null
  return stateOf(doc ?? null, doc ? null : await readSeed(a, config), site, config)
}

const singleProject = (a: Access) => span('sanity.assertSingleProject', () => assertSingleSanityProject((q, p) => a.client.fetch(q, p), a.projectSlug))

const now = (a: Access) => (a.deps.now?.() ?? new Date()).toISOString()
const txId = (a: Access, op: string) => catalogueTransactionId('setup', `${op}-${(a.deps.uuid ?? randomUUID)().replace(/-/g, '').slice(0, 32)}`)

const isConflict = (e: unknown): boolean => {
  const x = e as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return x?.statusCode === 409 || x?.response?.statusCode === 409 || /revision/i.test(String(x?.message ?? ''))
}

/** First write for a project: create the document from its term records (never overwrites). Returns the seeded rev, or null when it already existed. */
async function ensureDocument(a: Access): Promise<string | null> {
  const doc = await a.scoped.fetch<RawDoc>(TAXONOMY_DOC_QUERY, { id: a.id })
  if (doc) return null
  const project = await a.scoped.fetch<{ config?: Config } | null>(CATALOGUE_CONFIG_QUERY)
  const seed = await readSeed(a, project?.config ?? null)
  const transactionId = txId(a, 'seed')
  try {
    await span('sanity.seedTaxonomy', () =>
      a.client
        .transaction()
        .createIfNotExists({ _id: a.id, _type: CATALOGUE_TAXONOMY_TYPE, projectSlug: a.projectSlug, categories: seed.categories, tags: seed.tags, updatedAt: now(a), updatedBy: a.ctx.userId })
        .commit({ transactionId }),
    )
  } catch {
    fail('category_failed', 'Could not save.')
  }
  const after = await a.scoped.fetch<RawDoc>(TAXONOMY_DOC_QUERY, { id: a.id })
  return after?._rev ?? null
}

// ── The guarded writer (C1.7a) ────────────────────────────────────────────────

type Plan<T> = { value: T; categories?: StoredRow[]; tags?: StoredRow[] }
type WriteSpec<T> = {
  op: string
  /** 'idempotent' re-plans and retries on a revision conflict; 'user' returns category_conflict. */
  mode: 'idempotent' | 'user'
  /** user ops: the revision the caller loaded ('' = it loaded the virtual, not-yet-seeded document). */
  rev?: string
  /** user ops: per-key row fingerprints the caller loaded (list → hashes), for changedKeys. */
  baseHashes?: Readonly<Record<string, string>>
  conflictCode?: 'category_conflict' | 'tag_conflict'
  plan: (s: TaxonomyState) => Plan<T>
}

function conflict(s: TaxonomyState, spec: Pick<WriteSpec<unknown>, 'baseHashes' | 'conflictCode'>): never {
  const now = { ...rowHashes(s.categoryRows), ...prefixed(rowHashes(s.tagRows)) }
  throw new CatalogueTaxonomyError(spec.conflictCode ?? 'category_conflict', 'This was changed elsewhere.', {
    rev: s.rev,
    tree: treeOrder(s.tree).map((k) => s.tree.nodes.get(k)!),
    tags: s.tags,
    changedKeys: changedKeys(spec.baseHashes, now),
  })
}
const prefixed = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [`tag:${k}`, v]))

async function write<T>(a: Access, spec: WriteSpec<T>): Promise<{ value: T; state: TaxonomyState; transactionId: string | null }> {
  if (spec.mode === 'user' && typeof spec.rev !== 'string') fail('invalid_input', 'Missing revision.', { field: 'rev' })
  await singleProject(a)
  const seededRev = await ensureDocument(a)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const s = await readState(a)
    if (spec.mode === 'user') {
      const loadedVirtual = spec.rev === '' && seededRev !== null && s.rev === seededRev
      if (!loadedVirtual && spec.rev !== s.rev) conflict(s, spec)
    }
    const planned = spec.plan(s)
    if (!planned.categories && !planned.tags) return { value: planned.value, state: s, transactionId: null }
    const set: Record<string, unknown> = { updatedAt: now(a), updatedBy: a.ctx.userId }
    if (planned.categories) set.categories = planned.categories
    if (planned.tags) set.tags = planned.tags
    const transactionId = txId(a, spec.op)
    try {
      await span('sanity.commit', () => a.client.transaction().patch(a.id, { ifRevisionID: s.rev, set }).commit({ transactionId }))
      const after = { ...s, categoryRows: planned.categories ?? s.categoryRows, tagRows: planned.tags ?? s.tagRows }
      return { value: planned.value, state: { ...after, tree: buildTree(readCategoryNodes(after.categoryRows)), tags: readTagNodes(after.tagRows) }, transactionId }
    } catch (error) {
      if (!isConflict(error)) fail('category_failed', 'Could not save.')
      if (spec.mode === 'user') conflict(await readState(a), spec)
      await (a.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(20 + Math.floor(Math.random() * 60))
    }
  }
  return conflict(await readState(a), spec)
}

async function audit<K extends CatalogueAuditKind>(a: Access, kind: K, transactionId: string | null, targetId: string, detail: CatalogueAuditPayload[K]): Promise<void> {
  const entry: CatalogueAuditEntry = auditEntry(kind, {
    projectId: a.projectId,
    targetId,
    actor: { kind: 'user', id: a.ctx.userId, support: !!a.ctx.support },
    ...(transactionId && { transactionId }),
    detail,
  })
  try {
    await (a.deps.audit ?? ((e: CatalogueAuditEntry) => recordCatalogueActivity(e)))(entry)
  } catch {
    /* the audit writer never breaks the action */
  }
}

// ── Validation helpers ───────────────────────────────────────────────────────

function labelsOrFail(current: Record<string, string>, edits: unknown, site: Site, kind: 'category' | 'tag'): Record<string, string> {
  const r = mergeLabels(current, edits, site)
  if (r.ok) return r.labels
  if (r.code === 'label_too_long') return fail(kind === 'tag' ? 'tag_label_too_long' : 'category_label_too_long', 'Label too long.', { field: `label.${r.locale}` })
  if (r.code === 'label_required') return fail(kind === 'tag' ? 'tag_label_required' : 'category_label_required', 'A label in the main language is required.', { field: `label.${r.locale}` })
  return fail('invalid_input', 'Unknown language or invalid label.', { field: `label.${r.locale ?? ''}` })
}

const keyOrFail = (key: unknown, code: 'category_key_invalid' | 'tag_unknown' = 'category_key_invalid'): string => (isValidTermKey(key) ? key : fail(code, 'Invalid key.'))

function nodeOrFail(s: TaxonomyState, key: unknown): CategoryNode {
  const k = keyOrFail(key)
  return s.tree.nodes.get(k) ?? fail('category_unknown', 'Unknown category.', { key: k })
}

function tagOrFail(s: TaxonomyState, key: unknown): TagNode {
  if (!isValidTermKey(key)) fail('tag_unknown', 'Unknown tag.')
  return s.tags.find((t) => t.key === key) ?? fail('tag_unknown', 'Unknown tag.', { key: key as string })
}

/** Normalises a rule from the client through the ONE stored-row reader, then the C5a validator (I7). */
export function readRuleInput(raw: unknown, channels: ChannelSet, channel: string): ChannelAvailabilityRule {
  if (!channels.byKey.has(asChannelKey(channel))) fail('category_rule_unknown_channel', 'Unknown channel.', { key: channel })
  const r = (raw ?? {}) as { state?: unknown; overrides?: unknown }
  const overrides = (Array.isArray(r.overrides) ? r.overrides : []).map((o, i) => {
    const x = (o ?? {}) as Record<string, unknown>
    const key = typeof x.key === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.key) ? x.key : `s${i + 1}`
    return { _key: key, _type: 'catalogueWeeklyOverride', days: x.days, from: x.from, to: x.to, state: x.state }
  })
  const read = readChannelRule({ _key: channel, channel, state: r.state, schedule: overrides })
  if (!read.rule || read.issues.length > 0) fail('category_rule_schedule_invalid', 'Invalid availability rule.', { code: read.issues[0] ?? 'availability.stateInvalid' })
  const errors = scheduleIssues(read.rule!).filter((i) => i.level === 'error')
  if (errors.length > 0) fail('category_rule_schedule_invalid', 'Invalid schedule.', { code: errors[0].code })
  return read.rule!
}

// ── Items (assignment reads, availability inputs) ─────────────────────────────

type ItemTermRow = { _id: string; _rev?: string; primaryCategory?: unknown; additionalCategories?: unknown; categories?: unknown; tags?: unknown; name?: unknown }

const baseId = (id: string) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)

async function readItemTerms(a: Access, s: TaxonomyState): Promise<ItemTermRow[]> {
  return (await span('sanity.readItemTerms', () => a.scoped.fetch<ItemTermRow[] | null>(ITEM_TERMS_QUERY, { locale: s.site.defaultLocale, defaultLocale: s.site.defaultLocale }))) ?? []
}

async function readAvailabilityItems(a: Access, tree: CategoryTree, channels: ChannelSet): Promise<ItemAvailabilityInput[]> {
  return availabilityItemsOf(await span('sanity.readItemAvailability', () => a.scoped.fetch<ItemAvailabilityRow[] | null>(ITEM_AVAILABILITY_QUERY)), tree, channels)
}

const inputsFor = (s: TaxonomyState, tree: CategoryTree) => availabilityInputsOf(s.channels, { tree, category: CATEGORY_RULES })

function referenceSources(a: Access, s: TaxonomyState): CategoryReferenceSource[] {
  const fetch = (q: string, p: Record<string, unknown>) => a.scoped.fetch<never>(q, p)
  return [...itemCategoryReferenceSources(fetch, { locale: s.site.defaultLocale, defaultLocale: s.site.defaultLocale }), ...(a.deps.sources ?? categoryReferenceSources())]
}

// ── Views ─────────────────────────────────────────────────────────────────────

export type TaxonomyCategoryView = CategoryNode & { depth: number; childCount: number; hash: string; items: number }
export type TaxonomyTagView = TagNode & { hash: string; items: number }
export type CatalogueTaxonomyView = {
  /** Pass back on user-intent operations ('' while the document is not created yet). */
  rev: string
  exists: boolean
  defaultLocale: string
  locales: string[]
  /** Tree order (pre-order, sibling order). */
  categories: TaxonomyCategoryView[]
  tags: TaxonomyTagView[]
  issues: readonly TreeIssue[]
  channels: { key: string; label: unknown; active: boolean }[]
  /** UI hints; every write re-checks server-side. */
  can: { write: boolean; manage: boolean }
}

function countItems(rows: readonly ItemTermRow[], tree: CategoryTree): { categories: Map<string, Set<string>>; tags: Map<string, Set<string>> } {
  const categories = new Map<string, Set<string>>()
  const tags = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, id: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(id)
  for (const r of rows) {
    const id = baseId(r._id)
    const a = itemCategoryAssignment(r, tree)
    for (const k of a.primary !== null ? [a.primary, ...a.additional] : a.additional) add(categories, k, id)
    for (const t of Array.isArray(r.tags) ? r.tags : []) if (typeof t === 'string') add(tags, t, id)
  }
  return { categories, tags }
}

function viewOf(a: Access, s: TaxonomyState, rows: readonly ItemTermRow[]): CatalogueTaxonomyView {
  const hashes = rowHashes(s.categoryRows)
  const tagHashes = rowHashes(s.tagRows)
  const counts = countItems(rows, s.tree)
  return {
    rev: s.rev,
    exists: s.exists,
    defaultLocale: s.site.defaultLocale,
    locales: s.site.locales,
    categories: treeOrder(s.tree).map((k) => {
      const n = s.tree.nodes.get(k)!
      return { ...n, depth: s.tree.depthOf.get(k) ?? 0, childCount: (s.tree.childrenOf.get(k) ?? []).length, hash: hashes[k] ?? '', items: counts.categories.get(k)?.size ?? 0 }
    }),
    tags: s.tags.map((t) => ({ ...t, hash: tagHashes[t.key] ?? '', items: counts.tags.get(t.key)?.size ?? 0 })),
    issues: s.tree.issues,
    channels: s.channels.all.map((c) => ({ key: c.key, label: c.label, active: c.active })),
    can: {
      write: holdsCatalogueCapability(a.ctx, a.projectId, 'catalogue.taxonomy.write'),
      manage: holdsCatalogueCapability(a.ctx, a.projectId, 'catalogue.setup.manage'),
    },
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Operations
// ═════════════════════════════════════════════════════════════════════════════


/** The project's Catalogue categories and tags with item counts (drafts included). Needs `catalogue.item.read`. */
export async function listTaxonomy(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueTaxonomyDeps = {}): Promise<CatalogueTaxonomyView> {
  assertCatalogueCapabilities(ctx, projectId, ['catalogue.item.read'])
  const a = open(ctx, projectId, deps)
  const s = await readState(a)
  return viewOf(a, s, await readItemTerms(a, s))
}

async function currentRev(a: Access): Promise<string> {
  return (await a.scoped.fetch<RawDoc>(TAXONOMY_DOC_QUERY, { id: a.id }))?._rev ?? ''
}

const revAfter = async (a: Access, r: { transactionId: string | null; state: TaxonomyState }) => (r.transactionId ? currentRev(a) : r.state.rev)

// ── Categories: create (Setup AND inline from the item editor — one function) ──

export type CreateCategoryInput = {
  labels: Record<string, string>
  /** REQUIRED choice: a category key, or null for "Top level". `undefined` is refused (C1.11 inline/parent-required). */
  parentKey: string | null
  /** Position among the new siblings; omitted = last. */
  index?: number
  /** Locale of the returned path (default: the site's default language). */
  locale?: string
}
export type CreateCategoryResult = { category: CategoryNode; path: CategoryPath; created: boolean; rev: string }

export async function createCategory(ctx: TenantAuthorizationContext, projectId: string, input: CreateCategoryInput, deps: CatalogueTaxonomyDeps = {}): Promise<CreateCategoryResult> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.create' })
  if (!input || input.parentKey === undefined) fail('invalid_input', 'Choose where the category goes.', { field: 'parentKey' })
  const parentKey = input.parentKey === null ? null : keyOrFail(input.parentKey)
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'createCategory',
    mode: 'idempotent',
    plan: (s) => {
      const labels = labelsOrFail({}, input.labels, s.site, 'category')
      const defaultLabel = labels[s.site.defaultLocale]
      if (parentKey !== null) {
        const parent = s.tree.nodes.get(parentKey) ?? fail('category_parent_unknown', 'Unknown parent.', { key: parentKey })
        if (parent.archivedAt) fail('category_archived_parent', 'That parent is archived.', { key: parentKey })
        if ((s.tree.depthOf.get(parentKey) ?? 0) + 2 > MAX_DEPTH) fail('category_depth_exceeded', 'Too many levels.')
      }
      // A twin (same folded main-language label under the same parent) is returned, never duplicated.
      const twin = siblingWithLabel(s.tree, parentKey, defaultLabel, s.site.defaultLocale)
      if (twin) return { value: { key: twin, created: false } }
      if (s.tree.nodes.size >= MAX_CATEGORIES) fail('category_limit', `At most ${MAX_CATEGORIES} categories.`)
      const key = deriveTermKey(defaultLabel, [...s.tree.nodes.keys()])
      if (!isValidTermKey(key)) fail('category_key_invalid', 'Invalid key.')
      // Position with the one move planner: append the node, then "move" it to the index.
      const appended = [...s.categoryRows, newCategoryRow(key, labels, parentKey, Number.MAX_SAFE_INTEGER)]
      const move = validateMove(buildTree(readCategoryNodes(appended)), { key, newParentKey: parentKey, index: input.index })
      if (!move.ok) return fail(move.code as CatalogueTaxonomyErrorCode, 'Invalid position.', { key })
      return { value: { key, created: true }, categories: applyMovePatches(appended, move.patches) }
    },
  })
  const s = r.state
  return {
    category: s.tree.nodes.get(r.value.key)!,
    path: pathOf(s.tree, r.value.key, { locale: input.locale ?? s.site.defaultLocale, defaultLocale: s.site.defaultLocale, locales: s.site.locales }),
    created: r.value.created,
    rev: await revAfter(a, r),
  }
}

// ── Categories: rename / translate (taxonomy.write) ──────────────────────────

export type UserOpBase = {
  /** The revision the caller loaded (list → rev). */
  rev: string
  /** The row fingerprints the caller loaded (list → categories[].hash / tags[].hash, tags prefixed "tag:"), for changedKeys on conflict. */
  baseHashes?: Record<string, string>
}

export async function updateCategory(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: UserOpBase & { key: string; labels: Record<string, string | null>; nextKey?: string },
  deps: CatalogueTaxonomyDeps = {},
): Promise<{ category: CategoryNode; rev: string }> {
  assertCatalogueOperation(ctx, projectId, [{ op: 'term.rename' }, { op: 'term.translate' }])
  if (input?.nextKey !== undefined && input.nextKey !== input.key) fail('category_key_immutable', 'A category key never changes.')
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'renameCategory',
    mode: 'user',
    rev: input?.rev,
    baseHashes: input?.baseHashes,
    plan: (s) => {
      const node = nodeOrFail(s, input.key)
      const labels = labelsOrFail(node.label, input.labels, s.site, 'category')
      const def = labels[s.site.defaultLocale]
      if (def !== node.label[s.site.defaultLocale] && siblingWithLabel(s.tree, node.parentKey, def, s.site.defaultLocale, node.key)) {
        fail('category_label_duplicate_sibling', 'Another category here already has that name.', { key: node.key })
      }
      if (JSON.stringify(labels) === JSON.stringify(node.label)) return { value: node.key }
      return { value: node.key, categories: updateRows(s.categoryRows, node.key, { label: { _type: 'localizedString', ...labels } }) }
    },
  })
  return { category: r.state.tree.nodes.get(r.value)!, rev: await revAfter(a, r) }
}

// ── Categories: reorder siblings (taxonomy.write) ─────────────────────────────

export async function reorderChildren(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: UserOpBase & { parentKey: string | null; keys: string[] },
  deps: CatalogueTaxonomyDeps = {},
): Promise<{ order: { key: string; order: number }[]; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.reorder' })
  if (!input || !Array.isArray(input.keys) || new Set(input.keys).size !== input.keys.length || !input.keys.every(isValidTermKey)) fail('invalid_input', 'Invalid order.', { field: 'keys' })
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'reorderCategories',
    mode: 'user',
    rev: input.rev,
    baseHashes: input.baseHashes,
    plan: (s) => {
      const parent = input.parentKey === null ? null : nodeOrFail(s, input.parentKey).key
      const siblings = parent === null ? s.tree.roots : (s.tree.childrenOf.get(parent) ?? [])
      if (input.keys.some((k) => !siblings.includes(k))) fail('category_unknown', 'Only categories of this level can be reordered here.')
      const sequence = [...input.keys, ...siblings.filter((k) => !input.keys.includes(k))]
      const order = sequence.map((key, i) => ({ key, order: (i + 1) * ORDER_STEP }))
      const changed = order.filter((o) => s.tree.nodes.get(o.key)!.order !== o.order)
      if (changed.length === 0) return { value: order }
      return { value: order, categories: applyMovePatches(s.categoryRows, changed.map((o) => ({ ...o, parentKey: parent }))) }
    },
  })
  return { order: r.value, rev: await revAfter(a, r) }
}

// ── Categories: move between parents (setup.manage, counted, audited) ────────

export type MoveImpact = { items: number; formats: number; availability: ImpactCounts }
type MoveInput = { key: string; newParentKey: string | null; index?: number }

function planMove(s: TaxonomyState, input: MoveInput) {
  const node = nodeOrFail(s, input?.key)
  if (input.newParentKey === undefined) fail('invalid_input', 'Choose the new parent.', { field: 'newParentKey' })
  const move = validateMove(s.tree, { key: node.key, newParentKey: input.newParentKey === null ? null : keyOrFail(input.newParentKey), index: input.index })
  if (!move.ok) return fail(move.code as CatalogueTaxonomyErrorCode, 'This move is not possible.', { key: move.key })
  const rows = applyMovePatches(s.categoryRows, move.patches)
  return { node, rows, after: buildTree(readCategoryNodes(rows)) }
}

async function moveImpact(a: Access, s: TaxonomyState, after: CategoryTree, key: string): Promise<MoveImpact> {
  const [items, availability] = await Promise.all([readItemTerms(a, s), readAvailabilityItems(a, s.tree, s.channels)])
  const subtree = new Set(descendantsOf(s.tree, key, { includeSelf: true }))
  const ids = new Set<string>()
  for (const r of items) {
    const asg = itemCategoryAssignment(r, s.tree)
    if ([asg.primary, ...asg.additional].some((k) => k !== null && subtree.has(k))) ids.add(baseId(r._id))
  }
  const impact = auditImpactCounts(availabilityImpact(inputsFor(s, s.tree), inputsFor(s, after), availability))
  return { items: ids.size, formats: impact.formats, availability: impact }
}

/** Counted preview of a move: items in the moved subtree and the availability change on every channel (C5-6). */
export async function previewCategoryMove(ctx: TenantAuthorizationContext, projectId: string, input: MoveInput, deps: CatalogueTaxonomyDeps = {}): Promise<MoveImpact> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.reparent' })
  const a = open(ctx, projectId, deps)
  const s = await readState(a)
  const p = planMove(s, input)
  return moveImpact(a, s, p.after, p.node.key)
}

export async function moveCategory(ctx: TenantAuthorizationContext, projectId: string, input: UserOpBase & MoveInput, deps: CatalogueTaxonomyDeps = {}): Promise<{ category: CategoryNode; impact: MoveImpact; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.reparent' })
  const a = open(ctx, projectId, deps)
  let planned: { from: string | null; before: TaxonomyState; after: CategoryTree } | null = null
  const r = await write(a, {
    op: 'moveCategory',
    mode: 'user',
    rev: input?.rev,
    baseHashes: input?.baseHashes,
    plan: (s) => {
      const p = planMove(s, input)
      planned = { from: p.node.parentKey, before: s, after: p.after }
      return { value: p.node.key, categories: p.rows }
    },
  })
  const p = planned! as { from: string | null; before: TaxonomyState; after: CategoryTree }
  const impact = await moveImpact(a, p.before, p.after, r.value)
  const category = r.state.tree.nodes.get(r.value)!
  await audit(a, 'category.restructured', r.transactionId, r.value, { op: 'move', categoryKey: r.value, fromParent: p.from, toParent: category.parentKey, impact: { items: impact.items, formats: impact.formats } })
  return { category, impact, rev: await revAfter(a, r) }
}

// ── Categories: archive / unarchive (setup.manage, idempotent) ───────────────

async function setArchived(ctx: TenantAuthorizationContext, projectId: string, key: unknown, archived: boolean, deps: CatalogueTaxonomyDeps) {
  assertCatalogueOperation(ctx, projectId, { op: archived ? 'term.archive' : 'term.unarchive', kind: 'category' })
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: archived ? 'archiveCategory' : 'unarchiveCategory',
    mode: 'idempotent',
    plan: (s) => {
      const node = nodeOrFail(s, key)
      if (!!node.archivedAt === archived) return { value: node.key }
      return { value: node.key, categories: updateRows(s.categoryRows, node.key, { archivedAt: archived ? now(a) : undefined }) }
    },
  })
  return { category: r.state.tree.nodes.get(r.value)!, rev: await revAfter(a, r) }
}
export const archiveCategory = (ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueTaxonomyDeps = {}) => setArchived(ctx, projectId, input?.key, true, deps)
export const unarchiveCategory = (ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueTaxonomyDeps = {}) => setArchived(ctx, projectId, input?.key, false, deps)

// ── Categories: default option lists for NEW items (setup.manage — item defaults) ──

export async function setCategoryDefaults(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: UserOpBase & { key: string; defaultOptionListIds: string[] },
  deps: CatalogueTaxonomyDeps = {},
): Promise<{ category: CategoryNode; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'setup.defaults' })
  const ids = Array.isArray(input?.defaultOptionListIds) ? input.defaultOptionListIds : fail('invalid_input', 'Invalid option lists.', { field: 'defaultOptionListIds' })
  const clean = [...new Set(ids.map((i) => (typeof i === 'string' ? baseId(i) : '')))]
  if (clean.some((i) => !/^[A-Za-z0-9._-]{1,128}$/.test(i))) fail('invalid_input', 'Invalid option lists.', { field: 'defaultOptionListIds' })
  const a = open(ctx, projectId, deps)
  if (clean.length > 0) {
    const found = (await a.scoped.fetch<string[] | null>(OPTION_LISTS_QUERY, { ids: clean, draftIds: clean.map((i) => `drafts.${i}`) })) ?? []
    const known = new Set(found.map(baseId))
    if (clean.some((i) => !known.has(i))) fail('invalid_input', 'Unknown option list.', { field: 'defaultOptionListIds' })
  }
  const r = await write(a, {
    op: 'categoryDefaults',
    mode: 'user',
    rev: input.rev,
    baseHashes: input.baseHashes,
    plan: (s) => {
      const node = nodeOrFail(s, input.key)
      if (JSON.stringify(node.defaultOptionListIds) === JSON.stringify(clean)) return { value: node.key }
      return { value: node.key, categories: updateRows(s.categoryRows, node.key, { defaultOptionListIds: clean.length ? clean : undefined }) }
    },
  })
  return { category: r.state.tree.nodes.get(r.value)!, rev: await revAfter(a, r) }
}

// ── Categories: channel availability rules incl. schedules (setup.manage) ────

export type RuleChangePreview = { before: RuleSummary; after: RuleSummary; impact: ImpactCounts }
type RuleInput = { key: string; channel: string; rule: unknown | null }

function planRule(s: TaxonomyState, input: RuleInput) {
  const node = nodeOrFail(s, input?.key)
  if (typeof input.channel !== 'string') fail('category_rule_unknown_channel', 'Unknown channel.')
  const channel = asChannelKey(input.channel)
  const before = node.channelRules[channel] ?? null
  // Removing a rule of a channel that no longer exists is allowed (cleanup); setting one is not (I7).
  const rule = input.rule === null ? null : readRuleInput(input.rule, s.channels, input.channel)
  if (rule === null && !before && !s.channels.byKey.has(channel)) fail('category_rule_unknown_channel', 'Unknown channel.')
  const rows = setRuleOnRows(s.categoryRows, node.key, input.channel, rule)
  return { node, rule, before, rows, after: buildTree(readCategoryNodes(rows)) }
}

async function ruleImpact(a: Access, s: TaxonomyState, after: CategoryTree): Promise<ImpactCounts> {
  const items = await readAvailabilityItems(a, s.tree, s.channels)
  return auditImpactCounts(availabilityImpact(inputsFor(s, s.tree), inputsFor(s, after), items))
}

/** C5-6 counted preview of a category rule/schedule change (`rule: null` = use the inherited rule again). Nothing written. */
export async function previewCategoryRule(ctx: TenantAuthorizationContext, projectId: string, input: RuleInput, deps: CatalogueTaxonomyDeps = {}): Promise<RuleChangePreview> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.setAvailabilityRule' })
  const a = open(ctx, projectId, deps)
  const s = await readState(a)
  const p = planRule(s, input)
  return { before: ruleSummary(p.before), after: ruleSummary(p.rule), impact: await ruleImpact(a, s, p.after) }
}

/** Sets (or, with `rule: null`, removes) a category's COMPLETE rule for one channel — replace, never merge (D-6.1). Audited with its impact. */
export async function setCategoryRule(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: UserOpBase & RuleInput,
  deps: CatalogueTaxonomyDeps = {},
): Promise<RuleChangePreview & { category: CategoryNode; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.setAvailabilityRule' })
  const a = open(ctx, projectId, deps)
  let planned: { before: TaxonomyState; after: CategoryTree; summary: { before: RuleSummary; after: RuleSummary } } | null = null
  const r = await write(a, {
    op: 'categoryRule',
    mode: 'user',
    rev: input?.rev,
    baseHashes: input?.baseHashes,
    plan: (s) => {
      const p = planRule(s, input)
      planned = { before: s, after: p.after, summary: { before: ruleSummary(p.before), after: ruleSummary(p.rule) } }
      if (JSON.stringify(p.before ?? null) === JSON.stringify(p.rule ?? null)) return { value: p.node.key }
      return { value: p.node.key, categories: p.rows }
    },
  })
  const p = planned! as { before: TaxonomyState; after: CategoryTree; summary: { before: RuleSummary; after: RuleSummary } }
  const impact = await ruleImpact(a, p.before, p.after)
  if (r.transactionId) await audit(a, 'category.rule_changed', r.transactionId, r.value, { categoryKey: r.value, channel: input.channel, ...p.summary, impact })
  return { ...p.summary, impact, category: r.state.tree.nodes.get(r.value)!, rev: await revAfter(a, r) }
}

// ── Categories: usage, deletion preview, delete, reassign ────────────────────

export type CategoryUsage = { key: string; blockers: DeletionBlocker[]; route: DeletionRoute }
export type DeletionOptions = {
  /** Items move here; null = the category is removed from them (the first additional becomes primary). Required when items use it. */
  reassignTo?: string | null
  /** Children move here ('parent' = the deleted category's parent; null = top level). Required when it has children. */
  promoteChildrenTo?: string | null | 'parent'
}
export type DeletionPreview = CategoryUsage & { plan: CategoryDeletionPlanResult | null }
type CategoryDeletionPlanResult = ReturnType<typeof planCategoryDeletion>

/** Usage per Tom's "unused" (D-3), recomputed server-side from every registered source, drafts included. */
export async function categoryUsage(ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueTaxonomyDeps = {}): Promise<CategoryUsage> {
  assertCatalogueCapabilities(ctx, projectId, ['catalogue.item.read'])
  const key = keyOrFail(input?.key)
  const a = open(ctx, projectId, deps)
  const s = await readState(a)
  const blockers = deletionBlockers(s.tree, key, await gatherCategoryReferences(a.projectSlug, key, referenceSources(a, s)))
  return { key, blockers, route: deletionRoute(blockers) }
}

/** Either category permission opens deletion (D-3); checked before any I/O. Returns whether setup.manage is held. */
function assertCanDelete(ctx: TenantAuthorizationContext, projectId: string): boolean {
  const manage = holdsCatalogueCapability(ctx, projectId, 'catalogue.setup.manage')
  if (!manage) assertCatalogueOperation(ctx, projectId, { op: 'term.deleteUnusedLeaf' })
  return manage
}

/** Counted preview (nothing written): blockers, who may delete, and the cleanup steps for the chosen targets. */
export async function previewCategoryDeletion(ctx: TenantAuthorizationContext, projectId: string, input: { key: string } & DeletionOptions, deps: CatalogueTaxonomyDeps = {}): Promise<DeletionPreview> {
  assertCanDelete(ctx, projectId)
  const key = keyOrFail(input?.key)
  const a = open(ctx, projectId, deps)
  const s = await readState(a)
  const refs = await gatherCategoryReferences(a.projectSlug, key, referenceSources(a, s))
  const blockers = deletionBlockers(s.tree, key, refs)
  const plan = blockers.length > 0 && s.tree.nodes.has(key) ? planCategoryDeletion(s.tree, key, refs, { reassignTo: input.reassignTo ?? null, promoteChildrenTo: input.promoteChildrenTo ?? 'parent' }) : null
  return { key, blockers, route: deletionRoute(blockers), plan }
}

/** Reassigns (or, with `to` null, removes) `from` on every item document carrying it — chunked ≤ 100, idempotent, drafts included, new shape written + legacy `categories` unset (C10-6 R2). */
async function reassignItems(a: Access, s: TaxonomyState, from: string, to: string | null): Promise<number> {
  const rows = (await readItemTerms(a, s)).filter((r) => {
    const asg = itemCategoryAssignment(r)
    return asg.primary === from || asg.additional.includes(from)
  })
  const items = rows.map((r) => ({ id: r._id, assignment: itemCategoryAssignment(r) }))
  const plan = to === null ? planUnassign(items, from) : planReassign(items, from, to)
  const revOf = new Map(rows.map((r) => [r._id, r._rev]))
  let changed = 0
  for (let i = 0; i < plan.length; i += REASSIGN_CHUNK) {
    const chunk = plan.slice(i, i + REASSIGN_CHUNK)
    const tx = a.client.transaction()
    for (const { id, next } of chunk) {
      const p = assignmentPatch(next)
      const rev = revOf.get(id)
      tx.patch(id, { ...(rev && { ifRevisionID: rev }), set: p.set, unset: p.unset })
    }
    try {
      await span('sanity.reassignItems', () => tx.commit({ transactionId: txId(a, 'reassignItems') }))
    } catch (error) {
      // An item changed meanwhile: the state stays valid (some items on `to`, node still present); running again is safe.
      fail(isConflict(error) ? 'category_conflict' : 'category_failed', 'Some items changed meanwhile. Try again.')
    }
    changed += chunk.length
  }
  return changed
}

/**
 * The final step, one guarded patch: re-count every source just before writing (P-20), move the
 * children (validateMove, one by one on the evolving tree) and remove the node. Only children may
 * remain at this point; anything else refuses and nothing is deleted. Retried on a revision conflict.
 */
async function guardedDelete(a: Access, key: string, sources: readonly CategoryReferenceSource[], manage: boolean, promote: string | null | 'parent', opName: string) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const s = await readState(a)
    if (!s.tree.nodes.has(key)) return { deleted: false, childrenMoved: 0, target: null as string | null, transactionId: null as string | null }
    const blockers = deletionBlockers(s.tree, key, await gatherCategoryReferences(a.projectSlug, key, sources))
    const remaining = blockers.filter((b) => b.code !== 'has_children')
    if (blockers.length > 0 && !manage) fail('category_setup_required', 'Deleting a category that is in use needs Catalogue Setup.', { capability: 'catalogue.setup.manage', blockers })
    if (remaining.length > 0) fail('category_referenced', 'This category is still in use.', { blockers: remaining })
    let rows = s.categoryRows
    let tree = s.tree
    const target = promote === 'parent' ? (s.tree.parentOf.get(key) ?? null) : promote
    const children = [...(s.tree.childrenOf.get(key) ?? [])]
    for (const child of children) {
      const move = validateMove(tree, { key: child, newParentKey: target })
      if (!move.ok) fail(move.code as CatalogueTaxonomyErrorCode, 'Its subcategories cannot move there.', { key: child })
      if (move.ok) rows = applyMovePatches(rows, move.patches)
      tree = buildTree(readCategoryNodes(rows))
    }
    rows = removeRow(rows, key)
    const transactionId = txId(a, opName)
    try {
      await span('sanity.commit', () => a.client.transaction().patch(a.id, { ifRevisionID: s.rev, set: { categories: rows, updatedAt: now(a), updatedBy: a.ctx.userId } }).commit({ transactionId }))
      return { deleted: true, childrenMoved: children.length, target, transactionId }
    } catch (error) {
      if (!isConflict(error)) fail('category_failed', 'Could not save.')
    }
  }
  return conflict(await readState(a), {})
}

export type DeleteCategoryResult = { key: string; deleted: boolean; reassigned: number; childrenMoved: number; rev: string }

/**
 * Deletes a category (D-3). A genuinely unreferenced LEAF needs `catalogue.taxonomy.write`;
 * anything with blockers needs `catalogue.setup.manage` AND an explicit, counted plan
 * (`reassignTo`, `promoteChildrenTo`; see previewCategoryDeletion): items are reassigned in
 * chunks, cleanable sources run, a recount must be clean, then ONE guarded patch moves the
 * children and removes the node. An absent key is a no-op (idempotent). `rev`, when given,
 * must be the one the caller loaded.
 */
export async function deleteCategory(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { key: string; rev?: string } & DeletionOptions,
  deps: CatalogueTaxonomyDeps = {},
): Promise<DeleteCategoryResult> {
  return runDelete(ctx, projectId, input, deps, 'delete')
}

/** "Merge": every item of `from` moves to `to`, its children move (default: to its parent), then `from` is deleted. setup.manage. */
export async function reassignCategory(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { from: string; to: string; promoteChildrenTo?: string | null | 'parent'; rev?: string },
  deps: CatalogueTaxonomyDeps = {},
): Promise<DeleteCategoryResult> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.reassign' })
  if (!isValidTermKey(input?.to) || input.to === input.from) fail('invalid_input', 'Choose another category.', { field: 'to' })
  return runDelete(ctx, projectId, { key: input.from, reassignTo: input.to, promoteChildrenTo: input.promoteChildrenTo ?? 'parent', rev: input.rev }, deps, 'reassign')
}

async function runDelete(ctx: TenantAuthorizationContext, projectId: string, input: { key: string; rev?: string } & DeletionOptions, deps: CatalogueTaxonomyDeps, op: 'delete' | 'reassign'): Promise<DeleteCategoryResult> {
  const manage = assertCanDelete(ctx, projectId)
  const key = keyOrFail(input?.key)
  const a = open(ctx, projectId, deps)
  await singleProject(a)
  const s0 = await readState(a)
  if (typeof input.rev === 'string' && input.rev !== s0.rev) conflict(s0, {})
  if (!s0.tree.nodes.has(key)) return { key, deleted: false, reassigned: 0, childrenMoved: 0, rev: s0.rev }
  await ensureDocument(a)

  const sources = referenceSources(a, s0)
  const refs = await gatherCategoryReferences(a.projectSlug, key, sources)
  const blockers = deletionBlockers(s0.tree, key, refs)
  const route = deletionRoute(blockers)
  let reassigned = 0
  if (route.capability === 'setup.manage') {
    if (!manage) fail('category_setup_required', 'Deleting a category that is in use needs Catalogue Setup.', { capability: 'catalogue.setup.manage', blockers })
    if (!route.resolvable) fail('category_cleanup_unresolvable', 'Some references must be edited first.', { blockers })
    const itemBlockers = blockers.filter((b) => b.code === 'used_as_primary' || b.code === 'used_as_additional')
    if (itemBlockers.length > 0 && input.reassignTo === undefined) fail('category_in_use', 'Choose where its items go.', { blockers, count: itemBlockers.reduce((n, b) => n + b.count, 0) })
    if (blockers.some((b) => b.code === 'has_children') && input.promoteChildrenTo === undefined) fail('category_has_children', 'Choose where its subcategories go.', { blockers })
    const plan = planCategoryDeletion(s0.tree, key, refs, { reassignTo: input.reassignTo ?? null, promoteChildrenTo: input.promoteChildrenTo ?? 'parent' })
    if (!plan.ok) fail(plan.code, 'This deletion cannot be planned.', { blockers: plan.blockers })
    if (input.reassignTo && s0.tree.nodes.get(input.reassignTo)?.archivedAt) fail('category_archived_target', 'That category is archived.', { key: input.reassignTo })
    if (itemBlockers.length > 0) reassigned = await reassignItems(a, s0, key, input.reassignTo ?? null)
    for (const src of sources) {
      if (src.cleanup && (refs[src.id]?.hit.count ?? 0) > 0) await src.cleanup.apply(a.projectSlug, key, input.reassignTo ?? null)
    }
  }

  const done = await guardedDelete(a, key, sources, manage, input.promoteChildrenTo ?? 'parent', op === 'reassign' ? 'reassignCategory' : 'deleteCategory')
  if (done.deleted && route.capability === 'setup.manage') {
    await audit(a, 'category.restructured', done.transactionId, key, {
      op,
      categoryKey: key,
      ...(done.childrenMoved > 0 && { toParent: done.target }),
      ...(input.reassignTo && { reassignedTo: input.reassignTo }),
      impact: { items: reassigned },
    })
  }
  return { key, deleted: done.deleted, reassigned, childrenMoved: done.childrenMoved, rev: await currentRev(a) }
}

// ── Tags (taxonomy.write — tags carry no availability and no structure) ──────

export type TagResult = { tag: TagNode; rev: string }

export async function createTag(ctx: TenantAuthorizationContext, projectId: string, input: { labels: Record<string, string> }, deps: CatalogueTaxonomyDeps = {}): Promise<TagResult & { created: boolean }> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.create' })
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'createTag',
    mode: 'idempotent',
    plan: (s) => {
      const labels = labelsOrFail({}, input?.labels, s.site, 'tag')
      const def = labels[s.site.defaultLocale]
      const twin = s.tags.find((t) => !t.archivedAt && foldLabel(t.label[s.site.defaultLocale] ?? '') === foldLabel(def))
      if (twin) return { value: { key: twin.key, created: false } }
      if (s.tags.length >= MAX_TAGS) fail('tag_limit', `At most ${MAX_TAGS} tags.`)
      const key = deriveTermKey(def, s.tags.map((t) => t.key))
      const order = (s.tags.reduce((m, t) => Math.max(m, Number.isFinite(t.order) ? t.order : 0), 0) || 0) + ORDER_STEP
      return { value: { key, created: true }, tags: [...s.tagRows, newTagRow(key, labels, order)] }
    },
  })
  return { tag: r.state.tags.find((t) => t.key === r.value.key)!, created: r.value.created, rev: await revAfter(a, r) }
}

const foldLabel = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

export async function updateTag(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: UserOpBase & { key: string; labels: Record<string, string | null>; nextKey?: string },
  deps: CatalogueTaxonomyDeps = {},
): Promise<TagResult> {
  assertCatalogueOperation(ctx, projectId, [{ op: 'term.rename' }, { op: 'term.translate' }])
  if (input?.nextKey !== undefined && input.nextKey !== input.key) fail('tag_key_immutable', 'A tag key never changes.')
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'renameTag',
    mode: 'user',
    rev: input?.rev,
    baseHashes: input?.baseHashes,
    conflictCode: 'tag_conflict',
    plan: (s) => {
      const tag = tagOrFail(s, input.key)
      const labels = labelsOrFail(tag.label, input.labels, s.site, 'tag')
      if (JSON.stringify(labels) === JSON.stringify(tag.label)) return { value: tag.key }
      return { value: tag.key, tags: updateRows(s.tagRows, tag.key, { label: { _type: 'localizedString', ...labels } }) }
    },
  })
  return { tag: r.state.tags.find((t) => t.key === r.value)!, rev: await revAfter(a, r) }
}

export async function reorderTags(ctx: TenantAuthorizationContext, projectId: string, input: UserOpBase & { keys: string[] }, deps: CatalogueTaxonomyDeps = {}): Promise<{ order: { key: string; order: number }[]; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.reorder' })
  if (!input || !Array.isArray(input.keys) || new Set(input.keys).size !== input.keys.length || !input.keys.every(isValidTermKey)) fail('invalid_input', 'Invalid order.', { field: 'keys' })
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'reorderTags',
    mode: 'user',
    rev: input.rev,
    baseHashes: input.baseHashes,
    conflictCode: 'tag_conflict',
    plan: (s) => {
      const keys = s.tags.map((t) => t.key)
      if (input.keys.some((k) => !keys.includes(k))) fail('tag_unknown', 'Unknown tag.')
      const order = [...input.keys, ...keys.filter((k) => !input.keys.includes(k))].map((key, i) => ({ key, order: (i + 1) * ORDER_STEP }))
      const changed = order.filter((o) => s.tags.find((t) => t.key === o.key)!.order !== o.order)
      if (changed.length === 0) return { value: order }
      let rows = s.tagRows
      for (const o of changed) rows = updateRows(rows, o.key, { order: o.order })
      return { value: order, tags: rows }
    },
  })
  return { order: r.value, rev: await revAfter(a, r) }
}

async function setTagArchived(ctx: TenantAuthorizationContext, projectId: string, key: unknown, archived: boolean, deps: CatalogueTaxonomyDeps): Promise<TagResult> {
  assertCatalogueOperation(ctx, projectId, { op: archived ? 'term.archive' : 'term.unarchive', kind: 'tag' })
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: archived ? 'archiveTag' : 'unarchiveTag',
    mode: 'idempotent',
    plan: (s) => {
      const tag = tagOrFail(s, key)
      if (!!tag.archivedAt === archived) return { value: tag.key }
      return { value: tag.key, tags: updateRows(s.tagRows, tag.key, { archivedAt: archived ? now(a) : undefined }) }
    },
  })
  return { tag: r.state.tags.find((t) => t.key === r.value)!, rev: await revAfter(a, r) }
}
export const archiveTag = (ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueTaxonomyDeps = {}) => setTagArchived(ctx, projectId, input?.key, true, deps)
export const unarchiveTag = (ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueTaxonomyDeps = {}) => setTagArchived(ctx, projectId, input?.key, false, deps)

/** Deletes an UNUSED tag (no item carries it, drafts included); otherwise `tag_in_use` with the count and first items. Absent key = no-op. */
export async function deleteTag(ctx: TenantAuthorizationContext, projectId: string, input: { key: string }, deps: CatalogueTaxonomyDeps = {}): Promise<{ key: string; deleted: boolean; rev: string }> {
  assertCatalogueOperation(ctx, projectId, { op: 'term.deleteUnusedLeaf' })
  if (!isValidTermKey(input?.key)) fail('tag_unknown', 'Unknown tag.')
  const key = input.key
  const a = open(ctx, projectId, deps)
  let usage: { count: number; sample: CategoryRef[] } = { count: 0, sample: [] }
  const before = await readState(a)
  if (before.tags.some((t) => t.key === key)) usage = tagUsage(await readItemTerms(a, before), key)
  if (usage.count > 0) fail('tag_in_use', 'This tag is still used.', { count: usage.count, sample: usage.sample })
  const r = await write(a, {
    op: 'deleteTag',
    mode: 'idempotent',
    plan: (s) => (s.tags.some((t) => t.key === key) ? { value: true, tags: removeRow(s.tagRows, key) } : { value: false }),
  })
  return { key, deleted: r.value, rev: await revAfter(a, r) }
}

function tagUsage(rows: readonly ItemTermRow[], key: string): { count: number; sample: CategoryRef[] } {
  const seen = new Map<string, CategoryRef>()
  for (const r of rows) {
    if (!Array.isArray(r.tags) || !r.tags.includes(key)) continue
    const id = baseId(r._id)
    if (!seen.has(id)) seen.set(id, { id, type: 'catalogueItem', name: typeof r.name === 'string' ? r.name : '' })
  }
  return { count: seen.size, sample: [...seen.values()].slice(0, IN_USE_SAMPLE_LIMIT) }
}

/** Test seam: re-export for fixtures that drive the forbidden path structurally. */
export { CatalogueForbidden }

// ── For the settings service (channels): the tree, and pruning a removed channel's rules ──

/** The project's category tree (availability inputs for channel impact). Needs `catalogue.item.read`. */
export async function readCategoryTree(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueTaxonomyDeps = {}): Promise<CategoryTree> {
  assertCatalogueCapabilities(ctx, projectId, ['catalogue.item.read'])
  return (await readState(open(ctx, projectId, deps))).tree
}

/** How many category rule rows name `channel` (counted cleanup preview, C2 I-C2-2). */
export function categoryRulesNaming(tree: CategoryTree, channel: string): number {
  let n = 0
  for (const node of tree.nodes.values()) if (node.channelRules[asChannelKey(channel)]) n++
  return n
}

/**
 * Channel removal cleanup (C2 I-C2-2, `setup.channels`): removes every category rule row of
 * `channel` in one guarded patch, so the taxonomy document keeps its single writer. Idempotent.
 */
export async function pruneChannelFromCategories(ctx: TenantAuthorizationContext, projectId: string, channel: string, deps: CatalogueTaxonomyDeps = {}): Promise<{ removed: number }> {
  assertCatalogueOperation(ctx, projectId, { op: 'setup.channels' })
  const a = open(ctx, projectId, deps)
  const r = await write(a, {
    op: 'pruneChannelRules',
    mode: 'idempotent',
    plan: (s) => {
      const keys = [...s.tree.nodes.values()].filter((n) => n.channelRules[asChannelKey(channel)]).map((n) => n.key)
      if (keys.length === 0) return { value: 0 }
      let rows = s.categoryRows
      for (const k of keys) rows = setRuleOnRows(rows, k, channel, null)
      return { value: keys.length, categories: rows }
    },
  })
  return { removed: r.value }
}
