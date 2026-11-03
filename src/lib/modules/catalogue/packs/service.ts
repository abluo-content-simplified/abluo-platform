/**
 * Catalogue pack service — preview and apply starter packs (contract C7.4–C7.7). Server-only.
 *
 * Every operation, in this order:
 *   1. `assertCatalogueOperation(ctx, projectId, { op: 'setup.applyPack' })` (= catalogue.setup.manage)
 *      before ANY read (fixture apply/permission).
 *   2. One project-scoped raw read of everything `planPack` needs (`readPackState`).
 *   3. apply: re-plan from fresh state; a different fingerprint than the preview the person
 *      confirmed → `pack_plan_changed` with the new plan, zero writes ("exact preview").
 *   4. ONE Sanity transaction (fast path) with a deterministic transaction id
 *      `abluo-pack-<sha1(project|id|version|fingerprint)>`: the taxonomy patch (rows from the
 *      taxonomy write model — CatalogueTaxonomyService's own pure builders, never a second
 *      shape), draft collections / option lists (createIfNotExists, deterministic ids), the
 *      Catalogue config keys (the settings service's key-level patch, incl. setup completion
 *      D-14) and the history entry. The taxonomy document, the project document and the history
 *      document are all revision-guarded (C-10). History exists iff everything exists.
 *   5. A lost response (timeout, duplicate transaction id) is verified by re-reading: the entry
 *      `<id>@<version>` exists ⇒ ok, once. A revision conflict ⇒ `pack_conflict` + fresh plan.
 *   6. C12 audit after the commit: `pack.applied` (or `pack.updated`); an interrupted chunked run
 *      records `pack.interrupted`. Content-free.
 */
import { createHash } from 'node:crypto'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient, type TenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { assertCatalogueOperation, CatalogueForbidden } from '@/lib/api/catalogue-capability-guard'
import { pageFirstSegments, type PageSlugRow } from '@/lib/modules/config-validators'
import { span } from '@/lib/perf/timing'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { catalogueTransactionId } from '@/lib/sanity/studio/catalogue-posture'
import { auditEntry, type CatalogueAuditEntry, type CatalogueAuditKind, type CatalogueAuditPayload } from '../audit/events'
import { recordCatalogueActivity, type CatalogueAuditWriter } from '../audit/writer'
import { CATEGORY_RULES, availabilityInputsOf } from '../commerce/channel-availability'
import { channelSetOf, readChannels } from '../commerce/channels'
import { migrationPending } from '../migration-markers'
import { availabilityImpact, type AvailabilityImpact } from '../commerce/impact'
import { isItemProfile } from '../profiles'
import { configKeysPatch } from '../settings/service'
import { availabilityItemsOf, ITEM_AVAILABILITY_QUERY, type ItemAvailabilityRow } from '../taxonomy/availability-items'
import { catalogueTaxonomyId, readCategoryNodes, readTagNodes } from '../taxonomy/read'
import { seedTaxonomyFromTerms } from '../taxonomy/seed'
import { TERM_RECORDS_QUERY } from '../taxonomy/service'
import { buildTree } from '../taxonomy/tree'
import type { CategoryNode } from '../taxonomy/types'
import type { StoredRow } from '../taxonomy/write-model'
import { buildPackMutations, PACK_RUN_TYPE, packRunId, type PackMutation } from './apply'
import { packHistoryId, PACK_HISTORY_TYPE, readPackHistory } from './history'
import { historyKeyOf, isBlocked, packUpdateOffers, planPack, planPackUpdate, type CatalogueState, type ExistsAs, type PackPlan, type PackSelection, type PackUpdateOffer } from './plan'
import { getPack, listPacks } from './registry'
import type { AppliedPackAdded, AppliedPackRecord, PackDeclaration, PackHistoryEntry, PackId } from './types'

