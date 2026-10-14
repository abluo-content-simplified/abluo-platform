/**
 * Catalogue — the four ADR-032 lifecycle descriptors (ADR-033 D9, C1, C4;
 * spec §9). Thin: the lifecycle service does the work, this file says who may
 * (permissions), what the ids look like, and which other documents block an
 * archive or a permanent delete.
 *
 * ARCHIVE (ADR-033 D-8 table, unchanged from C7/D9):
 *   catalogueItem        catalogue.item.*        blocked by a PUBLIC collection or PUBLIC option list
 *   catalogueOptionList  catalogue.item.*        blocked by any non-archived item that attaches it
 *   catalogueCollection  catalogue.collection.*  blocked by a PUBLIC cataloguePage listing section
 *   cataloguePage        catalogue.collection.*  nothing refers to it
 * "Public" is the shared visibility fragment (ADR-032 D3), evaluated by GROQ
 * at the time of the check.
 *
 * PERMANENT DELETE (D-8): refused while ANY document references it — draft,
 * published, scheduled, unpublished or archived, strong or weak. This matches
 * what Sanity enforces for strong references; the check makes it a readable
 * answer. Every refusal NAMES (and the dashboard links) each referrer.
 *
 * PUBLISH (D-4/D-5): `references` names each document's outgoing lifecycle
 * references (collection → items; item → option lists; option list → linked
 * items; landing page → collections) for the service's publishTogether.
 *
 * Each descriptor is `connected: false` in spirit until Menu v1 ships; the
 * descriptor type has no such flag, and nothing here shares anything with a
 * Connection, so there is nothing to switch.
 */
import type { Doc, LifecycleClient, LifecycleDescriptor, LifecycleErrorCode, LifecycleRef, Referrer } from '@/lib/lifecycle/service'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { labelOf } from '@/lib/modules/catalogue/validation'

export const CATALOGUE_ITEM_WRITE_PERMISSION = 'catalogue.item.write'
export const CATALOGUE_ITEM_DELETE_PERMISSION = 'catalogue.item.delete'
export const CATALOGUE_ITEM_DELETE_PUBLISHED_PERMISSION = 'catalogue.item.deletePublished'
export const CATALOGUE_COLLECTION_WRITE_PERMISSION = 'catalogue.collection.write'
export const CATALOGUE_COLLECTION_DELETE_PERMISSION = 'catalogue.collection.delete'
export const CATALOGUE_COLLECTION_DELETE_PUBLISHED_PERMISSION = 'catalogue.collection.deletePublished'

export class CatalogueLifecycleError extends Error {
  /** The documents that block an `in_use` refusal (named by the service). */
  referrers?: Referrer[]
  /** The dependencies a publish refusal names (D-4/D-5). */
  dependencies?: Referrer[]
  constructor(
    readonly code: LifecycleErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CatalogueLifecycleError'
  }
}

const CATALOGUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
export const isCatalogueId = (id: unknown): id is string => typeof id === 'string' && CATALOGUE_ID.test(id)
const fail = (code: LifecycleErrorCode, message: string) => new CatalogueLifecycleError(code, message)

type Row = { _id: string; label?: unknown }
const RAW = { perspective: 'raw' } as const
const PUBLISHED_ONLY = '!(_id in path("drafts.**"))'

/** Rows → Referrers, one per document (a published row and its draft are one). */
function named(rows: readonly Row[] | null | undefined, type: string, fallback: string): Referrer[] {
  const seen = new Map<string, Referrer>()
  for (const r of rows ?? []) {
    const id = r._id.replace(/^drafts\./, '')
    if (!seen.has(id)) seen.set(id, { id, type, label: labelOf(r.label, fallback) })
  }
  return [...seen.values()]
}

// ── Queries (exported so tests assert exactly what runs) ─────────────────────

