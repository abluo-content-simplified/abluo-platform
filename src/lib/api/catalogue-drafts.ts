/**
 * Client dashboard — the Catalogue module (ADR-033; spec §10–§12).
 *
 * Items, collections and option lists, on the same model as galleries and
 * posts: edits go to a DRAFT (`drafts.<id>`) and only Publish changes the
 * website. Lifecycle operations (unpublish, archive, restore, delete) go
 * through the one ADR-032 service with the catalogue descriptors
 * (`catalogue-lifecycle.ts`), whose refusals NAME the blocking documents.
 *
 * Enforcement (as gallery-drafts / event-drafts), on every call:
 *   1. `assertModuleAction(ctx, projectId, <permission>)` BEFORE any I/O — so a
 *      viewer is refused server-side on every write (AC 5/6). Items and option
 *      lists use catalogue.item.*, collections catalogue.collection.* (C4).
 *      Identity (`_id`, `_type`, `projectSlug`) comes from the GRANT.
 *   2. Ids are safe document ids; documents are re-read before every mutation
 *      and must be this kind of this project — anything else is "not_found".
 *   3. Patches pass `cleanCatalogueSet()` (allowlist, languages, limits,
 *      rebuilt arrays); referenced photos must be published media of this
 *      project; referenced items / option lists must be documents of this
 *      project — a never-published one is referenced WEAKLY, marked to
 *      strengthen on publish (ADR-033 D-4); slugs are unique across items AND
 *      collections (D11) and a clash names the other document; a slug needs a
 *      name in its language (D-7).
 *   5. Publishing goes through the lifecycle service's `publishTogether`
 *      (ADR-032 Amendment B): a single publish is refused while the document
 *      references never-published content (naming each), "Publish … and
 *      dependencies" publishes the whole tree in one transaction (D-5), and
 *      every reference of a published copy is strengthened explicitly.
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards → "conflict". Opaque error codes (CatalogueErrorCode).
 *
 * Never written here: `offer.currency` (D7/A6) and `offer.locationKey` (A5).
 */
import { span } from '@/lib/perf/timing'
import { approvedShops, awinPublisherIdOf } from '@/lib/affiliate/affiliate-settings'
import type { AffiliateShopId } from '@/lib/affiliate/shops'
import { isAmazonMarketplace, type AmazonTrackingId } from '@/lib/affiliate/amazon-marketplaces'
import { resolveAmazonShortLink, type ResolveFetch } from '@/lib/affiliate/amazon-resolve'
import { randomUUID } from 'crypto'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { DRAFT_SAVE } from '@/lib/sanity/draft-save'
import { readsInOrder } from '@/lib/api/parallel-reads'
import { audited, type ContentAuditWriter } from '@/lib/lifecycle/audit'
import { deriveStatus, type LifecycleState } from '@/lib/lifecycle/status'
import * as lifecycle from '@/lib/lifecycle/service'
import type { LifecycleDescriptor } from '@/lib/lifecycle/service'
import { coverThumbUrl } from '@/lib/api/post-drafts'
import { containThumbUrl, publicPageUrl } from '@/lib/modules/catalogue/list-model'
import {
  CATALOGUE_COLLECTION_LIFECYCLE,
  CATALOGUE_ITEM_LIFECYCLE,
  CATALOGUE_OPTION_LIST_LIFECYCLE,
  CATALOGUE_LIFECYCLES,
  CatalogueLifecycleError,
  isCatalogueId,
} from '@/lib/api/catalogue-lifecycle'
import type { Referrer } from '@/lib/lifecycle/service'
import { isPublishableDeclaration, unreviewedChoices } from '@/lib/modules/catalogue/allergens'
import {
  CATALOGUE_LIMITS,
  CATALOGUE_TYPE,
  CatalogueError,
  assertAllowedPaths,
  cleanCatalogueSet,
  slugsForPublish,
  slugLocalesWithoutName,
  type CatalogueKind,
} from '@/lib/modules/catalogue/dashboard-patch'
import { initialItemProfile, type ItemProfile } from '@/lib/modules/catalogue/dashboard-form'
import { can, isItemProfile, profileOf } from '@/lib/modules/catalogue/profiles'
import { catalogueCategoryVocabulary, tagVocabulary, type CategoryTermRow } from '@/lib/taxonomy/vocabulary'
import { SLUG_NAMESPACE_QUERY, namedSlugConflicts, toSlugOwners, type NamedSlugConflict, type SlugRow } from '@/lib/modules/catalogue/validation'
import {
  CATALOGUE_COUNT_QUERY,
  CATALOGUE_DASHBOARD_LIST_QUERY,
  CATALOGUE_GLANCE_QUERY,
  CATALOGUE_MEDIA_EXIST_QUERY,
  CATALOGUE_NAV_LABEL_QUERY,
  CATALOGUE_FOOD_USERS_COUNT_QUERY,
  CATALOGUE_OPTION_LIST_CHOICES_QUERY,
  CATALOGUE_REF_TARGETS_QUERY,
  CATALOGUE_REUSE_COUNT_QUERY,
  CATALOGUE_SITE_QUERY,
  CATALOGUE_THUMBS_QUERY,
} from '@/lib/modules/catalogue/dashboard-queries'

export { CatalogueError } from '@/lib/modules/catalogue/dashboard-patch'
export type { CatalogueErrorCode, CatalogueKind } from '@/lib/modules/catalogue/dashboard-patch'

export const CATALOGUE_READ_PERMISSION = 'catalogue.item.read'

type Perms = { write: string; delete: string; deletePublished: string }
const DESCRIPTOR: Record<CatalogueKind, LifecycleDescriptor> = {
  item: CATALOGUE_ITEM_LIFECYCLE,
  collection: CATALOGUE_COLLECTION_LIFECYCLE,
  optionList: CATALOGUE_OPTION_LIST_LIFECYCLE,
}
export const catalogueKindPermissions = (kind: CatalogueKind): Perms => DESCRIPTOR[kind].permissions

/** What this grant may do per kind (UI hint; the server re-checks every call). */
export function catalogueAbilities(grant: { permissions: readonly string[] }) {
  const has = (p: string) => grant.permissions.includes(p)
  const of = (kind: CatalogueKind) => {
    const p = DESCRIPTOR[kind].permissions
    return { write: has(p.write), delete: has(p.delete), deletePublished: has(p.delete) && has(p.deletePublished) }
  }
  return { item: of('item'), collection: of('collection'), optionList: of('optionList') }
}
export type CatalogueAbilities = ReturnType<typeof catalogueAbilities>

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type CatalogueDeps = { client?: Client; now?: () => Date; uuid?: () => string; audit?: ContentAuditWriter }
type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])
/** Lifecycle fields live on the published version only (ADR-032): never copied from a draft on publish. */
const LIFECYCLE_FIELDS = new Set(['publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
const MAX_SCHEDULE_MS = 2 * 366 * 24 * 60 * 60 * 1000
const RAW = { perspective: 'raw' } as const

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

const notFound = (): never => {
  throw new CatalogueError('not_found', 'Unknown catalogue document.')
}

async function readPair(client: Client, kind: CatalogueKind, id: string, projectSlug: string) {
  const [published, draft] = (await span('sanity.readPair', () => Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)]))) as [Doc | undefined, Doc | undefined]
  const ours = (d: Doc | undefined) => !d || (d._type === CATALOGUE_TYPE[kind] && d.projectSlug === projectSlug)
  if (!ours(published) || !ours(draft)) notFound()
  return { published, draft }
}

/** The single-project guard as a promise, so it can run alongside the pre-write reads. */
const singleProjectGuard = (client: Client, projectSlug: string) =>
  span('sanity.assertSingleProject', () => assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug))

