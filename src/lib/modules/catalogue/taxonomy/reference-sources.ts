// ── Category reference sources (contract C1.7, "Reference-source registry") ──
//
// "What stored Catalogue data points at this category key?" is answered by
// REGISTERED sources, so later slices (automatic listings, publication
// standards, availability policies, …) add theirs in the slice that adds the
// field, without touching deletionBlockers. The registry-completeness test
// (`refs/registry-complete`) fails when a schema field stores a category key
// that no registered source covers.
//
// This file is pure apart from the `find` closures of the built-in item
// sources, which take an injected fetch (server-side, tenant-scoped client).

import { IN_USE_SAMPLE_LIMIT } from './limits'
import type { CategoryKey, CategoryRef, CategoryReferenceHit, CategoryReferenceSource, CategoryReferences } from './types'

const SOURCES: CategoryReferenceSource[] = []
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Registers a source; throws on a duplicate or malformed id. Registration order is blocker order. */
export function registerCategoryReferenceSource(source: CategoryReferenceSource): void {
  if (!ID_PATTERN.test(source.id)) throw new Error(`registerCategoryReferenceSource: invalid id "${source.id}"`)
  if (SOURCES.some((s) => s.id === source.id)) throw new Error(`registerCategoryReferenceSource: duplicate id "${source.id}"`)
  SOURCES.push(source)
}

/** The registered sources, in registration order. */
export function categoryReferenceSources(): readonly CategoryReferenceSource[] {
  return [...SOURCES]
}

/** Test helper: drop every source registered after the built-in ones. */
export function resetCategoryReferenceSourcesForTest(keep: readonly string[] = []): void {
  for (let i = SOURCES.length - 1; i >= 0; i--) if (!keep.includes(SOURCES[i].id)) SOURCES.splice(i, 1)
}

/** Every (type, field) that a registered source covers. */
export function coveredCategoryKeyFields(sources: readonly CategoryReferenceSource[] = SOURCES): { type: string; field: string }[] {
  return sources.flatMap((s) => s.stores.map((x) => ({ ...x })))
}

/** Gathers one hit per source (the service's input to deletionBlockers / planCategoryDeletion). */
export async function gatherCategoryReferences(
  projectSlug: string,
  key: CategoryKey,
  sources: readonly CategoryReferenceSource[] = SOURCES,
): Promise<CategoryReferences> {
  const out: Record<string, CategoryReferences[string]> = {}
  for (const source of sources) {
    const hit = await source.find(projectSlug, key)
    out[source.id] = { source: { id: source.id, kind: source.kind, cleanable: !!source.cleanup }, hit }
  }
  return out
}

// ── built-in: catalogue items ────────────────────────────────────────────────
// C1.7: "Today only `items` exists (kinds item_primary / item_additional)". A hit
// carries one count, so the item source is registered as two sources sharing one
// query — `items-primary` and `items-additional` — which keeps deletionBlockers
// generic (one blocker per source). The legacy `categories` list counts while it
// exists (R1: items without the new fields read their first category as primary).

/** The fields of `catalogueItem` that store category keys. */
export const ITEM_CATEGORY_KEY_FIELDS = ['primaryCategory', 'additionalCategories', 'categories'] as const

const NO_NEW_FIELDS = `!defined(primaryCategory) && !defined(additionalCategories)`

/** Draft-including (raw perspective), `versions.**` excluded; one row per document copy. */
export const ITEM_CATEGORY_REFERENCES_QUERY = /* groq */ `*[_type == "catalogueItem" && projectSlug == $projectSlug && !(_id in path("versions.**")) && (
  primaryCategory == $key || $key in additionalCategories || (${NO_NEW_FIELDS} && $key in categories)
)]{ _id, "name": coalesce(name[$locale], name[$defaultLocale], name.en, ""), primaryCategory, additionalCategories, categories }`

type ItemRefRow = { _id: string; name?: unknown; primaryCategory?: unknown; additionalCategories?: unknown; categories?: unknown }
export type ItemReferenceFetch = (query: string, params: Record<string, unknown>) => Promise<ItemRefRow[] | null>

/** Per role, distinct LOGICAL items (a draft + published copy count once). Pure; exported for tests. */
export function itemReferenceHits(rows: readonly ItemRefRow[], key: CategoryKey): { primary: CategoryReferenceHit; additional: CategoryReferenceHit } {
  const primary = new Map<string, CategoryRef>()
  const additional = new Map<string, CategoryRef>()
  for (const r of rows ?? []) {
    if (!r || typeof r._id !== 'string') continue
    const id = r._id.startsWith('drafts.') ? r._id.slice('drafts.'.length) : r._id
    const ref: CategoryRef = { id, type: 'catalogueItem', name: typeof r.name === 'string' ? r.name : '' }
    const hasNew = r.primaryCategory != null || r.additionalCategories != null
    const legacy = Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : []
    const isPrimary = hasNew ? r.primaryCategory === key : legacy[0] === key
    const isAdditional = hasNew ? Array.isArray(r.additionalCategories) && r.additionalCategories.includes(key) : legacy.slice(1).includes(key)
    if (isPrimary && !primary.has(id)) primary.set(id, ref)
    else if (isAdditional && !primary.has(id) && !additional.has(id)) additional.set(id, ref)
  }
  // An item counted as primary in one copy is not also counted as additional.
  for (const id of primary.keys()) additional.delete(id)
  const hit = (m: Map<string, CategoryRef>): CategoryReferenceHit => ({ count: m.size, sample: [...m.values()].slice(0, IN_USE_SAMPLE_LIMIT) })
  return { primary: hit(primary), additional: hit(additional) }
}

/**
 * The two item sources for one fetcher (the R2 service registers them with its
 * tenant-scoped client). Cleanup of items is the service's own reassignment
 * (planReassign, R2), not a source `cleanup`; deletionBlockers treats the item
 * kinds as cleanable regardless.
 */
export function itemCategoryReferenceSources(fetch: ItemReferenceFetch, ctx: { locale: string; defaultLocale: string }): [CategoryReferenceSource, CategoryReferenceSource] {
  const stores = ITEM_CATEGORY_KEY_FIELDS.map((field) => ({ type: 'catalogueItem', field }))
  const read = async (projectSlug: string, key: CategoryKey) =>
    itemReferenceHits((await fetch(ITEM_CATEGORY_REFERENCES_QUERY, { projectSlug, key, locale: ctx.locale, defaultLocale: ctx.defaultLocale })) ?? [], key)
  return [
    { id: 'items-primary', kind: 'item_primary', stores, find: async (p, k) => (await read(p, k)).primary },
    { id: 'items-additional', kind: 'item_additional', stores, find: async (p, k) => (await read(p, k)).additional },
  ]
}