/** Public collections that list the item in any section. */
export const ITEM_COLLECTION_REFERRERS = `*[_type == "catalogueCollection" && projectSlug == $projectSlug && ${PUBLISHED_ONLY} && $id in sections[].items[]._ref && ${publicFilterFor('catalogueCollection')}]{ _id, "label": name }`
/** Public option lists with an option that is this item. */
export const ITEM_OPTION_LIST_REFERRERS = `*[_type == "catalogueOptionList" && projectSlug == $projectSlug && ${PUBLISHED_ONLY} && $id in options[].item._ref && ${publicFilterFor('catalogueOptionList')}]{ _id, "label": name }`
/** Non-archived items (published or draft-only) that attach the option list. */
export const OPTION_LIST_ITEM_REFERRERS = `*[_type == "catalogueItem" && projectSlug == $projectSlug && $id in optionLists[].list._ref && !defined(archivedAt)]{ _id, "label": name }`
/** Public landing pages whose listing section shows the collection. */
export const COLLECTION_PAGE_REFERRERS = `*[_type == "cataloguePage" && projectSlug == $projectSlug && ${PUBLISHED_ONLY} && $id in sections[_type == "catalogueListingSection"].collection._ref && ${publicFilterFor('cataloguePage')}]{ _id, "label": heroTitle }`
/**
 * D-8 — EVERY document of the project that references `$id` in any version
 * (draft, published, archived; strong or weak), except its own versions.
 * GROQ `references()` matches weak references too.
 */
export const DELETE_REFERRERS = `*[projectSlug == $projectSlug && references($id) && !(_id in [$id, $draftId]) && !(_id in path("versions.**"))]{ _id, _type, "label": coalesce(name, heroTitle) }`

const FALLBACK_LABEL: Record<string, string> = {
  catalogueItem: 'Untitled item',
  catalogueCollection: 'Untitled collection',
  catalogueOptionList: 'Untitled option list',
  cataloguePage: 'Catalogue page',
}

/** Every referrer, one per document (a draft and its published version are one), named. */
export async function deleteReferrers(client: LifecycleClient, id: string, projectSlug: string): Promise<Referrer[]> {
  const rows = await client.fetch<Array<Row & { _type?: string }> | null>(DELETE_REFERRERS, { id, draftId: `drafts.${id}`, projectSlug }, RAW)
  const seen = new Map<string, Referrer>()
  for (const r of rows ?? []) {
    const rid = r._id.replace(/^drafts\./, '')
    const type = typeof r._type === 'string' ? r._type : 'unknown'
    if (!seen.has(rid)) seen.set(rid, { id: rid, type, label: labelOf(r.label, FALLBACK_LABEL[type] ?? 'Untitled') })
  }
  return [...seen.values()]
}

// ── Outgoing references (publish, D-4/D-5) ───────────────────────────────────

const refIds = (values: unknown): string[] =>
  (Array.isArray(values) ? values : []).map((r) => (r as { _ref?: unknown } | null)?._ref).filter((r): r is string => typeof r === 'string' && r.length > 0)
const uniqueRefs = (ids: string[], type: string): LifecycleRef[] => [...new Set(ids)].map((id) => ({ id, type }))

export const catalogueReferences = {
  item: (doc: Doc) => uniqueRefs(refIds((Array.isArray(doc.optionLists) ? doc.optionLists : []).map((a) => (a as { list?: unknown } | null)?.list)), 'catalogueOptionList'),
  collection: (doc: Doc) => uniqueRefs((Array.isArray(doc.sections) ? doc.sections : []).flatMap((s) => refIds((s as { items?: unknown } | null)?.items)), 'catalogueItem'),
  optionList: (doc: Doc) => uniqueRefs(refIds((Array.isArray(doc.options) ? doc.options : []).map((o) => (o as { item?: unknown } | null)?.item)), 'catalogueItem'),
  page: (doc: Doc) =>
    uniqueRefs(
      refIds((Array.isArray(doc.sections) ? doc.sections : []).filter((x) => (x as { _type?: unknown } | null)?._type === 'catalogueListingSection').map((x) => (x as { collection?: unknown }).collection)),
      'catalogueCollection'
    ),
}