/**
 * Runs one mutation behind the single-project guard. `guard` is that check
 * already started (alongside the reads); it is awaited — and must pass — before
 * the mutation is sent, exactly as when it ran inline.
 */
async function commit(client: Client, projectSlug: string, run: () => Promise<unknown>, guard?: Promise<void>): Promise<unknown> {
  await (guard ?? singleProjectGuard(client, projectSlug))
  try {
    return await span('sanity.commit', run)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new CatalogueError('conflict', 'This was changed elsewhere.')
    throw new CatalogueError('failed', 'Could not save.')
  }
}

const newKey = () => randomUUID().replace(/-/g, '').slice(0, 12)

export function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v
  return out
}
const pick = (value: unknown, locale: string) => {
  const v = localized(value)
  return v[locale] ?? Object.values(v)[0] ?? ''
}
const slugMap = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const c = (v as { current?: unknown } | null)?.current
    if (!k.startsWith('_') && typeof c === 'string' && c) out[k] = c
  }
  return out
}

// ── Site + module configuration ──────────────────────────────────────────────

export type CatalogueTerm = { value: string; label: Record<string, string>; color: string | null }
export type CatalogueSite = {
  defaultLocale: string
  locales: string[]
  /** IANA zone of the site, or null (the dashboard falls back to the viewer's). */
  timeZone: string | null
  translate: boolean
  /** The starter preset the catalogue was set up from (e.g. 'bookshop'), or null. */
  presetId?: string | null
  /** The project's Amazon tracking IDs (Settings), for the buy-link preview. Empty when none. */
  amazonTrackingIds?: AmazonTrackingId[]
  /** Awin publisher ID (digits) from Settings, or null — the buy-link preview for Awin shops. */
  awinPublisherId?: string | null
  /** Shops the tenant ticked as approved, in their order (Settings). */
  affiliateShops?: { shop: AffiliateShopId }[]
  config: {
    navLabel: Record<string, string>
    segment: string | null
    currency: string
    channels: CatalogueTerm[]
    categories: CatalogueTerm[]
    tags: CatalogueTerm[]
    dietaryTags: CatalogueTerm[]
    /** D-2: the profile the item wizard preselects (module setting, e.g. from a starter preset); null = none. */
    defaultItemProfile: ItemProfile | null
  }
}

type RawConfig = Record<string, unknown> | null | undefined
const termsOf = (rows: unknown): CatalogueTerm[] =>
  (Array.isArray(rows) ? rows : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { value?: unknown }).value === 'string' && !!(r as { value: string }).value)
    .map((r) => ({ value: r.value as string, label: localized(r.label), color: typeof r.color === 'string' && r.color ? r.color : null }))

async function readSite(client: Client, projectSlug: string): Promise<CatalogueSite> {
  const r = await span('sanity.readSite', () => client.fetch<{ site?: { defaultLocale?: string | null; supportedLocales?: string[] | null; timeZone?: string | null; amazonTrackingIds?: { marketplace?: unknown; trackingId?: unknown }[] | null; awinPublisherId?: unknown; affiliateShops?: { shop?: unknown }[] | null } | null; config?: RawConfig; presetId?: unknown; translate?: boolean; categoryTerms?: CategoryTermRow[] | null; tagTerms?: CategoryTermRow[] | null } | null>(
    CATALOGUE_SITE_QUERY,
    { projectSlug }
  ))
  const supported = r?.site?.supportedLocales?.length ? r.site.supportedLocales : []
  const defaultLocale = r?.site?.defaultLocale || supported[0]
  if (!defaultLocale) throw new CatalogueError('failed', 'Site languages are not configured.')
  const c = (r?.config ?? {}) as Record<string, unknown>
  const currency = typeof c.currency === 'string' && /^[A-Za-z]{3}$/.test(c.currency) ? c.currency.toUpperCase() : 'EUR'
  return {
    defaultLocale,
    locales: [defaultLocale, ...supported.filter((l) => l !== defaultLocale)],
    timeZone: typeof r?.site?.timeZone === 'string' && r.site.timeZone ? r.site.timeZone : null,
    amazonTrackingIds: (r?.site?.amazonTrackingIds ?? []).flatMap((x) => (x && isAmazonMarketplace(x.marketplace) && typeof x.trackingId === 'string' && x.trackingId.trim() ? [{ marketplace: x.marketplace, trackingId: x.trackingId.trim() }] : [])),
    awinPublisherId: awinPublisherIdOf({ awinPublisherId: r?.site?.awinPublisherId }),
    affiliateShops: approvedShops({ affiliateShops: r?.site?.affiliateShops }).map((shop) => ({ shop })),
    translate: r?.translate === true,
    presetId: typeof r?.presetId === 'string' && r.presetId ? r.presetId : null,
    config: {
      navLabel: localized(c.navLabel),
      segment: typeof c.publicSegment === 'string' && c.publicSegment ? c.publicSegment : null,
      currency,
      channels: termsOf(c.serviceChannels),
      // ADR-033 Amendment J (dual-read): term records replace the config list entirely when the project has any.
      categories: termsOf(catalogueCategoryVocabulary(r?.categoryTerms, c.categories)),
      // Slice 7: tag term records only (no config list).
      tags: termsOf(tagVocabulary(r?.tagTerms)),
      dietaryTags: termsOf(c.dietaryTags),
      defaultItemProfile: initialItemProfile(c.defaultItemProfile),
    },
  }
}

/** Languages, zone and the module's vocabularies — for every catalogue screen. */
export async function getCatalogueSite(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueDeps = {}): Promise<CatalogueSite> {
  const grant = grantFor(ctx, projectId, CATALOGUE_READ_PERMISSION)
  return readSite(deps.client ?? sanityWriteClient, grant.projectSlug)
}

/**
 * Amazon app links (amzn.eu/d/…) cannot be read without a request: this follows the redirects
 * (Amazon hosts only, strict timeout, no cookies) and returns the product URL, or null. The caller
 * needs the right to edit items. Nothing is stored here.
 */
export async function resolveAmazonLink(ctx: TenantAuthorizationContext, projectId: string, url: unknown, deps: { fetch?: ResolveFetch } = {}): Promise<{ url: string | null }> {
  grantFor(ctx, projectId, catalogueKindPermissions('item').write)
  if (typeof url !== 'string' || url.length > 2048) return { url: null }
  const r = await resolveAmazonShortLink(url, { fetch: deps.fetch })
  return { url: r.ok ? r.url : null }
}

/**
 * The dashboard's name for the module in the reader's language (ADR-033 D12),
 * or null → the messages default. Presentation only; never an identifier.
 * Never throws: a missing label must not break the shell.
 */
export async function loadCatalogueNavLabel(projectSlug: string, locale: string, deps: CatalogueDeps = {}): Promise<string | null> {
  try {
    const raw = await (deps.client ?? sanityWriteClient).fetch<unknown>(CATALOGUE_NAV_LABEL_QUERY, { projectSlug })
    const v = localized(raw)
    return v[locale]?.trim() || null
  } catch {
    return null
  }
}

// ── Lists ─────────────────────────────────────────────────────────────────────

type RowBase = { _id: string; _rev?: string; slug?: unknown; _createdAt?: string; _updatedAt?: string; name?: unknown; publishedAt?: unknown; expiresAt?: unknown; archivedAt?: unknown }
type ItemRow = RowBase & { byline?: unknown; bookAuthor?: unknown; bookYear?: unknown; itemProfile?: unknown; allergenStatus?: unknown; categories?: unknown; hasPage?: unknown; visibility?: unknown; imageCount?: number | null; firstImage?: string | null; offerCount?: number | null; prices?: unknown; lists?: unknown }
type CollectionRow = RowBase & { sectionNames?: unknown; collectionType?: unknown; hasPage?: unknown; visibility?: unknown; sectionCount?: number | null; itemRefs?: unknown }
type OptionListRow = RowBase & { optionCount?: number | null }