export type PackErrorCode = 'project_draft_exists' | 'pack_unknown' | 'pack_forbidden' | 'pack_already_applied' | 'pack_blocked' | 'pack_plan_changed' | 'pack_conflict' | 'pack_interrupted' | 'pack_failed' | 'catalogue_not_installed'

type Client = Pick<typeof sanityWriteClient, 'fetch' | 'transaction'>
export type PackServiceDeps = { client?: Client; now?: () => Date; audit?: CatalogueAuditWriter }

const RAW = { perspective: 'raw' } as const

export const PACK_STATE_QUERY = /* groq */ `{
  "site": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales },
  "project": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ _id, _rev, "hasDraft": count(*[_id == "drafts." + ^._id]) > 0, "inst": moduleInstallations[moduleId == "catalogue"][0]{ _key, enabled, config, appliedPreset } },
  "taxonomy": *[_type == "catalogueTaxonomy" && _id == $taxonomyId && projectSlug == $projectSlug][0]{ _id, _rev, categories, tags },
  "history": *[_type == "${PACK_HISTORY_TYPE}" && _id == $historyId && projectSlug == $projectSlug][0]{ _id, _rev, applied },
  "runs": *[_type == "${PACK_RUN_TYPE}" && projectSlug == $projectSlug]{ _id, _rev, packId, packVersion, status, journal },
  "collections": *[_type == "catalogueCollection" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, _rev, name, slug, "sectionKeys": sections[]._key, "full": select(_id match "catalogue-collection.*" || _id match "drafts.catalogue-collection.*" => @) },
  "items": *[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**")) && defined(slug)]{ _id, slug },
  "legacyOfferItems": count(*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**")) && count(offers) > 0 && !(count(formats) > 0)]),
  "optionLists": *[_type == "catalogueOptionList" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, name },
  "pages": *[_type == "page" && projectSlug == $projectSlug]{ _id, slug }
}`

type RawState = {
  site?: { defaultLocale?: string | null; supportedLocales?: string[] | null } | null
  project?: { _id: string; _rev: string; hasDraft?: boolean | null; inst?: { _key?: string | null; enabled?: boolean | null; config?: Record<string, unknown> | null; appliedPreset?: unknown } | null } | null
  taxonomy?: { _id: string; _rev: string; categories?: unknown; tags?: unknown } | null
  history?: { _id: string; _rev: string; applied?: unknown } | null
  runs?: { _id: string; _rev?: string; packId?: string; packVersion?: number; status?: string; journal?: Partial<AppliedPackAdded> }[] | null
  collections?: { _id: string; _rev?: string; name?: unknown; slug?: unknown; sectionKeys?: (string | null)[] | null; full?: Record<string, unknown> | null }[] | null
  items?: { _id: string; slug?: unknown }[] | null
  /** Items (drafts included) still carrying legacy offers without formats — data step D2's work left. */
  legacyOfferItems?: number | null
  optionLists?: { _id: string; name?: unknown }[] | null
  pages?: PageSlugRow[] | null
}

type Access = { ctx: TenantAuthorizationContext; projectId: string; projectSlug: string; client: Client; scoped: TenantScopedSanityClient; deps: PackServiceDeps }

function open(ctx: TenantAuthorizationContext, projectId: string, deps: PackServiceDeps): Access {
  assertCatalogueOperation(ctx, projectId, { op: 'setup.applyPack' })
  const client = deps.client ?? sanityWriteClient
  const scoped = tenantScopedSanityClient(ctx, projectId, { fetch: <T>(q: string, p?: Record<string, unknown>) => client.fetch(q, p ?? {}, RAW) as Promise<T> })
  return { ctx, projectId, projectSlug: scoped.projectSlug, client, scoped, deps }
}