const nameLabel = (fallback: string) => (doc: Doc) => labelOf(doc.name, fallback)
const opensPage = (doc: Doc) => doc.hasPage === true

async function run(client: LifecycleClient, query: string, id: string, projectSlug: string, type: string, fallback: string): Promise<Referrer[]> {
  const rows = await client.fetch<Row[] | null>(query, { id, projectSlug }, RAW)
  return named(rows, type, fallback)
}

// ── Descriptors ──────────────────────────────────────────────────────────────

export const CATALOGUE_ITEM_LIFECYCLE: LifecycleDescriptor = {
  type: 'catalogueItem',
  rule: 'optional',
  permissions: {
    write: CATALOGUE_ITEM_WRITE_PERMISSION,
    delete: CATALOGUE_ITEM_DELETE_PERMISSION,
    deletePublished: CATALOGUE_ITEM_DELETE_PUBLISHED_PERMISSION,
  },
  isId: isCatalogueId,
  fail,
  refuseArchiveWhileReferenced: true,
  referrers: async (client, id, projectSlug) => [
    ...(await run(client, ITEM_COLLECTION_REFERRERS, id, projectSlug, 'catalogueCollection', 'Untitled collection')),
    ...(await run(client, ITEM_OPTION_LIST_REFERRERS, id, projectSlug, 'catalogueOptionList', 'Untitled option list')),
  ],
  deleteReferrers,
  references: catalogueReferences.item,
  label: nameLabel('Untitled item'),
  opensPage,
}

/** Option lists modify items and have no audience of their own: the item permissions (C4). */
export const CATALOGUE_OPTION_LIST_LIFECYCLE: LifecycleDescriptor = {
  type: 'catalogueOptionList',
  rule: 'optional',
  permissions: CATALOGUE_ITEM_LIFECYCLE.permissions,
  isId: isCatalogueId,
  fail,
  refuseArchiveWhileReferenced: true,
  referrers: (client, id, projectSlug) => run(client, OPTION_LIST_ITEM_REFERRERS, id, projectSlug, 'catalogueItem', 'Untitled item'),
  deleteReferrers,
  references: catalogueReferences.optionList,
  label: nameLabel('Untitled option list'),
}

export const CATALOGUE_COLLECTION_LIFECYCLE: LifecycleDescriptor = {
  type: 'catalogueCollection',
  rule: 'optional',
  permissions: {
    write: CATALOGUE_COLLECTION_WRITE_PERMISSION,
    delete: CATALOGUE_COLLECTION_DELETE_PERMISSION,
    deletePublished: CATALOGUE_COLLECTION_DELETE_PUBLISHED_PERMISSION,
  },
  isId: isCatalogueId,
  fail,
  refuseArchiveWhileReferenced: true,
  referrers: (client, id, projectSlug) => run(client, COLLECTION_PAGE_REFERRERS, id, projectSlug, 'cataloguePage', 'Catalogue page'),
  deleteReferrers,
  references: catalogueReferences.collection,
  label: nameLabel('Untitled collection'),
  opensPage,
}

/** The landing page (ADR-033 C1): nothing refers to it, so it has no dependency check. */
export const CATALOGUE_PAGE_LIFECYCLE: LifecycleDescriptor = {
  type: 'cataloguePage',
  rule: 'optional',
  permissions: CATALOGUE_COLLECTION_LIFECYCLE.permissions,
  isId: isCatalogueId,
  fail,
  references: catalogueReferences.page,
  label: (doc) => labelOf(doc.heroTitle, 'Catalogue page'),
}

export const CATALOGUE_LIFECYCLES = [
  CATALOGUE_ITEM_LIFECYCLE,
  CATALOGUE_COLLECTION_LIFECYCLE,
  CATALOGUE_OPTION_LIST_LIFECYCLE,
  CATALOGUE_PAGE_LIFECYCLE,
] as const