type Common = {
  id: string
  name: string
  names: Record<string, string>
  status: LifecycleState
  /** Never published: only `drafts.<id>` exists. */
  isPublished: boolean
  hasDraft: boolean
  updatedAt: string
  createdAt: string
  /** The draft's revision when a draft exists (what a publish is guarded on), else ''. */
  draftRev: string
  /** "Publish on" — the live version's publish date (ISO), null when never published. */
  publishedAt: string | null
  /** "Unpublish on" — the live version's end date (ISO), null when none. */
  expiresAt: string | null
  /** Absolute public URL in the default language, only when it resolves right now (list-model publicPageUrl); else null. */
  publicUrl: string | null
}
export type CatalogueItemListRow = Common & {
  /** null when not set yet (Studio-created). */
  itemProfile: ItemProfile | null
  /** Localized byline (author, maker …); empty when none. */
  byline: Record<string, string>
  /** Slice 4d: book details for the list line ("author · year"); null when not set. */
  bookAuthor: string | null
  bookYear: number | null
  /** D-3: a food item whose allergens are not reviewed yet (cannot be published). */
  allergensNotReviewed: boolean
  categories: string[]
  hasPage: boolean
  thumb: string | null
  imageCount: number
  offerCount: number
  /** Lowest price, for the list (in the project currency). */
  fromPrice: number | null
  optionLists: string[]
}
export type CatalogueCollectionListRow = Common & { collectionType: 'menu' | 'list'; hasPage: boolean; sectionCount: number; itemCount: number; /** Section names (localized), in order. */ sectionNames: Record<string, string>[] }
export type CatalogueOptionListRow = Common & { optionCount: number; usedBy: number }
export type CatalogueLists = { items: CatalogueItemListRow[]; collections: CatalogueCollectionListRow[]; optionLists: CatalogueOptionListRow[] }

/** One entry per document: the draft's content when there is one, the status from the published version. */
function pairUp<T extends RowBase>(rows: readonly T[] | null | undefined) {
  const map = new Map<string, { row: T; published: T | null; hasDraft: boolean; createdAt: string }>()
  for (const row of rows ?? []) {
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice(7) : row._id
    if (!isCatalogueId(id)) continue
    const e = map.get(id) ?? { row, published: null, hasDraft: false, createdAt: '' }
    if (row._createdAt && (!e.createdAt || row._createdAt < e.createdAt)) e.createdAt = row._createdAt
    if (isDraft) {
      e.row = row
      e.hasDraft = true
    } else {
      e.published = row
      if (!e.hasDraft) e.row = row
    }
    map.set(id, e)
  }
  return map
}

type PublicBase = { domain: string | null; pathBase: string | null; segment: string | null; defaultLocale: string }

function common(id: string, e: { row: RowBase; published: RowBase | null; hasDraft: boolean; createdAt: string }, locale: string, now: Date, pub?: PublicBase): Common {
  const status = deriveStatus({ published: e.published as never, draft: e.hasDraft ? e.row : null, rule: 'optional' }, now)
  const iso = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const live = e.published as (RowBase & { hasPage?: unknown; visibility?: unknown }) | null
  return {
    draftRev: e.hasDraft ? (e.row._rev ?? '') : '',
    publishedAt: iso(live?.publishedAt),
    expiresAt: iso(live?.expiresAt),
    publicUrl:
      pub && live
        ? publicPageUrl({ status: status.status, hasPage: live.hasPage === true, visibility: live.visibility, slug: slugMap(live.slug)[pub.defaultLocale], segment: pub.segment, domain: pub.domain, pathBase: pub.pathBase, defaultLocale: pub.defaultLocale })
        : null,
    id,
    name: pick(e.row.name, locale),
    names: localized(e.row.name),
    status,
    isPublished: Boolean(e.published),
    hasDraft: e.hasDraft,
    updatedAt: e.row._updatedAt ?? '',
    createdAt: e.createdAt || e.row._updatedAt || '',
  }
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Everything the catalogue screen lists, every state (archived included — the UI hides it from "All"). */
export async function listCatalogue(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueDeps & { /** The project's public domain; without it no "View on website" link is built. */ publicDomain?: string | null; /** On a path-served platform host (dev/preview): `https://<host>/<project>`; wins over the domain. */ publicPathBase?: string | null } = {}): Promise<CatalogueLists> {
  const grant = grantFor(ctx, projectId, CATALOGUE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const now = (deps.now ?? (() => new Date()))()
  const [site, raw] = await Promise.all([
    readSite(client, grant.projectSlug),
    client.fetch<{ items?: ItemRow[]; collections?: CollectionRow[]; optionLists?: OptionListRow[] } | null>(CATALOGUE_DASHBOARD_LIST_QUERY, { projectSlug: grant.projectSlug }, RAW),
  ])
  const d = site.defaultLocale
  const pub: PublicBase = { domain: deps.publicDomain ?? null, pathBase: deps.publicPathBase ?? null, segment: site.config.segment, defaultLocale: d }
  const items = pairUp(raw?.items)
  const firsts = [...new Set([...items.values()].map((e) => e.row.firstImage).filter((x): x is string => typeof x === 'string'))]
  const thumbs = firsts.length
    ? await client.fetch<Array<{ _id: string; url?: string | null; hotspot?: { x?: number; y?: number } | null }> | null>(CATALOGUE_THUMBS_QUERY, { projectSlug: grant.projectSlug, ids: firsts })
    : []
  const thumbById = new Map((thumbs ?? []).map((a) => [a._id, containThumbUrl(a.url, 720)]))
  const itemRows: CatalogueItemListRow[] = [...items].map(([id, e]) => {
    const prices = (Array.isArray(e.row.prices) ? e.row.prices : []).filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
    return {
      ...common(id, e, d, now, pub),
      byline: localized(e.row.byline),
      bookAuthor: typeof e.row.bookAuthor === 'string' && e.row.bookAuthor.trim() ? e.row.bookAuthor.trim() : null,
      bookYear: typeof e.row.bookYear === 'number' && Number.isInteger(e.row.bookYear) ? e.row.bookYear : null,
      itemProfile: isItemProfile(e.row.itemProfile) ? e.row.itemProfile : null,
      allergensNotReviewed: can(profileOf(e.row.itemProfile), 'foodInformation') && e.row.allergenStatus !== 'containsListedAllergens' && e.row.allergenStatus !== 'noneDeclared',
      categories: strings(e.row.categories),
      hasPage: e.row.hasPage === true,
      thumb: typeof e.row.firstImage === 'string' ? (thumbById.get(e.row.firstImage) ?? null) : null,
      imageCount: typeof e.row.imageCount === 'number' ? e.row.imageCount : 0,
      offerCount: typeof e.row.offerCount === 'number' ? e.row.offerCount : 0,
      fromPrice: prices.length ? Math.min(...prices) : null,
      optionLists: strings(e.row.lists),
    }
  })
  const collections = [...pairUp(raw?.collections)].map(([id, e]) => ({
    ...common(id, e, d, now, pub),
    collectionType: (e.row.collectionType === 'menu' ? 'menu' : 'list') as 'menu' | 'list',
    hasPage: e.row.hasPage === true,
    sectionCount: typeof e.row.sectionCount === 'number' ? e.row.sectionCount : 0,
    itemCount: new Set(strings(e.row.itemRefs)).size,
    sectionNames: (Array.isArray(e.row.sectionNames) ? e.row.sectionNames : []).map(localized).filter((n) => Object.keys(n).length > 0),
  }))
  const usage = new Map<string, number>()
  for (const i of itemRows) if (i.status.status !== 'archived') for (const l of new Set(i.optionLists)) usage.set(l, (usage.get(l) ?? 0) + 1)
  const optionLists = [...pairUp(raw?.optionLists)].map(([id, e]) => ({
    ...common(id, e, d, now),
    optionCount: typeof e.row.optionCount === 'number' ? e.row.optionCount : 0,
    usedBy: usage.get(id) ?? 0,
  }))
  const byName = <T extends Common>(a: T, b: T) => a.name.localeCompare(b.name, d)
  return { items: itemRows.sort(byName), collections: collections.sort(byName), optionLists: optionLists.sort(byName) }
}

/** Home "At a glance" (spec §10.1). */
export async function getCatalogueGlance(ctx: TenantAuthorizationContext, projectId: string, deps: CatalogueDeps = {}): Promise<{ published: number; drafts: number; noPrice: number }> {
  const grant = grantFor(ctx, projectId, CATALOGUE_READ_PERMISSION)
  const r = await (deps.client ?? sanityWriteClient).fetch<{ published?: number; drafts?: number; noPrice?: number } | null>(CATALOGUE_GLANCE_QUERY, { projectSlug: grant.projectSlug }, RAW)
  return { published: r?.published ?? 0, drafts: r?.drafts ?? 0, noPrice: r?.noPrice ?? 0 }
}

// ── Read one ──────────────────────────────────────────────────────────────────

export type CataloguePhoto = { assetId: string; url: string | null; thumbUrl: string | null }
export type CatalogueSnapshot = {
  kind: CatalogueKind
  id: string
  /** The draft's revision ('' when there is no draft). */
  rev: string
  hasDraft: boolean
  live: { rev: string; publishedAt: string | null; expiresAt: string | null; archivedAt: string | null } | null
  status: LifecycleState
  /** The editable document (the draft, else the published version), system fields removed. */
  doc: Record<string, unknown>
  /** Items: the photos, resolved. */
  photos: CataloguePhoto[]
}

export async function getCatalogueDoc(ctx: TenantAuthorizationContext, projectId: string, kind: CatalogueKind, id: string, deps: CatalogueDeps = {}): Promise<CatalogueSnapshot> {
  const grant = grantFor(ctx, projectId, CATALOGUE_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isCatalogueId(id)) notFound()
  const { published, draft } = await readPair(client, kind, id, grant.projectSlug)
  const source = draft ?? published
  if (!source) notFound()
  const doc: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source!)) if (!SYSTEM_FIELDS.has(k)) doc[k] = v
  let photos: CataloguePhoto[] = []
  if (kind === 'item') {
    const ids = (Array.isArray(doc.images) ? doc.images : []).map((r) => (r as { _ref?: unknown })?._ref).filter((r): r is string => typeof r === 'string')
    if (ids.length) {
      const rows = await client.fetch<Array<{ _id: string; url?: string | null; hotspot?: { x?: number; y?: number } | null }> | null>(CATALOGUE_THUMBS_QUERY, { projectSlug: grant.projectSlug, ids })
      const byId = new Map((rows ?? []).map((r) => [r._id, r]))
      photos = ids.map((assetId) => {
        const r = byId.get(assetId)
        return { assetId, url: typeof r?.url === 'string' ? r.url : null, thumbUrl: r ? coverThumbUrl(r.url, r.hotspot, 320) : null }
      })
    }
  }
  const iso = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    kind,
    id,
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    live: published ? { rev: published._rev ?? '', publishedAt: iso(published.publishedAt), expiresAt: iso(published.expiresAt), archivedAt: iso(published.archivedAt) } : null,
    status: deriveStatus({ published: published as never, draft, rule: 'optional' }, (deps.now ?? (() => new Date()))()),
    doc,
    photos,
  }
}