const strMap = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => !k.startsWith('_') && k !== 'translationStatus' && typeof x === 'string' && x.trim())) as Record<string, string>) : {}
const slugsOf = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [l, s] of Object.entries(v as Record<string, unknown>)) if (!l.startsWith('_')) { const c = (s as { current?: unknown } | null)?.current; if (typeof c === 'string' && c) out[l] = c }
  return out
}
const baseId = (id: string) => id.replace(/^drafts\./, '')
const rows = (v: unknown): StoredRow[] => (Array.isArray(v) ? v.filter((r): r is StoredRow => !!r && typeof r === 'object') : [])

export type ReadPackState = { hasProjectDraft: boolean; state: CatalogueState; history: PackHistoryEntry[]; currency: string | null; runs: NonNullable<RawState['runs']>; otherCollections: { id: string; name: Record<string, string> }[]; project: { _id: string; inst: { _key?: string | null; config?: unknown } } }

/** Raw read → CatalogueState (pure; exported for tests). */
export function packStateOf(projectSlug: string, raw: RawState, seedTerms: unknown[] | null): ReadPackState {
  const inst = raw.project?.inst
  if (!raw.project || !inst || inst.enabled === false) throw new PackServiceError('catalogue_not_installed', 'The Catalogue is not installed.')
  const config = (inst.config ?? {}) as Record<string, unknown>
  const supported = raw.site?.supportedLocales?.length ? raw.site.supportedLocales : []
  const defaultLocale = raw.site?.defaultLocale || supported[0] || 'en'
  const locales = [defaultLocale, ...supported.filter((l) => l !== defaultLocale)]
  const seed = raw.taxonomy ? null : seedTaxonomyFromTerms((seedTerms ?? []) as never, (Array.isArray(config.categories) ? config.categories : []) as never)
  const categoryRows = raw.taxonomy ? rows(raw.taxonomy.categories) : (seed!.categories as unknown as StoredRow[])
  const tagRows = raw.taxonomy ? rows(raw.taxonomy.tags) : (seed!.tags as unknown as StoredRow[])
  const read = readChannels(config.serviceChannels).channels
  const history = readPackHistory({ applied: raw.history?.applied, appliedPreset: inst.appliedPreset })
  const collections = new Map<string, { id: string; exists: ExistsAs; name: Record<string, string>; slugs: Record<string, string>; sectionKeys: string[]; draft?: Record<string, unknown> | null; published?: Record<string, unknown> | null }>()
  for (const c of raw.collections ?? []) {
    const id = baseId(c._id)
    const draft = c._id.startsWith('drafts.')
    const prev = collections.get(id)
    const entry = prev ?? { id, exists: draft ? ('draft' as ExistsAs) : ('published' as ExistsAs), name: {}, slugs: {}, sectionKeys: [] }
    if (prev && prev.exists !== (draft ? 'draft' : 'published')) entry.exists = 'both'
    if (draft || !prev) {
      entry.name = strMap(c.name)
      entry.slugs = slugsOf(c.slug)
      entry.sectionKeys = (c.sectionKeys ?? []).filter((k): k is string => typeof k === 'string')
    }
    if (c.full) entry[draft ? 'draft' : 'published'] = c.full
    collections.set(id, entry)
  }
  const takenSlugs = [...(raw.items ?? []), ...(raw.collections ?? [])].flatMap((d) => Object.entries(slugsOf(d.slug)).map(([locale, slug]) => ({ locale, slug, id: baseId(d._id) })))
  const optionLists = new Map<string, { id: string; exists: ExistsAs; name: Record<string, string> }>()
  for (const l of raw.optionLists ?? []) {
    const id = baseId(l._id)
    const prev = optionLists.get(id)
    optionLists.set(id, { id, exists: prev ? 'both' : l._id.startsWith('drafts.') ? 'draft' : 'published', name: strMap(l.name) })
  }
  const templates = Array.isArray(config.formatTemplates) ? (config.formatTemplates as Record<string, unknown>[]) : []
  const state: CatalogueState = {
    projectSlug,
    defaultLocale,
    locales,
    categories: readCategoryNodes(categoryRows),
    tags: readTagNodes(tagRows),
    channels: read.all,
    // Stored channels predate C2, or data step D2 has not run (migrationPending): no channel is added.
    channelsUnmigrated: read.unmigrated || migrationPending(config, 'commerce', { unconvertedOfferItems: raw.legacyOfferItems ?? 0 }),
    settings: {
      setupCompletedAt: typeof config.setupCompletedAt === 'string' && config.setupCompletedAt ? config.setupCompletedAt : null,
      publicSegment: typeof config.publicSegment === 'string' && config.publicSegment ? config.publicSegment : null,
      publicSegmentHistory: Array.isArray(config.publicSegmentHistory) ? (config.publicSegmentHistory as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      // A legacy `navLabel` (data step D4 not run) is the current name: a pack never proposes overwriting it.
      publicName: Object.keys(strMap(config.publicName)).length ? strMap(config.publicName) : strMap(config.navLabel),
      defaultItemProfile: isItemProfile(config.defaultItemProfile) ? config.defaultItemProfile : null,
    },
    collections: [...collections.values()].map(({ draft: _d, published: _p, ...c }) => (void _d, void _p, c)),
    takenSlugs,
    optionLists: [...optionLists.values()],
    formatTemplates: templates.flatMap((t) => (t && typeof t.key === 'string' ? [{ key: t.key, label: strMap(t.label) }] : [])),
    pageFirstSegments: pageFirstSegments(raw.pages ?? []),
    history,
    revisions: { project: raw.project._rev, taxonomy: raw.taxonomy?._rev ?? '', history: raw.history?._rev ?? '' },
    raw: {
      categories: categoryRows,
      tags: tagRows,
      serviceChannels: Array.isArray(config.serviceChannels) ? config.serviceChannels : [],
      formatTemplates: templates,
      collections: Object.fromEntries([...collections.values()].filter((c) => c.draft || c.published).map((c) => [c.id, { draft: c.draft ?? null, published: c.published ?? null }])),
    },
  }
  const packCollectionIds = new Set(listPacks().flatMap((p) => p.collections.map((c) => `catalogue-collection.${projectSlug}.${c.key.replace(/_/g, '-')}`)))
  return {
    hasProjectDraft: raw.project.hasDraft === true,
    state,
    history,
    currency: typeof config.currency === 'string' ? config.currency : null,
    runs: raw.runs ?? [],
    project: { _id: raw.project._id, inst: { _key: inst._key ?? null, config: inst.config ?? null } },
    otherCollections: state.collections.filter((c) => !packCollectionIds.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
  }
}

export class PackServiceError extends Error {
  constructor(
    readonly code: PackErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PackServiceError'
  }
}

async function readPackState(a: Access): Promise<ReadPackState> {
  const raw = await span('sanity.readPackState', () => a.scoped.fetch<RawState>(PACK_STATE_QUERY, { taxonomyId: catalogueTaxonomyId(a.projectSlug), historyId: packHistoryId(a.projectSlug) }))
  const terms = raw?.taxonomy ? null : await span('sanity.readTerms', () => a.scoped.fetch<unknown[] | null>(TERM_RECORDS_QUERY))
  const grant = a.ctx.projects.find((p) => p.projectId === a.projectId)!
  if (!grant.enabledModuleIds.includes('catalogue')) throw new PackServiceError('catalogue_not_installed', 'The Catalogue is not installed.')
  return packStateOf(a.projectSlug, raw ?? {}, terms)
}

// ── Impact (C5-6): what activating the ticked channels and the new category rules changes for EXISTING items ──

async function impactOf(a: Access, state: CatalogueState, plan: PackPlan): Promise<AvailabilityImpact> {
  const before = channelSetOf(state.channels)
  const addedChannels = plan.add.filter((i) => i.area === 'channelSuggestion' && i.channel)
  const after = channelSetOf([
    ...state.channels,
    ...addedChannels.map((i) => ({ key: i.key as never, label: i.label as Record<string, string>, active: true, defaultAvailability: i.channel!.defaultAvailability, defaultSchedule: i.channel!.defaultSchedule, entryKey: null, explicitDefault: true })),
  ])
  const treeBefore = buildTree([...state.categories])
  const newNodes: CategoryNode[] = plan.add.filter((i) => i.area === 'category').map((i, n) => ({ key: i.key, label: i.label as Record<string, string>, parentKey: i.parentKey ?? null, order: 1_000_000 + n, channelRules: Object.fromEntries((i.rules ?? []).map((r) => [r.channel, r.rule])), defaultOptionListIds: [], archivedAt: null }))
  const treeAfter = buildTree([...state.categories, ...newNodes])
  const rowsRead = (await span('sanity.readItemAvailability', () => a.scoped.fetch<ItemAvailabilityRow[] | null>(ITEM_AVAILABILITY_QUERY))) ?? []
  const items = availabilityItemsOf(rowsRead, treeBefore, before)
  return availabilityImpact(availabilityInputsOf(before, { tree: treeBefore, category: CATEGORY_RULES }), availabilityInputsOf(after, { tree: treeAfter, category: CATEGORY_RULES }), items)
}

// ── Views ─────────────────────────────────────────────────────────────────────

export type PackSummary = { id: PackId; version: number; empty: boolean; counts: { categories: number; tags: number; collections: number; channels: number; formats: number; optionGroups: number } }
export type StarterStructuresView = {
  defaultLocale: string
  locales: string[]
  packs: PackSummary[]
  history: { key: string; id: string; version: number; appliedAt: string; legacy: boolean; added: AppliedPackAdded }[]
  offers: PackUpdateOffer[]
  setupCompletedAt: string | null
  currency: string | null
  interrupted: { packId: string; version: number }[]
}

const summaryOf = (p: PackDeclaration): PackSummary => ({
  id: p.id,
  version: p.version,
  empty: !!p.empty,
  counts: { categories: p.categories.length, tags: p.tags.length, collections: p.collections.length, channels: p.channels.length, formats: p.formatSuggestions.length, optionGroups: p.optionGroups.length },
})

export async function loadStarterStructures(ctx: TenantAuthorizationContext, projectId: string, deps: PackServiceDeps = {}): Promise<StarterStructuresView> {
  const a = open(ctx, projectId, deps)
  const r = await readPackState(a)
  return {
    defaultLocale: r.state.defaultLocale,
    locales: [...r.state.locales],
    packs: listPacks().map(summaryOf),
    history: r.history.map((h) => ({ key: h._key, id: h.id, version: h.version, appliedAt: h.appliedAt, legacy: h.source === 'legacyPreset', added: h.added })),
    offers: packUpdateOffers(r.history, listPacks()),
    setupCompletedAt: r.state.settings.setupCompletedAt,
    currency: r.currency,
    interrupted: r.runs.filter((x) => x.status === 'running' && typeof x.packId === 'string').map((x) => ({ packId: x.packId!, version: x.packVersion ?? 0 })),
  }
}

export type PackPreview = {
  plan: PackPlan & { removedByTenant?: PackPlan['add']; noLongerInPack?: PackPlan['add']; from?: number }
  impact: AvailabilityImpact
  /** Read-only in the preview (C7.8): a pack never changes it. */
  currency: string | null
  otherCollections: { id: string; name: Record<string, string> }[]
  existing: { categories: { key: string; label: Record<string, string> }[]; tags: { key: string; label: Record<string, string> }[] }
}

function planFor(r: ReadPackState, pack: PackDeclaration, selection: PackSelection | undefined, update: boolean) {
  if (!update) return planPack(r.state, pack, selection)
  const applied = [...r.history].filter((h) => h.id === pack.id).sort((x, y) => y.version - x.version)[0]
  if (!applied) return planPack(r.state, pack, selection)
  return planPackUpdate(r.state, applied, null, pack, selection)
}

/** The exact preview (nothing written). `update: true` = the optional update to a newer version (C7.6). */
export async function previewPack(ctx: TenantAuthorizationContext, projectId: string, input: { packId: string; selection?: PackSelection; update?: boolean }, deps: PackServiceDeps = {}): Promise<PackPreview> {
  const a = open(ctx, projectId, deps)
  const pack = getPack(input?.packId)
  if (!pack) throw new PackServiceError('pack_unknown', 'Unknown starter structure.')
  const r = await readPackState(a)
  const plan = planFor(r, pack, input.selection, !!input.update)
  return {
    plan,
    impact: await impactOf(a, r.state, plan),
    currency: r.currency,
    otherCollections: r.otherCollections,
    existing: { categories: r.state.categories.map((c) => ({ key: c.key, label: c.label })), tags: r.state.tags.map((t) => ({ key: t.key, label: t.label })) },
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export type ApplyPackResult = { ok: true; record: AppliedPackRecord; plan: PackPlan } | { ok: false; code: PackErrorCode; plan?: PackPlan; detail?: unknown }

const isConflict = (e: unknown): boolean => {
  const x = e as { statusCode?: number; response?: { statusCode?: number }; message?: string } | null
  return x?.statusCode === 409 || x?.response?.statusCode === 409 || /revision|already exists/i.test(String(x?.message ?? ''))
}

/** Converts the builder's abstract mutations onto a Sanity transaction. */
function addToTransaction(tx: ReturnType<Client['transaction']>, m: PackMutation, project: { _id: string; inst: { _key?: string | null; config?: unknown } }): void {
  if (m.kind === 'create') tx.create(m.doc)
  else if (m.kind === 'createIfNotExists') tx.createIfNotExists(m.doc)
  else if (m.kind === 'delete') tx.delete(m.id)
  else if (m.kind === 'config') {
    const patch = configKeysPatch(project.inst, !!project.inst.config, m.set, [])
    tx.patch(project._id, { ifRevisionID: m.ifRevisionID, set: patch.set })
  } else tx.patch(m.id, { ...(m.ifRevisionID && { ifRevisionID: m.ifRevisionID }), ...(m.setIfMissing && { setIfMissing: m.setIfMissing }), ...(m.set && { set: m.set }), ...(m.insert && { insert: { after: m.insert.after, items: m.insert.items } }) } as never)
}

async function audit<K extends CatalogueAuditKind>(a: Access, kind: K, transactionId: string | null, targetId: string, detail: CatalogueAuditPayload[K]): Promise<void> {
  const entry: CatalogueAuditEntry = auditEntry(kind, { projectId: a.projectId, targetId, actor: { kind: 'user', id: a.ctx.userId, support: !!a.ctx.support }, ...(transactionId && { transactionId }), detail })
  try {
    await (a.deps.audit ?? ((e: CatalogueAuditEntry) => recordCatalogueActivity(e)))(entry)
  } catch {
    /* never breaks the action */
  }
}

const count = (plan: PackPlan, area: string) => plan.add.filter((i) => i.area === area).length

/**
 * Applies a pack exactly as previewed. `planFingerprint` is the fingerprint of the preview the
 * person confirmed. Retry-safe: a retry replans (what exists is equivalent), so nothing is added
 * twice; history is recorded only in the transaction that completes the content.
 */
export async function applyPack(
  ctx: TenantAuthorizationContext,
  projectId: string,
  req: { packId: string; version: number; selection: PackSelection; planFingerprint: string; update?: boolean },
  deps: PackServiceDeps = {},
): Promise<ApplyPackResult> {
  let a: Access
  try {
    a = open(ctx, projectId, deps)
  } catch (error) {
    if (error instanceof CatalogueForbidden) return { ok: false, code: 'pack_forbidden' }
    throw error
  }
  const pack = getPack(req?.packId)
  if (!pack || pack.version !== req.version) return { ok: false, code: 'pack_unknown' }
  await span('sanity.assertSingleProject', () => assertSingleSanityProject((q, p) => a.client.fetch(q, p), a.projectSlug))
  const r = await readPackState(a)
  const plan = planFor(r, pack, req.selection, !!req.update)
  if (r.history.some((h) => h._key === historyKeyOf(pack))) return { ok: false, code: 'pack_already_applied', plan }
  if (plan.fingerprint !== req.planFingerprint) return { ok: false, code: 'pack_plan_changed', plan }
  if (isBlocked(plan)) return { ok: false, code: 'pack_blocked', plan }
  // An open Studio draft of the project document would overwrite the pack's config on publish.
  if (r.hasProjectDraft) return { ok: false, code: 'project_draft_exists', plan }

  const now = (a.deps.now?.() ?? new Date()).toISOString()
  const run = r.runs.find((x) => x._id === packRunId(a.projectSlug, pack) && x.status === 'running')
  const journal = run?.journal ? ({ categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: [], ...run.journal } as AppliedPackAdded) : undefined
  const built = buildPackMutations(plan, pack, r.state, { now, userId: a.ctx.userId, setupSource: pack.empty ? 'empty' : 'pack' }, { journal, runExists: !!run })
  const hash = createHash('sha1').update(`${a.projectSlug}|${pack.id}|${pack.version}|${plan.fingerprint}`).digest('hex')
  const project = r.project

  for (let i = 0; i < built.chunks.length; i++) {
    const transactionId = catalogueTransactionId('pack', built.singleTransaction ? hash : `${hash.slice(0, 36)}-${i}`)
    const tx = a.client.transaction()
    for (const m of built.chunks[i]) addToTransaction(tx, m, project)
    try {
      await span('sanity.commitPack', () => tx.commit({ transactionId }))
    } catch (error) {
      // A lost response or a duplicate transaction id: did the first attempt commit?
      const fresh = await readPackState(a).catch(() => null)
      if (fresh?.history.some((h) => h._key === historyKeyOf(pack) && h.source === 'history')) return succeed(a, pack, plan, built.history, transactionId, r, !!req.update)
      if (!built.singleTransaction && i > 0) {
        await audit(a, 'pack.interrupted', transactionId, pack.id, { packId: pack.id, packVersion: pack.version, stage: `chunk-${i}`, resumable: true })
        return { ok: false, code: 'pack_interrupted', plan }
      }
      if (isConflict(error)) return { ok: false, code: 'pack_conflict', ...(fresh && { plan: planFor(fresh, pack, req.selection, !!req.update) }) }
      return { ok: false, code: 'pack_failed', plan }
    }
  }
  return succeed(a, pack, plan, built.history, catalogueTransactionId('pack', hash), r, !!req.update)
}

async function succeed(a: Access, pack: PackDeclaration, plan: PackPlan, record: AppliedPackRecord, transactionId: string, r: ReadPackState, update: boolean): Promise<ApplyPackResult> {
  const prior = r.history.filter((h) => h.id === pack.id).map((h) => h.version)
  if (update && prior.length) {
    const added: Record<string, number> = {}
    for (const [k, v] of Object.entries(record.added)) added[k] = v.length
    await audit(a, 'pack.updated', transactionId, pack.id, { packId: pack.id, fromVersion: Math.max(...prior), toVersion: pack.version, added })
  } else {
    await audit(a, 'pack.applied', transactionId, pack.id, {
      packId: pack.id,
      packVersion: pack.version,
      added: { categories: count(plan, 'category'), tags: count(plan, 'tag'), collections: count(plan, 'collection'), sections: count(plan, 'section'), formats: count(plan, 'formatSuggestion'), optionGroups: count(plan, 'optionGroup'), channelsSuggested: count(plan, 'channelSuggestion') },
      equivalentExisting: plan.equivalent.length,
      conflictsResolved: Object.keys(plan.mapped).length,
    })
  }
  return { ok: true, record, plan }
}
