/**
 * Catalogue — the four ADR-032 lifecycle descriptors (ADR-033 D9, C1, C4;
 * spec §9). Thin: the lifecycle service does the work, this file says who may
 * (permissions), what the ids look like, and which other documents block an
 * archive or a permanent delete.
 *
 *   catalogueItem        catalogue.item.*        blocked by a PUBLIC collection or PUBLIC option list
 *   catalogueOptionList  catalogue.item.*        blocked by any non-archived item that attaches it
 *   catalogueCollection  catalogue.collection.*  blocked by a PUBLIC cataloguePage listing section
 *   cataloguePage        catalogue.collection.*  nothing refers to it
 *
 * "Public" is the shared visibility fragment (ADR-032 D3), evaluated by GROQ
 * at the time of the check; drafts and archived referrers do not block (the
 * Gallery rule, ADR-032 D13). Every refusal NAMES its referrers (service
 * `referrers`), on archive as well as on permanent delete.
 *
 * Each descriptor is `connected: false` in spirit until Menu v1 ships; the
 * descriptor type has no such flag, and nothing here shares anything with a
 * Connection, so there is nothing to switch.
 */
import type { LifecycleClient, LifecycleDescriptor, LifecycleErrorCode, Referrer } from '@/lib/lifecycle/service'
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
}

/** The landing page (ADR-033 C1): nothing refers to it, so it has no dependency check. */
export const CATALOGUE_PAGE_LIFECYCLE: LifecycleDescriptor = {
  type: 'cataloguePage',
  rule: 'optional',
  permissions: CATALOGUE_COLLECTION_LIFECYCLE.permissions,
  isId: isCatalogueId,
  fail,
}

export const CATALOGUE_LIFECYCLES = [
  CATALOGUE_ITEM_LIFECYCLE,
  CATALOGUE_COLLECTION_LIFECYCLE,
  CATALOGUE_OPTION_LIST_LIFECYCLE,
  CATALOGUE_PAGE_LIFECYCLE,
] as const