// ── Create / open ─────────────────────────────────────────────────────────────

/**
 * A new, unpublished document (draft only). Items and collections get their
 * `publicId` here, once (ADR-031 D3 / AC 29), `visibility: public` (AC 30) and
 * no page; a collection defaults to `collectionType: list` (B2).
 */
export async function createCatalogueDoc(
  ctx: TenantAuthorizationContext,
  projectId: string,
  kind: CatalogueKind,
  input: { name?: string; itemProfile?: string; collectionType?: string },
  deps: CatalogueDeps = {}
): Promise<{ id: string; rev: string }> {
  const id = (deps.uuid ?? randomUUID)()
  const type = CATALOGUE_TYPE[kind]
  return audited({ ctx, projectId, contentType: type, contentId: id, intended: 'created', writer: deps.audit }, async (transactionId) => {
    const grant = grantFor(ctx, projectId, DESCRIPTOR[kind].permissions.write)
    const client = deps.client ?? sanityWriteClient
    const site = await readSite(client, grant.projectSlug)
    const count = await client.fetch<number | null>(CATALOGUE_COUNT_QUERY, { type, projectSlug: grant.projectSlug }, RAW)
    if ((count ?? 0) >= CATALOGUE_LIMITS.documents) throw new CatalogueError('too_large', 'Too many documents. Delete some first.')
    const raw = input?.name ?? ''
    if (typeof raw !== 'string' || raw.length > CATALOGUE_LIMITS.name) throw new CatalogueError('invalid_value', 'The name is too long.')
    const name = raw.trim().replace(/\s+/g, ' ')
    const doc: Record<string, unknown> = {
      _id: `drafts.${id}`,
      _type: type,
      projectSlug: grant.projectSlug,
      ...(name && { name: { _type: 'localizedString', [site.defaultLocale]: name } }),
    }
    if (kind === 'item') {
      const itemProfile = input.itemProfile ?? site.config.defaultItemProfile
      if (!isItemProfile(itemProfile)) throw new CatalogueError('invalid_value', 'Choose what you are offering.')
      Object.assign(doc, {
        publicId: (deps.uuid ?? randomUUID)(),
        itemProfile,
        // D-3: a new food item starts "not reviewed" — publishing waits for the editor's declaration.
        ...(can(itemProfile, 'foodInformation') && { allergenDeclaration: { status: 'notReviewed' } }),
        hasPage: false,
        visibility: 'public',
      })
    } else if (kind === 'collection') {
      const collectionType = input.collectionType ?? 'list'
      if (collectionType !== 'menu' && collectionType !== 'list') throw new CatalogueError('invalid_value', 'Unknown collection type.')
      Object.assign(doc, { publicId: (deps.uuid ?? randomUUID)(), collectionType, hasPage: false, visibility: 'public', sections: [] })
    } else {
      doc.options = []
    }
    const created = (await commit(client, grant.projectSlug, () => client.create(doc as { _id: string; _type: string }, { transactionId }))) as { _rev?: string } | undefined
    return { value: { id, rev: created?._rev ?? '' }, action: 'created' as const, state: null }
  })
}

/** An exact copy of the published document as its draft (system fields dropped, type and project pinned). */
function draftCopyOf(published: Doc, kind: CatalogueKind, id: string, projectSlug: string): Record<string, unknown> & { _id: string; _type: string } {
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = CATALOGUE_TYPE[kind]
  copy.projectSlug = projectSlug
  return copy as Record<string, unknown> & { _id: string; _type: string }
}

/** Makes sure `drafts.<id>` exists — an exact copy of the published document (never on a GET). */
export async function openCatalogueForEdit(ctx: TenantAuthorizationContext, projectId: string, kind: CatalogueKind, id: string, deps: CatalogueDeps = {}): Promise<{ id: string; rev: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, DESCRIPTOR[kind].permissions.write)
  const client = deps.client ?? sanityWriteClient
  if (!isCatalogueId(id)) notFound()
  const { published, draft } = await readPair(client, kind, id, grant.projectSlug)
  if (draft) return { id, rev: draft._rev ?? '', created: false }
  if (!published) notFound()
  if (published!.archivedAt != null) throw new CatalogueError('archived', 'Restore this first.')
  const copy = draftCopyOf(published!, kind, id, grant.projectSlug)
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    const r = (await span('sanity.commit', () => client.create(copy as { _id: string; _type: string }, DRAFT_SAVE))) as { _rev?: string }
    return { id, rev: r?._rev ?? '', created: true }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      const again = (await client.getDocument(`drafts.${id}`)) as Doc | undefined
      return { id, rev: again?._rev ?? '', created: false }
    }
    throw new CatalogueError('failed', 'Could not open this for editing.')
  }
}

// ── Slug namespace (D11) ──────────────────────────────────────────────────────

async function namespace(client: Client, projectSlug: string) {
  const rows = await span('sanity.namespace', () => client.fetch<SlugRow[] | null>(SLUG_NAMESPACE_QUERY, { projectSlug }, RAW))
  return toSlugOwners(rows ?? [])
}

/** Conflicts of these slugs with any OTHER item or collection, each naming its owner. */
export async function checkCatalogueSlugs(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; slugs: Record<string, string> },
  deps: CatalogueDeps = {}
): Promise<NamedSlugConflict[]> {
  const grant = grantFor(ctx, projectId, CATALOGUE_READ_PERMISSION)
  const slugs: Record<string, string> = {}
  for (const [l, s] of Object.entries(input?.slugs ?? {})) if (typeof s === 'string' && s.length <= 96) slugs[l] = s
  const owners = await namespace(deps.client ?? sanityWriteClient, grant.projectSlug)
  return namedSlugConflicts({ id: typeof input?.id === 'string' ? input.id : '', hasPage: true, slugs }, owners)
}

// ── Patch ─────────────────────────────────────────────────────────────────────

/**
 * ADR-033 D-4 — which of these ids are documents of `type` in this project,
 * and which of them have NO published version (→ referenced weakly). Every id
 * must exist (published or draft); `offered` additionally requires the item
 * to carry a price in the version that will be used (D2: an option links only
 * to an item that is itself offered). Returns the never-published ids.
 */
async function resolveTargets(client: Client, projectSlug: string, type: string, ids: string[], opts: { offered?: boolean } = {}): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await span(`sanity.refTargets.${type}`, () => client.fetch<Array<{ _id: string; offered?: boolean }> | null>(CATALOGUE_REF_TARGETS_QUERY, { type, projectSlug, ids, draftIds: ids.map((i) => `drafts.${i}`) }, RAW))
  const published = new Map<string, { offered?: boolean }>()
  const drafts = new Map<string, { offered?: boolean }>()
  for (const r of rows ?? []) (r._id.startsWith('drafts.') ? drafts : published).set(r._id.replace(/^drafts\./, ''), r)
  const neverPublished = new Set<string>()
  for (const id of ids) {
    const row = published.get(id) ?? drafts.get(id)
    if (!row) throw new CatalogueError('invalid_value', 'Something you picked is no longer available.')
    if (opts.offered && row.offered !== true) throw new CatalogueError('invalid_value', 'Something you picked is no longer available.')
    if (!published.has(id)) neverPublished.add(id)
  }
  return neverPublished
}

/** A reference written strong, or weak + strengthen-on-publish when the target was never published (D-4; posts → gallery precedent). */
function refTo(ref: Record<string, unknown>, weak: ReadonlySet<string>, type: string): Record<string, unknown> {
  const { _weak, _strengthenOnPublish, ...rest } = ref
  void _weak
  void _strengthenOnPublish
  return weak.has(rest._ref as string) ? { ...rest, _weak: true, _strengthenOnPublish: { type } } : rest
}

/** Rewrites the references a cleaned patch sets, weak where the target was never published. */
function applyWeakRefs(set: Record<string, unknown>, weakItems: ReadonlySet<string>, weakLists: ReadonlySet<string>) {
  if (Array.isArray(set.sections)) {
    set.sections = (set.sections as Array<Record<string, unknown>>).map((sec) => ({
      ...sec,
      items: ((sec.items as Array<Record<string, unknown>>) ?? []).map((r) => refTo(r, weakItems, 'catalogueItem')),
    }))
  }
  if (Array.isArray(set.optionLists)) {
    set.optionLists = (set.optionLists as Array<Record<string, unknown>>).map((a) => ({ ...a, list: refTo(a.list as Record<string, unknown>, weakLists, 'catalogueOptionList') }))
  }
  if (Array.isArray(set.options)) {
    set.options = (set.options as Array<Record<string, unknown>>).map((o) => (o.item ? { ...o, item: refTo(o.item as Record<string, unknown>, weakItems, 'catalogueItem') } : o))
  }
}

/** Validates and applies one autosave patch to `drafts.<id>`. Returns the new revision. */
export async function patchCatalogueDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  kind: CatalogueKind,
  input: {
    id: string
    rev: string
    set: Record<string, unknown>
    /**
     * First edit of a published document (optimisation D): `rev` is '' and this
     * is the live revision the editor loaded. The draft is created from the
     * live version AND the change applied in ONE transaction — no separate
     * "open for edit" round trip. Refused as a conflict if a draft already
     * exists (someone else started editing) or the live version changed since.
     */
    openFrom?: string
  },
  deps: CatalogueDeps = {}
): Promise<{ rev: string }> {
  const grant = grantFor(ctx, projectId, DESCRIPTOR[kind].permissions.write)
  const client = deps.client ?? sanityWriteClient
  if (!isCatalogueId(input?.id)) notFound()
  const opening = input.rev === '' && typeof input.openFrom === 'string' && input.openFrom.length > 0
  if (!opening && (typeof input.rev !== 'string' || !input.rev)) throw new CatalogueError('conflict', 'Missing revision.')
  assertAllowedPaths(kind, input.set)
  // Independent reads + the single-project guard at the same time (optimisation C);
  // the guard is awaited again right before the mutation.
  const guard = singleProjectGuard(client, grant.projectSlug)
  const [{ draft, published }, site] = await readsInOrder<[Awaited<ReturnType<typeof readPair>>, CatalogueSite, void]>([
    readPair(client, kind, input.id, grant.projectSlug),
    readSite(client, grant.projectSlug),
    guard,
  ])
  let previous: Doc
  let openedCopy: Record<string, unknown> | null = null
  if (opening) {
    if (draft) throw new CatalogueError('conflict', 'This was edited elsewhere.')
    if (!published) notFound()
    if (published!.archivedAt != null) throw new CatalogueError('archived', 'Restore this first.')
    if (published!._rev !== input.openFrom) throw new CatalogueError('conflict', 'This was edited elsewhere.')
    openedCopy = draftCopyOf(published!, kind, input.id, grant.projectSlug)
    previous = openedCopy as Doc
  } else {
    if (!draft) notFound()
    if (published?.archivedAt != null) throw new CatalogueError('archived', 'Restore this first.')
    if (draft!._rev !== input.rev) throw new CatalogueError('conflict', 'This was edited elsewhere.')
    previous = draft!
  }
  const cleaned = cleanCatalogueSet(kind, input.set, {
    locales: new Set(site.locales),
    channels: site.config.channels.map((c) => c.value),
    categories: site.config.categories.map((c) => c.value),
    tags: site.config.tags.map((c) => c.value),
    dietary: site.config.dietaryTags.map((c) => c.value),
    previous,
    newKey,
  })
  const [, weakLists, weakItems] = await Promise.all([
    cleaned.refs.mediaAssets.length
      ? span('sanity.mediaExist', () => client.fetch<string[] | null>(CATALOGUE_MEDIA_EXIST_QUERY, { projectSlug: grant.projectSlug, ids: cleaned.refs.mediaAssets }).then((found) => {
          const ok = new Set(found ?? [])
          if (!cleaned.refs.mediaAssets.every((i) => ok.has(i))) throw new CatalogueError('invalid_value', 'A photo is no longer in the Media Library.')
        }))
      : null,
    resolveTargets(client, grant.projectSlug, 'catalogueOptionList', cleaned.refs.optionLists),
    // Sections list items (drafts included, D-4); an option may link only to an item that is itself offered (D2).
    resolveTargets(client, grant.projectSlug, 'catalogueItem', cleaned.refs.items.filter((i) => i !== input.id), { offered: kind === 'optionList' }),
  ])
  applyWeakRefs(cleaned.set, weakItems, weakLists)
  if (Object.keys(cleaned.slugs).length) {
    const conflicts = namedSlugConflicts({ id: input.id, hasPage: true, slugs: cleaned.slugs }, await namespace(client, grant.projectSlug))
    // invalid_value (not a request error): the autosave drops just this path; the editor names the owner via checkCatalogueSlugs.
    if (conflicts.length) throw new CatalogueError('invalid_value', 'This address is already used.', { conflicts })
  }
  const ops = <P extends { setIfMissing(v: Record<string, unknown>): P; set(v: Record<string, unknown>): P; unset(v: string[]): P }>(p: P): P => {
    if (Object.keys(cleaned.setIfMissing).length) p = p.setIfMissing(cleaned.setIfMissing)
    if (Object.keys(cleaned.set).length) p = p.set(cleaned.set)
    if (cleaned.unset.length) p = p.unset(cleaned.unset)
    return p
  }
  const draftId = `drafts.${input.id}`
  if (openedCopy) {
    // create() fails (409 → conflict) if a draft appeared meanwhile: never written over.
    const docs = (await commit(
      client,
      grant.projectSlug,
      () => client.transaction().create(openedCopy as { _id: string; _type: string }).patch(draftId, (p) => ops(p)).commit({ ...DRAFT_SAVE, returnDocuments: true }),
      guard
    )) as Array<{ _id?: string; _rev?: string }> | undefined
    return { rev: (Array.isArray(docs) ? docs.find((d) => d?._id === draftId)?._rev : undefined) ?? '' }
  }
  const result = (await commit(client, grant.projectSlug, () => ops(client.patch(draftId).ifRevisionId(input.rev)).commit(DRAFT_SAVE), guard)) as
    | { _rev?: string }
    | undefined
  return { rev: result?._rev ?? '' }
}

// ── Publish / discard ─────────────────────────────────────────────────────────

export type CataloguePublishInput = {
  id: string
  rev: string
  /** now · schedule (publishAt in the future) · keep (the live dates stay — "Update"). */
  mode: 'now' | 'schedule' | 'keep'
  publishAt?: string | null
  /** "Unpublish on" — undefined keeps the live one on `keep`; null removes it. */
  expiresAt?: string | null
  /** D-5 — "Publish … and dependencies": include every never-published dependency. */
  withDependencies?: boolean
}

function parseIso(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const KIND_OF_TYPE: Record<string, CatalogueKind> = { catalogueItem: 'item', catalogueCollection: 'collection', catalogueOptionList: 'optionList' }

/** Which descriptors take part in a catalogue publish (the landing page is Studio's). */
const PUBLISH_DESCRIPTORS = CATALOGUE_LIFECYCLES.filter((d) => d.type in KIND_OF_TYPE)

/** The module's validation of one document of a publish; returns the published version to write. */
function cataloguePrepare(site: CatalogueSite, uuid: () => string) {
  const taken = new Map<string, Set<string>>()
  let owners: Awaited<ReturnType<typeof namespace>> | null = null
  return async (node: lifecycle.PublishNode, x: { client: lifecycle.LifecycleClient; projectSlug: string }): Promise<lifecycle.Doc> => {
    const kind = KIND_OF_TYPE[node.d.type]
    const draft = node.draft
    const named = (e: CatalogueError) =>
      node.isRoot || e.detail?.dependencies ? e : new CatalogueError(e.code, e.message, { ...e.detail, dependencies: [{ id: node.id, type: node.d.type, label: node.d.label?.(draft) ?? node.id }] })
    try {
      const d = site.defaultLocale
      const names = localized(draft.name)
      if (!names[d]?.trim()) throw new CatalogueError('missing_name', 'Add a name in the main language first.')
      if (kind === 'optionList' && !(Array.isArray(draft.options) && draft.options.length > 0)) throw new CatalogueError('no_options', 'Add at least one option.')
      // D-3: a food item publishes only with a reviewed, complete allergen declaration.
      if (kind === 'item' && can(profileOf(draft.itemProfile), 'foodInformation') && !isPublishableDeclaration(draft.allergenDeclaration)) {
        throw new CatalogueError('allergens_not_reviewed', 'Review the allergens first.')
      }
      // D-3a: every free-text "add" choice a food item offers must be reviewed.
      if (kind === 'item' && can(profileOf(draft.itemProfile), 'foodInformation')) {
        const ids = [...new Set((Array.isArray(draft.optionLists) ? draft.optionLists : []).map((a) => (a as { list?: { _ref?: unknown } })?.list?._ref).filter((r): r is string => typeof r === 'string'))]
        const blocking = await unreviewedChoicesOf(x.client as Client, x.projectSlug, ids)
        if (blocking.length) throw new CatalogueError('option_allergens_not_reviewed', 'Review the allergens of the extras first.', { dependencies: blocking })
      }
      // …and an option list used by a food item cannot go live with an unreviewed one either.
      if (kind === 'optionList' && unreviewedChoices(draft.options as never[]).length) {
        const users = await x.client.fetch<number | null>(CATALOGUE_FOOD_USERS_COUNT_QUERY, { id: node.id, projectSlug: x.projectSlug }, RAW)
        if ((users ?? 0) > 0) throw new CatalogueError('option_allergens_not_reviewed', 'Review the allergens of the extras first.', { dependencies: choiceRefs(node.id, draft) })
      }
      const doc: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k) && !LIFECYCLE_FIELDS.has(k)) doc[k] = v
      if (kind === 'item' && !can(profileOf(draft.itemProfile), 'foodInformation')) delete doc.allergenDeclaration
      if (kind !== 'optionList') {
        // publicId is set once (AC 29): the published one wins, a missing one is created.
        doc.publicId = (typeof node.published?.publicId === 'string' && node.published.publicId) || (typeof draft.publicId === 'string' && draft.publicId) || uuid()
        if (typeof doc.visibility !== 'string') doc.visibility = 'public'
      }
      if (kind !== 'optionList' && draft.hasPage === true) {
        owners ??= (await namespace(x.client as Client, x.projectSlug))
        const others = owners.filter((o) => o.id !== node.id)
        // D-7 / E-3: an address exists only in the languages the name is written in.
        // Publishing never rewrites editorial data — a stray address refuses, naming the language.
        const explicit = slugMap(draft.slug)
        const stray = slugLocalesWithoutName(explicit, names)
        if (stray.length) throw new CatalogueError('slug_without_name', 'An address has no name in its language.', { locales: stray })
        const conflicts = namedSlugConflicts({ id: node.id, hasPage: true, slugs: explicit }, others)
        if (conflicts.length) throw new CatalogueError('slug_taken', 'This address is already used.', { conflicts })
        const slugs = slugsForPublish({
          names,
          slugs: explicit,
          locales: site.locales,
          // Also what this same publish already gave away (two new items named alike).
          taken: (l) => new Set([...others.map((o) => o.slugs[l]).filter((v): v is string => typeof v === 'string'), ...(taken.get(l) ?? [])]),
          fallback: node.id.slice(0, 8),
        })
        if (!slugs[d]) throw new CatalogueError('missing_slug', 'The page needs an address in the main language.')
        for (const [l, v] of Object.entries(slugs)) taken.set(l, new Set([...(taken.get(l) ?? []), v]))
        doc.slug = { _type: 'localizedSlug', ...Object.fromEntries(Object.entries(slugs).map(([l, v]) => [l, { _type: 'slug', current: v }])) }
      }
      return doc
    } catch (e) {
      throw e instanceof CatalogueError ? named(e) : e
    }
  }
}

const textOf = (v: unknown, fallback: string) => {
  const t = localized(v)
  return Object.values(t)[0] ?? fallback
}

/** "Extra · Mozzarella" refs for the unreviewed free-text add choices of one list (links go to the list). */
function choiceRefs(listId: string, list: Record<string, unknown>): Referrer[] {
  const name = textOf(list.name, 'Option list')
  return unreviewedChoices(list.options as never[]).map((c) => ({ id: listId, type: 'catalogueOptionList', label: `${name} · ${textOf((c as { label?: unknown }).label, 'Untitled option')}` }))
}

/** D-3a: unreviewed free-text add choices of these lists — the published version, else the draft (a list published together). */
async function unreviewedChoicesOf(client: Client, projectSlug: string, ids: string[]): Promise<Referrer[]> {
  if (!ids.length) return []
  const rows = await client.fetch<Array<Record<string, unknown> & { _id: string }> | null>(CATALOGUE_OPTION_LIST_CHOICES_QUERY, { projectSlug, ids, draftIds: ids.map((i) => `drafts.${i}`) }, RAW)
  const out: Referrer[] = []
  for (const id of ids) {
    const row = (rows ?? []).find((r) => r._id === id) ?? (rows ?? []).find((r) => r._id === `drafts.${id}`)
    if (row) out.push(...choiceRefs(id, row))
  }
  return out
}

/** Lifecycle-service refusals → the dashboard's CatalogueError, keeping what they name. */
function asCatalogueError(error: unknown): unknown {
  if (error instanceof CatalogueLifecycleError) {
    const detail = { ...(error.referrers && { referrers: error.referrers }), ...(error.dependencies && { dependencies: error.dependencies }) }
    return new CatalogueError(error.code, error.message, Object.keys(detail).length ? detail : undefined)
  }
  return error
}

function slugsOf(doc: lifecycle.Doc): Record<string, string> {
  return slugMap(doc.slug)
}

/**
 * Publishes `drafts.<id>` (Activity: published / scheduled / schedule_changed;
 * one row per document). Blocks (spec §11, ADR-033 D-3/D-4/D-7): a name in the
 * main language; a page needs an address in the main language, unique across
 * items AND collections (the refusal names the other document); an option
 * list needs at least one option; a food item needs a reviewed allergen
 * declaration; a reference to never-published content is refused, naming it
 * — unless `withDependencies` publishes the whole tree together (D-5).
 * Archived content is refused until restored (ADR-032 D6).
 */
export async function publishCatalogueDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  kind: CatalogueKind,
  input: CataloguePublishInput,
  deps: CatalogueDeps = {}
): Promise<{ id: string; publishedAt: string; slugs: Record<string, string>; published: Array<{ type: string; id: string; publishedAt: string }>; notLive: Referrer[] }> {
  // Permission first, before any read (the service checks it again).
  grantFor(ctx, projectId, DESCRIPTOR[kind].permissions.write)
  const client = deps.client ?? sanityWriteClient
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  if (!isCatalogueId(input?.id)) notFound()
  if (input.mode !== 'now' && input.mode !== 'schedule' && input.mode !== 'keep') throw new CatalogueError('invalid_value', 'Unknown publish mode.')
  const site = await readSite(client, grant.projectSlug)
  try {
    const r = await span('lifecycle.publishTogether', () => lifecycle.publishTogether(
      PUBLISH_DESCRIPTORS,
      ctx,
      projectId,
      {
        root: { type: CATALOGUE_TYPE[kind], id: input.id, rev: input.rev },
        withDependencies: input.withDependencies === true,
        timing: (root, now) => publishTiming(input, root.published, now),
      },
      cataloguePrepare(site, deps.uuid ?? randomUUID),
      { client: client as lifecycle.LifecycleClient, now: deps.now, audit: deps.audit }
    ))
    return { id: input.id, publishedAt: r.root.publishedAt as string, slugs: slugsOf(r.root), published: r.published, notLive: r.notLive }
  } catch (error) {
    throw asCatalogueError(error)
  }
}

/** The root's dates from the publish mode (unchanged rules from S4). */
function publishTiming(input: CataloguePublishInput, published: lifecycle.Doc | undefined, now: Date): { publishedAt: string; expiresAt: string | null } {
  let publishedAt: Date = now
  if (input.mode === 'schedule') {
    const at = parseIso(input.publishAt)
    if (!at || at.getTime() <= now.getTime() || at.getTime() - now.getTime() > MAX_SCHEDULE_MS) throw new CatalogueError('invalid_schedule', 'Pick a future date within two years.')
    publishedAt = at
  }
  let expiresAt: Date | null = null
  if (input.mode === 'keep' && published) {
    publishedAt = parseIso(published.publishedAt) ?? now
    if (input.expiresAt === undefined) expiresAt = parseIso(published.expiresAt)
  }
  if (input.expiresAt != null) {
    expiresAt = parseIso(input.expiresAt)
    if (!expiresAt || expiresAt.getTime() <= Math.max(publishedAt.getTime(), now.getTime())) throw new CatalogueError('invalid_schedule', 'The unpublish date must be after the publish date.')
  }
  return { publishedAt: publishedAt.toISOString(), expiresAt: expiresAt ? expiresAt.toISOString() : null }
}

export type CataloguePublishDependency = Referrer & {
  /** Its own public page becomes available with this publish. */
  opensPage: boolean
  /** Other documents (outside this publish) that also reference it. */
  reusedBy: number
}

/** What "Publish … and dependencies" would do (D-5 confirmation panel). Read-only. */
export type CataloguePublishPreview = {
  root: Referrer & { opensPage: boolean }
  /** null = now. */
  publishAt: string | null
  /** Every never-published dependency that would be published with it. */
  dependencies: CataloguePublishDependency[]
  /** Dependencies this editor may not publish (the publish would be refused). */
  forbidden: Referrer[]
  /** References to content that no longer exists (the publish would be refused). */
  missing: Referrer[]
  /** Published dependencies that will not be live when this goes live (never changed — a warning). */
  notLive: Referrer[]
  /** Documents that cannot be published yet, and why (e.g. allergens not reviewed). */
  blocked: Array<Referrer & { code: string }>
}

export async function previewCataloguePublish(
  ctx: TenantAuthorizationContext,
  projectId: string,
  kind: CatalogueKind,
  input: { id: string; publishAt?: string | null },
  deps: CatalogueDeps = {}
): Promise<CataloguePublishPreview> {
  const grant = grantFor(ctx, projectId, DESCRIPTOR[kind].permissions.write)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  if (!isCatalogueId(input?.id)) notFound()
  const now = (deps.now ?? (() => new Date()))()
  const at = input.publishAt ? parseIso(input.publishAt) : null
  try {
    const site = await readSite(client as Client, grant.projectSlug)
    const plan = await lifecycle.planPublish(PUBLISH_DESCRIPTORS, ctx, projectId, client, grant.projectSlug, { type: CATALOGUE_TYPE[kind], id: input.id }, {
      liveAt: at && at.getTime() > now.getTime() ? at : now,
      withDependencies: true,
    })
    const prepare = cataloguePrepare(site, () => 'preview')
    const blocked: CataloguePublishPreview['blocked'] = []
    const nodes = [plan.root, ...plan.dependencies]
    for (const n of nodes) {
      try {
        await prepare(n, { client, projectSlug: grant.projectSlug })
      } catch (e) {
        if (!(e instanceof CatalogueError)) throw e
        blocked.push({ id: n.id, type: n.d.type, label: n.d.label?.(n.draft) ?? n.id, code: e.code })
      }
    }
    const ids = nodes.flatMap((n) => [n.id, `drafts.${n.id}`])
    const dependencies = await Promise.all(
      plan.dependencies.map(async (n) => ({
        id: n.id,
        type: n.d.type,
        label: n.d.label?.(n.draft) ?? n.id,
        opensPage: n.d.opensPage?.(n.draft) === true,
        reusedBy: (await client.fetch<number | null>(CATALOGUE_REUSE_COUNT_QUERY, { id: n.id, ids, projectSlug: grant.projectSlug }, RAW)) ?? 0,
      }))
    )
    return {
      root: { id: input.id, type: plan.root.d.type, label: plan.root.d.label?.(plan.root.draft) ?? input.id, opensPage: !plan.root.published && plan.root.d.opensPage?.(plan.root.draft) === true },
      publishAt: at && at.getTime() > now.getTime() ? at.toISOString() : null,
      dependencies,
      forbidden: plan.forbidden,
      missing: plan.missing,
      notLive: plan.notLive,
      blocked,
    }
  } catch (error) {
    throw asCatalogueError(error)
  }
}

/** Throws away unpublished changes of a published document (deletes its draft). */
export async function discardCatalogueDraft(ctx: TenantAuthorizationContext, projectId: string, kind: CatalogueKind, input: { id: string; rev: string }, deps: CatalogueDeps = {}): Promise<void> {
  const grant = grantFor(ctx, projectId, DESCRIPTOR[kind].permissions.write)
  const client = deps.client ?? sanityWriteClient
  if (!isCatalogueId(input?.id)) notFound()
  const { published, draft } = await readPair(client, kind, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (!published) throw new CatalogueError('invalid_value', 'This was never published.')
  if (draft!._rev !== input.rev) throw new CatalogueError('conflict', 'This was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () => client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit())
}

// ── Lifecycle (ADR-032 service, catalogue descriptors) ────────────────────────

export const CATALOGUE_LIFECYCLE_OPS = ['unpublish', 'publishAgain', 'setUnpublishDate', 'archive', 'restore', 'delete', 'deletePermanently'] as const
export type CatalogueLifecycleOp = (typeof CATALOGUE_LIFECYCLE_OPS)[number]

/**
 * One lifecycle action on one document. The service checks permissions first
 * (lifecycleGuard), re-reads ownership, guards revisions and writes Activity.
 * `in_use` refusals carry the blocking documents (`detail.referrers`) so the
 * dashboard can name and link them (ADR-033 D9, C7).
 */
export async function runCatalogueLifecycle(
  ctx: TenantAuthorizationContext,
  projectId: string,
  kind: CatalogueKind,
  input: { op: CatalogueLifecycleOp; id: string; rev?: string; expiresAt?: string | null },
  deps: CatalogueDeps = {}
): Promise<{ rev: string | null }> {
  const d = DESCRIPTOR[kind]
  if (!(CATALOGUE_LIFECYCLE_OPS as readonly unknown[]).includes(input?.op)) throw new CatalogueError('invalid_value', 'Unknown action.')
  // Gate before any read (the service re-checks the exact permission set).
  grantFor(ctx, projectId, input.op === 'delete' || input.op === 'deletePermanently' ? d.permissions.delete : d.permissions.write)
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  try {
    const grant = ctx.projects.find((p) => p.projectId === projectId)!
    if (!isCatalogueId(input.id)) notFound()
    // The revision the service guards on is read fresh: the list's copy may be minutes old.
    const { published, draft } = await lifecycle.readPair(d, client, input.id, grant.projectSlug)
    const rev = input.op === 'delete' ? (draft?._rev ?? '') : (published?._rev ?? '')
    if (input.rev && input.rev !== rev && input.op !== 'delete') throw new CatalogueError('conflict', 'This was changed elsewhere.')
    const args = { id: input.id, rev }
    let r: lifecycle.LifecycleResult | undefined = undefined
    switch (input.op) {
      case 'unpublish':
        r = await lifecycle.unpublishNow(d, ctx, projectId, args, sdeps)
        break
      case 'publishAgain':
        r = await lifecycle.backOnline(d, ctx, projectId, args, sdeps)
        break
      case 'setUnpublishDate':
        r = await lifecycle.setEndDate(d, ctx, projectId, { ...args, expiresAt: input.expiresAt ?? null }, sdeps)
        break
      case 'archive':
        r = await lifecycle.archive(d, ctx, projectId, args, sdeps)
        break
      case 'restore':
        r = await lifecycle.restore(d, ctx, projectId, args, sdeps)
        break
      case 'delete':
        await lifecycle.deleteDraft(d, ctx, projectId, args, sdeps)
        break
      case 'deletePermanently':
        await lifecycle.deletePermanently(d, ctx, projectId, args, sdeps)
        break
    }
    return { rev: r ? ((r.doc._rev as string | undefined) ?? null) : null }
  } catch (error) {
    if (error instanceof CatalogueLifecycleError) {
      throw new CatalogueError(error.code, error.message, error.referrers ? { referrers: error.referrers } : undefined)
    }
    throw error
  }
}

/** The live dates of a published document, plus the draft's new revision when the draft was changed too (the editor adopts it). */
export type CatalogueLiveDates = { rev: string; publishedAt: string | null; expiresAt: string | null; archivedAt: string | null; draftRev: string | null }

/**
 * Changes when an item or collection is on the website (go-live date, end
 * date) on the live version and its draft, without publishing the draft's
 * content. Same permission, ownership and revision guards as the other
 * lifecycle operations; option lists have no website dates. `publishedAt`:
 * an ISO moment, 'now', or left out to keep it; `expiresAt`: a moment or null.
 */
export async function setCatalogueDates(
  ctx: TenantAuthorizationContext,
  projectId: string,
  kind: CatalogueKind,
  input: { id: string; rev?: string; publishedAt?: string; expiresAt: string | null },
  deps: CatalogueDeps = {}
): Promise<CatalogueLiveDates> {
  const d = DESCRIPTOR[kind]
  // Gate before any read (the service re-checks the exact permission set).
  grantFor(ctx, projectId, d.permissions.write)
  if (kind === 'optionList') throw new CatalogueError('invalid_value', 'Option lists have no website dates.')
  const client = (deps.client ?? sanityWriteClient) as lifecycle.LifecycleClient
  const sdeps = { client, now: deps.now, audit: deps.audit }
  try {
    const grant = ctx.projects.find((p) => p.projectId === projectId)!
    if (!isCatalogueId(input?.id)) notFound()
    // The revision the service guards on is read fresh: the editor's copy may be minutes old.
    const { published } = await lifecycle.readPair(d, client, input.id, grant.projectSlug)
    if (!published) notFound()
    const rev = published?._rev ?? ''
    if (input.rev && input.rev !== rev) throw new CatalogueError('conflict', 'This was changed elsewhere.')
    const r = await lifecycle.setDates(
      d,
      ctx,
      projectId,
      { id: input.id, rev, ...(input.publishedAt !== undefined && { publishedAt: input.publishedAt }), expiresAt: input.expiresAt ?? null },
      sdeps
    )
    const str = (v: unknown) => (typeof v === 'string' ? v : null)
    return { rev: str(r.doc._rev) ?? '', publishedAt: str(r.doc.publishedAt), expiresAt: str(r.doc.expiresAt), archivedAt: str(r.doc.archivedAt), draftRev: r.draftRev }
  } catch (error) {
    if (error instanceof CatalogueLifecycleError) throw new CatalogueError(error.code, error.message)
    throw error
  }
}
