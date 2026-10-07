/**
 * Client dashboard — galleries (Gallery module, client-usable).
 *
 * Tom's decisions: edits go to a DRAFT (`drafts.<galleryId>`) and only
 * "Publish changes" changes the website; clients can create galleries; photo
 * facts (alt, title, caption, tags, focal point) live on the Media Library
 * asset (`gallery-photos.ts`), per-gallery title/caption overrides on the
 * gallery item.
 *
 * Same enforcement as post-drafts / post-publish / post-lifecycle:
 *   1. `assertModuleAction(ctx, projectId, gallery.gallery.read|write)` before
 *      any I/O; identity (`_id`, `_type`, `projectSlug`) comes from the GRANT.
 *   2. Ids must be safe document ids; documents are re-read before every
 *      mutation and must be `gallery`s of the grant's project — anything else
 *      is "not_found", so ids can't be probed.
 *   3. Patch allowlist (`title.<loc>`, `description.<loc>`, `items`, `tags`,
 *      `mainImage`), site languages only, length/count limits; items are
 *      REBUILT server-side and every photo must be a `mediaAsset` of this
 *      project; `mainImage` must be one of the gallery's own photos.
 *   4. `assertSingleSanityProject` right before every mutation; revision
 *      guards (`ifRevisionId` / transaction `ifRevisionID`) → "conflict".
 *   5. Opaque error codes (GalleryErrorCode).
 */
import { randomUUID } from 'crypto'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { coverThumbUrl } from '@/lib/api/post-drafts'
import { slugFromTitle, uniqueSlug } from '@/lib/api/post-publish'

export const GALLERY_READ_PERMISSION = 'gallery.gallery.read'
export const GALLERY_WRITE_PERMISSION = 'gallery.gallery.write'
/** Deleting a gallery (ADR-028: Owner and Site admin). */
export const GALLERY_DELETE_PERMISSION = 'gallery.gallery.delete'

/** Whether this grant may delete galleries (UI hint; the server re-checks). */
export function canDeleteGalleries(grant: { permissions: readonly string[] }): boolean {
  return grant.permissions.includes(GALLERY_WRITE_PERMISSION) && grant.permissions.includes(GALLERY_DELETE_PERMISSION)
}

export const GALLERY_LIMITS = {
  items: 200,
  title: 120,
  description: 300,
  override: 200,
  patchBytes: 300_000,
  /** Same limits as media tags (gallery-photos PHOTO_LIMITS). */
  tags: 10,
  tagLength: 40,
  /** Galleries per batch action. */
  batch: 100,
  /** Gallery documents (drafts + published) per project — caps createGallery abuse. */
  galleries: 500,
} as const

export type GalleryErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'empty'
  | 'missing_alt'
  | 'in_use'
  | 'failed'

export type GalleryUsage = { kind: 'page' | 'post'; id: string; title: string }

export class GalleryError extends Error {
  constructor(
    readonly code: GalleryErrorCode,
    message: string,
    /** in_use → where the gallery is shown; missing_alt → the photos without a description. */
    readonly detail?: { usedIn?: GalleryUsage[]; assetIds?: string[] }
  ) {
    super(message)
    this.name = 'GalleryError'
  }
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u

/** ≤ 10 unique lower-case tags of ≤ 40 safe characters (the same rules as media tags). */
export function cleanGalleryTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > GALLERY_LIMITS.tags) throw new GalleryError('invalid_value', 'Up to 10 tags.')
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') throw new GalleryError('invalid_value', 'Bad tag.')
    const t = raw.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!t) continue
    if (t.length > GALLERY_LIMITS.tagLength || !TAG.test(t)) throw new GalleryError('invalid_value', 'Bad tag.')
    if (!out.includes(t)) out.push(t)
  }
  return out
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'create' | 'patch' | 'transaction'>
export type GalleryDeps = { client?: Client; now?: () => Date; uuid?: () => string }

type Doc = Record<string, unknown> & { _id?: string; _type?: string; _rev?: string; projectSlug?: string }

const GALLERY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const KEY = /^[A-Za-z0-9_-]{1,64}$/
const SYSTEM_FIELDS = new Set(['_id', '_rev', '_createdAt', '_updatedAt'])

export function isGalleryId(id: unknown): id is string {
  return typeof id === 'string' && GALLERY_ID.test(id)
}

function grantFor(ctx: TenantAuthorizationContext, projectId: string, permission: string) {
  assertModuleAction(ctx, projectId, permission)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

function notFound(): never {
  throw new GalleryError('not_found', 'Unknown gallery.')
}

function ours(doc: Doc | undefined, projectSlug: string): doc is Doc {
  return Boolean(doc && doc._type === 'gallery' && doc.projectSlug === projectSlug)
}

async function readPair(client: Client, id: string, projectSlug: string) {
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [
    Doc | undefined,
    Doc | undefined,
  ]
  if ((published && !ours(published, projectSlug)) || (draft && !ours(draft, projectSlug))) notFound()
  return { published, draft }
}

async function commit(client: Client, projectSlug: string, run: () => Promise<unknown>): Promise<unknown> {
  await assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)
  try {
    return await run()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) {
      throw new GalleryError('conflict', 'This gallery was changed elsewhere.')
    }
    throw new GalleryError('failed', 'Could not save.')
  }
}

export function localized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

type Site = { defaultLocale: string; locales: string[] }

async function readSite(client: Client, projectSlug: string): Promise<Site> {
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug }
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new GalleryError('failed', 'Site languages are not configured.')
  return { defaultLocale, locales: [defaultLocale, ...locales.filter((l) => l !== defaultLocale)] }
}

/**
 * The site's languages for a gallery that doesn't exist yet (the "new
 * gallery" wizard, lazy creation). Same gate as creating one: write permission.
 */
export async function getGallerySite(ctx: TenantAuthorizationContext, projectId: string, deps: GalleryDeps = {}): Promise<Site> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  return readSite(deps.client ?? sanityWriteClient, grant.projectSlug)
}

const pick = (value: unknown, locale: string): string => {
  const v = localized(value)
  return v[locale] ?? v.en ?? Object.values(v)[0] ?? ''
}

// ── Where a gallery is shown ──────────────────────────────────────────────────

const USAGE_QUERY = /* groq */ `*[_type in ["page", "post"] && projectSlug == $projectSlug
    && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && references($ids)]{
    _id, _type, title,
    "refs": array::compact([
      ...coalesce(sections[_type == "photoGallerySection"].galleries[]._ref, []),
      ...coalesce(sections[_type == "photoGallerySection"].gallery._ref, []),
      gallery._ref
    ])
  }`

async function usage(client: Client, projectSlug: string, ids: string[], locale: string): Promise<Map<string, GalleryUsage[]>> {
  const map = new Map<string, GalleryUsage[]>()
  if (!ids.length) return map
  const rows = await client.fetch<Array<{ _id: string; _type: string; title?: unknown; refs?: unknown }> | null>(USAGE_QUERY, {
    projectSlug,
    ids,
  })
  for (const row of rows ?? []) {
    const refs = new Set(Array.isArray(row.refs) ? row.refs.filter((r): r is string => typeof r === 'string') : [])
    for (const id of ids) {
      if (!refs.has(id)) continue
      const list = map.get(id) ?? []
      list.push({ kind: row._type === 'post' ? 'post' : 'page', id: row._id, title: pick(row.title, locale) })
      map.set(id, list)
    }
  }
  return map
}

// ── List ──────────────────────────────────────────────────────────────────────

export type GalleryListItem = {
  id: string
  /** In the site's default language (the draft's when there is one). */
  title: string
  internalName: string
  count: number
  /** Square thumbnail of the lead photo (the main image, else the first photo). */
  coverThumb: string | null
  /** Up to GALLERY_STRIP_SIZE square thumbnails: the lead photo first (larger crop), then the next photos in order. */
  thumbs: string[]
  /** The chosen main image (asset id) when it is one of the gallery's photos, else null (= first photo). */
  mainImage: string | null
  tags: string[]
  /** Last change (ISO), for sorting. */
  updatedAt: string
  /** When the gallery was first created (ISO; the published version's when there is one). */
  createdAt: string
  hasDraft: boolean
  isPublished: boolean
  usedIn: GalleryUsage[]
}

/** Photos per gallery in the list's thumbnail strip (lead + 4). */
export const GALLERY_STRIP_SIZE = 5

/**
 * The lead photo first (the main image when it is one of the photos, else the
 * first photo), then the other photos in gallery order, at most `size`.
 */
export function galleryStrip(refs: readonly string[], main: string | null | undefined, size = GALLERY_STRIP_SIZE): string[] {
  const lead = main && refs.includes(main) ? main : refs[0]
  if (!lead) return []
  return [lead, ...refs.filter((r) => r !== lead)].slice(0, size)
}

/** This project's galleries, most recently changed first. Read permission. */
export async function listGalleries(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: GalleryDeps = {}
): Promise<GalleryListItem[]> {
  const grant = grantFor(ctx, projectId, GALLERY_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const site = await readSite(client, grant.projectSlug)
  const rows = await client.fetch<Array<{
    _id: string
    _createdAt?: string
    _updatedAt?: string
    title?: unknown
    internalName?: unknown
    tags?: unknown
    count?: number | null
    refs?: unknown
    main?: string | null
  }> | null>(
    `*[_type == "gallery" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
      | order(_updatedAt desc){ _id, _createdAt, _updatedAt, title, internalName, tags, "count": count(items),
        "refs": items[0...${GALLERY_STRIP_SIZE}].mediaAsset._ref,
        "main": select(mainImage._ref in items[].mediaAsset._ref => mainImage._ref) }`,
    { projectSlug: grant.projectSlug },
    { perspective: 'raw' }
  )
  // One entry per gallery: the draft's state when there is one.
  const byId = new Map<string, { row: NonNullable<typeof rows>[number]; hasDraft: boolean; isPublished: boolean; createdAt: string }>()
  for (const row of rows ?? []) {
    const isDraft = row._id.startsWith('drafts.')
    const id = isDraft ? row._id.slice('drafts.'.length) : row._id
    if (!isGalleryId(id)) continue
    const entry = byId.get(id) ?? { row, hasDraft: false, isPublished: false, createdAt: '' }
    // The earliest creation of the pair (a published gallery's draft is younger than the gallery).
    if (row._createdAt && (!entry.createdAt || row._createdAt < entry.createdAt)) entry.createdAt = row._createdAt
    if (isDraft) {
      entry.row = row
      entry.hasDraft = true
    } else {
      entry.isPublished = true
      if (!entry.hasDraft) entry.row = row
    }
    byId.set(id, entry)
  }
  const ids = [...byId.keys()]
  const refsOf = (row: { refs?: unknown }) => (Array.isArray(row.refs) ? row.refs.filter((r): r is string => typeof r === 'string') : [])
  const strips = new Map([...byId].map(([id, e]) => [id, galleryStrip(refsOf(e.row), typeof e.row.main === 'string' ? e.row.main : null)]))
  const firstIds = [...new Set([...strips.values()].flat())]
  const [assets, used] = await Promise.all([
    firstIds.length
      ? client.fetch<Array<{ _id: string; url?: string | null; hotspot?: { x?: number; y?: number } | null }> | null>(
          `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]{ _id, "url": image.asset->url, "hotspot": image.hotspot }`,
          { projectSlug: grant.projectSlug, ids: firstIds }
        )
      : Promise.resolve([]),
    usage(client, grant.projectSlug, ids, site.defaultLocale),
  ])
  const assetById = new Map((assets ?? []).map((a) => [a._id, a]))
  return ids.map((id) => {
    const { row, hasDraft, isPublished, createdAt } = byId.get(id)!
    const strip = strips.get(id) ?? []
    const a = strip[0] ? assetById.get(strip[0]) : undefined
    const thumbs = strip
      .map((ref, n) => {
        const x = assetById.get(ref)
        return x ? coverThumbUrl(x.url, x.hotspot, n === 0 ? 384 : 160) : null
      })
      .filter((u): u is string => !!u)
    return {
      id,
      title: pick(row.title, site.defaultLocale),
      internalName: typeof row.internalName === 'string' ? row.internalName : '',
      count: typeof row.count === 'number' ? row.count : 0,
      coverThumb: a ? coverThumbUrl(a.url, a.hotspot, 192) : null,
      thumbs,
      mainImage: typeof row.main === 'string' ? row.main : null,
      tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
      updatedAt: row._updatedAt ?? '',
      createdAt: createdAt || row._updatedAt || '',
      hasDraft,
      isPublished,
      usedIn: used.get(id) ?? [],
    }
  })
}

// ── Read one ──────────────────────────────────────────────────────────────────

/** The asset id a gallery document's `mainImage` points at, or null. */
function mainImageRef(doc: Doc | undefined): string | null {
  const ref = (doc?.mainImage as { _ref?: unknown } | null | undefined)?._ref
  return typeof ref === 'string' && ASSET_ID.test(ref) ? ref : null
}

/** The asset ids of a gallery document's items. */
function itemRefs(items: unknown): string[] {
  return (Array.isArray(items) ? (items as RawItem[]) : []).map((i) => i?.mediaAsset?._ref).filter((r): r is string => typeof r === 'string')
}

export type FocalPoint = { x: number; y: number }

export type GalleryPhoto = {
  /** Stable item key (`_key`). */
  key: string
  assetId: string
  /** The Media Library asset's revision — pass it back to updateGalleryPhoto. */
  rev: string
  /** '' when the asset is gone from the Media Library. */
  url: string
  thumbUrl: string | null
  /** The photo's own name (mediaAsset.name) — not translated; '' when unnamed. */
  name: string
  alt: Record<string, string>
  title: Record<string, string>
  caption: Record<string, string>
  tags: string[]
  focal: FocalPoint | null
  /** Per-gallery overrides; null = use the photo's own. */
  titleOverride: Record<string, string> | null
  captionOverride: Record<string, string> | null
  missing: boolean
}

export type GallerySnapshot = {
  id: string
  /** The draft's revision ('' when there is no draft yet — call openGalleryForEdit). */
  rev: string
  hasDraft: boolean
  internalName: string
  title: Record<string, string>
  description: Record<string, string>
  tags: string[]
  items: GalleryPhoto[]
  /** The chosen main image (asset id) — always one of `items`; null = none chosen (the first photo leads). */
  mainImage: string | null
  live: { rev: string } | null
  usedIn: GalleryUsage[]
  site: Site
}

type RawItem = {
  _key?: unknown
  mediaAsset?: { _ref?: unknown } | null
  titleOverrideEnabled?: unknown
  titleOverride?: unknown
  captionOverrideEnabled?: unknown
  captionOverride?: unknown
}

type AssetRow = {
  _id: string
  _rev?: string
  url?: string | null
  name?: unknown
  altText?: unknown
  title?: unknown
  caption?: unknown
  tags?: unknown
  hotspot?: { x?: unknown; y?: unknown } | null
}

export const ASSET_FIELDS = /* groq */ `{ _id, _rev, "url": image.asset->url, name, altText, title, caption, tags, "hotspot": image.hotspot }`

export function photoFromAsset(a: AssetRow | undefined, assetId: string, key: string, item?: RawItem): GalleryPhoto {
  const h = a?.hotspot
  const focal = h && typeof h.x === 'number' && typeof h.y === 'number' ? { x: h.x, y: h.y } : null
  const url = typeof a?.url === 'string' ? a.url : ''
  return {
    key,
    assetId,
    rev: typeof a?._rev === 'string' ? a._rev : '',
    url,
    thumbUrl: url ? coverThumbUrl(url, focal, 640) : null,
    name: typeof a?.name === 'string' ? a.name.trim() : '',
    alt: typeof a?.altText === 'string' ? (a.altText.trim() ? { en: a.altText } : {}) : localized(a?.altText),
    title: localized(a?.title),
    caption: localized(a?.caption),
    tags: Array.isArray(a?.tags) ? a!.tags.filter((t): t is string => typeof t === 'string') : [],
    focal,
    titleOverride: item?.titleOverrideEnabled === true ? localized(item.titleOverride) : null,
    captionOverride: item?.captionOverrideEnabled === true ? localized(item.captionOverride) : null,
    missing: !a,
  }
}

/** The gallery as the editor shows it: the draft when there is one, else the published version. */
export async function getGalleryDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: GalleryDeps = {}
): Promise<GallerySnapshot> {
  const grant = grantFor(ctx, projectId, GALLERY_READ_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isGalleryId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  const doc = draft ?? published
  if (!doc) notFound()
  const site = await readSite(client, grant.projectSlug)
  const items = (Array.isArray(doc.items) ? doc.items : []) as RawItem[]
  const assetIds = [...new Set(items.map((i) => i?.mediaAsset?._ref).filter((r): r is string => typeof r === 'string'))]
  const [assets, used] = await Promise.all([
    assetIds.length
      ? client.fetch<AssetRow[] | null>(
          `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]${ASSET_FIELDS}`,
          { projectSlug: grant.projectSlug, ids: assetIds }
        )
      : Promise.resolve([]),
    usage(client, grant.projectSlug, [id], site.defaultLocale),
  ])
  const byId = new Map((assets ?? []).map((a) => [a._id, a]))
  const main = mainImageRef(doc)
  return {
    id,
    rev: draft?._rev ?? '',
    hasDraft: Boolean(draft),
    internalName: typeof doc.internalName === 'string' ? doc.internalName : '',
    title: localized(doc.title),
    description: localized(doc.description),
    tags: Array.isArray(doc.tags) ? doc.tags.filter((t): t is string => typeof t === 'string') : [],
    items: items
      .filter((i) => typeof i?.mediaAsset?._ref === 'string')
      .map((i, n) => {
        const assetId = i.mediaAsset!._ref as string
        const key = typeof i._key === 'string' && KEY.test(i._key) ? i._key : `item-${n}`
        return photoFromAsset(byId.get(assetId), assetId, key, i)
      }),
    mainImage: main && assetIds.includes(main) ? main : null,
    live: published?._rev ? { rev: published._rev } : null,
    usedIn: used.get(id) ?? [],
    site,
  }
}

// ── Open / create ─────────────────────────────────────────────────────────────

/** Makes sure `drafts.<id>` exists — an exact copy of the published gallery. A server action, never a GET. */
export async function openGalleryForEdit(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: GalleryDeps = {}
): Promise<{ id: string; created: boolean }> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isGalleryId(id)) notFound()
  const { published, draft } = await readPair(client, id, grant.projectSlug)
  if (draft) return { id, created: false }
  if (!published) notFound()
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(published)) if (!SYSTEM_FIELDS.has(k)) copy[k] = v
  copy._id = `drafts.${id}`
  copy._type = 'gallery'
  copy.projectSlug = grant.projectSlug
  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  try {
    await client.create(copy as { _id: string; _type: string })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) return { id, created: false }
    throw new GalleryError('failed', 'Could not open the gallery.')
  }
  return { id, created: true }
}

/** A new, unpublished gallery (draft only). internalName from the title; slug unique in the project. */
export async function createGallery(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { title?: string },
  deps: GalleryDeps = {}
): Promise<{ id: string; rev: string }> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const raw = input?.title ?? ''
  if (typeof raw !== 'string' || raw.length > GALLERY_LIMITS.title) {
    throw new GalleryError('invalid_value', 'The title is too long.')
  }
  const title = raw.trim().replace(/\s+/g, ' ')
  const site = await readSite(client, grant.projectSlug)
  const taken = await client.fetch<Array<string | null> | null>(
    `*[_type == "gallery" && projectSlug == $projectSlug].slug.current`,
    { projectSlug: grant.projectSlug },
    { perspective: 'raw' }
  )
  // One row per gallery document (draft or published): a cheap cap on how many a project can hold.
  if ((taken ?? []).length >= GALLERY_LIMITS.galleries) {
    throw new GalleryError('too_large', 'This site has too many galleries. Delete some first.')
  }
  const id = (deps.uuid ?? randomUUID)()
  const slug = uniqueSlug(slugFromTitle(title) || 'gallery', new Set((taken ?? []).filter((s): s is string => !!s)))
  const doc = {
    _id: `drafts.${id}`,
    _type: 'gallery',
    projectSlug: grant.projectSlug,
    internalName: title || `Gallery ${(deps.now ?? (() => new Date()))().toISOString().slice(0, 10)}`,
    ...(title && { title: { _type: 'localizedString', [site.defaultLocale]: title } }),
    slug: { _type: 'slug', current: slug },
    items: [],
  }
  const created = (await commit(client, grant.projectSlug, () => client.create(doc))) as { _rev?: string } | undefined
  return { id, rev: created?._rev ?? '' }
}

// ── Patch ─────────────────────────────────────────────────────────────────────

export type GalleryItemInput = {
  key?: string | null
  assetId: string
  titleOverride?: Record<string, string> | null
  captionOverride?: Record<string, string> | null
}

function cleanLocalized(value: unknown, locales: Set<string>, max: number, what: string): Record<string, string> {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new GalleryError('invalid_value', `${what} must be one text per language.`)
  const out: Record<string, string> = {}
  for (const [locale, v] of Object.entries(value as Record<string, unknown>)) {
    if (!locales.has(locale)) throw new GalleryError('invalid_value', `Language "${locale}" is not on this site.`)
    if (typeof v !== 'string' || v.length > max) throw new GalleryError('invalid_value', `${what} is too long or not text.`)
    const t = v.trim().replace(/\s+/g, ' ')
    if (t) out[locale] = t
  }
  return out
}

/**
 * Rebuilds the items array from the client's ordered list: known keys kept,
 * missing/duplicate/unsafe keys regenerated, overrides validated, every asset
 * checked to be a mediaAsset of this project (else "not_found").
 */
export async function rebuildItems(
  client: Client,
  projectSlug: string,
  value: unknown,
  locales: Set<string>,
  newKey: () => string
): Promise<Array<Record<string, unknown>>> {
  if (!Array.isArray(value) || value.length > GALLERY_LIMITS.items) {
    throw new GalleryError('invalid_value', `A gallery holds up to ${GALLERY_LIMITS.items} photos.`)
  }
  const seen = new Set<string>()
  const items = value.map((raw) => {
    const r = raw as GalleryItemInput | null
    if (!r || typeof r !== 'object' || typeof r.assetId !== 'string' || !ASSET_ID.test(r.assetId)) {
      throw new GalleryError('invalid_value', 'Unknown photo.')
    }
    let key = typeof r.key === 'string' && KEY.test(r.key) && !seen.has(r.key) ? r.key : ''
    while (!key || seen.has(key)) key = newKey()
    seen.add(key)
    const title = r.titleOverride == null ? null : cleanLocalized(r.titleOverride, locales, GALLERY_LIMITS.override, 'Title')
    const caption = r.captionOverride == null ? null : cleanLocalized(r.captionOverride, locales, GALLERY_LIMITS.override, 'Caption')
    const titleOn = !!title && Object.keys(title).length > 0
    const captionOn = !!caption && Object.keys(caption).length > 0
    return {
      _key: key,
      _type: 'galleryItem',
      mediaAsset: { _type: 'reference', _ref: r.assetId },
      titleOverrideEnabled: titleOn,
      ...(titleOn && { titleOverride: { _type: 'localizedString', ...title } }),
      captionOverrideEnabled: captionOn,
      ...(captionOn && { captionOverride: { _type: 'localizedString', ...caption } }),
    }
  })
  const ids = [...new Set(items.map((i) => (i.mediaAsset as { _ref: string })._ref))]
  if (ids.length) {
    const found = await client.fetch<string[] | null>(
      `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids && !(_id in path("drafts.**"))]._id`,
      { projectSlug, ids }
    )
    const ok = new Set(found ?? [])
    if (!ids.every((id) => ok.has(id))) throw new GalleryError('not_found', 'Unknown photo.')
  }
  return items
}

const LOCALIZED_FIELDS: Record<string, number> = { title: GALLERY_LIMITS.title, description: GALLERY_LIMITS.description }

/** Validates and applies one autosave patch to `drafts.<id>`. Returns the new revision (and the item keys). */
export async function patchGalleryDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string; set: Record<string, unknown> },
  deps: GalleryDeps = {}
): Promise<{ rev: string; keys?: string[] }> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isGalleryId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new GalleryError('conflict', 'Missing revision.')
  if (!input.set || typeof input.set !== 'object' || Array.isArray(input.set)) {
    throw new GalleryError('invalid_value', 'Nothing to save.')
  }
  if (JSON.stringify(input.set).length > GALLERY_LIMITS.patchBytes) throw new GalleryError('too_large', 'Too much at once.')
  // Field allowlist before any read.
  for (const path of Object.keys(input.set)) {
    const [field, locale, ...rest] = path.split('.')
    const ok = path === 'items' || path === 'tags' || path === 'mainImage' || (field in LOCALIZED_FIELDS && !!locale && rest.length === 0)
    if (!ok) throw new GalleryError('invalid_field', `Field "${path}" cannot be changed here.`)
  }

  const draftId = `drafts.${input.id}`
  // Draft AND published version under the same id must be this project's (as everywhere else).
  const { draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (draft._rev !== input.rev) throw new GalleryError('conflict', 'This gallery was edited elsewhere.')
  const site = await readSite(client, grant.projectSlug)
  const locales = new Set(site.locales)

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const ensure: Record<string, unknown> = {}
  let keys: string[] | undefined
  for (const [path, value] of Object.entries(input.set)) {
    if (path === 'tags') {
      const tags = cleanGalleryTags(value)
      if (tags.length) set.tags = tags
      else unset.push('tags')
      continue
    }
    if (path === 'items') {
      const items = await rebuildItems(client, grant.projectSlug, value, locales, () => randomUUID().replace(/-/g, '').slice(0, 12))
      set.items = items
      keys = items.map((i) => i._key as string)
      continue
    }
    if (path === 'mainImage') continue // after the loop: it is checked against the final photos
    const [field, locale] = path.split('.')
    if (!locales.has(locale)) throw new GalleryError('invalid_field', `Language "${locale}" is not on this site.`)
    if (typeof value !== 'string' || value.length > LOCALIZED_FIELDS[field]) {
      throw new GalleryError('invalid_value', `"${path}" is too long or not text.`)
    }
    ensure[field] = { _type: 'localizedString' }
    const t = value.trim()
    if (t) set[path] = t
    else unset.push(path)
  }

  // Main image: one of the gallery's own photos (the new list when this patch
  // changes the photos), or null to clear. A photo taken out of the gallery
  // stops being its main image.
  const photos = set.items ? itemRefs(set.items) : itemRefs(draft.items)
  if ('mainImage' in input.set) {
    const v = input.set.mainImage
    if (v === null || v === '') unset.push('mainImage')
    else if (typeof v !== 'string' || !ASSET_ID.test(v) || !photos.includes(v)) {
      throw new GalleryError('invalid_value', 'The main image must be one of the gallery\'s photos.')
    } else set.mainImage = { _type: 'reference', _ref: v, _weak: true }
  } else if (set.items) {
    const current = mainImageRef(draft)
    if (current && !photos.includes(current)) unset.push('mainImage')
  }

  const result = (await commit(client, grant.projectSlug, () => {
    let p = client.patch(draftId).ifRevisionId(input.rev)
    if (Object.keys(ensure).length) p = p.setIfMissing(ensure)
    if (Object.keys(set).length) p = p.set(set)
    if (unset.length) p = p.unset(unset)
    return p.commit()
  })) as { _rev?: string } | undefined
  return { rev: result?._rev ?? '', ...(keys && { keys }) }
}

// ── Publish / discard / delete ────────────────────────────────────────────────

/** Publishes `drafts.<id>` in one revision-guarded transaction. */
export async function publishGalleryDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: GalleryDeps = {}
): Promise<{ id: string }> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isGalleryId(input?.id)) notFound()
  if (typeof input.rev !== 'string' || !input.rev) throw new GalleryError('conflict', 'Missing revision.')
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  if (draft._rev !== input.rev) throw new GalleryError('conflict', 'This gallery was edited elsewhere.')

  const items = (Array.isArray(draft.items) ? draft.items : []) as RawItem[]
  const assetIds = [...new Set(items.map((i) => i?.mediaAsset?._ref).filter((r): r is string => typeof r === 'string'))]
  if (!assetIds.length) throw new GalleryError('empty', 'Add at least one photo.')
  const site = await readSite(client, grant.projectSlug)
  const assets = await client.fetch<Array<{ _id: string; altText?: unknown }> | null>(
    `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids && !(_id in path("drafts.**"))]{ _id, altText }`,
    { projectSlug: grant.projectSlug, ids: assetIds }
  )
  const byId = new Map((assets ?? []).map((a) => [a._id, a]))
  if (!assetIds.every((id) => byId.has(id))) throw new GalleryError('not_found', 'A photo is no longer in the Media Library.')
  // Descriptions can come later (Tom, wave B): publishing never requires
  // them; the website falls back to the photo's name, else an empty alt.

  const doc: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) if (!SYSTEM_FIELDS.has(k)) doc[k] = v
  doc._id = input.id
  doc._type = 'gallery'
  doc.projectSlug = grant.projectSlug
  if (typeof doc.internalName !== 'string' || !doc.internalName.trim()) {
    doc.internalName = pick(draft.title, site.defaultLocale) || 'Gallery'
  }
  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction().patch(`drafts.${input.id}`, { ifRevisionID: input.rev, unset: ['_publishGuard'] })
    if (published?._rev) {
      tx = tx.patch(input.id, { ifRevisionID: published._rev, unset: ['_publishGuard'] })
      tx = tx.createOrReplace(doc as { _id: string; _type: string })
    } else {
      tx = tx.create(doc as { _id: string; _type: string })
    }
    return tx.delete(`drafts.${input.id}`).commit()
  })
  return { id: input.id }
}

/** Throws away unpublished changes of a published gallery. */
export async function discardGalleryDraft(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev: string },
  deps: GalleryDeps = {}
): Promise<void> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isGalleryId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!draft) notFound()
  // A never-published gallery has nothing to go back to: that is a delete.
  if (!published) throw new GalleryError('invalid_value', 'This gallery was never published.')
  if (draft._rev !== input.rev) throw new GalleryError('conflict', 'This gallery was edited elsewhere.')
  const draftId = `drafts.${input.id}`
  await commit(client, grant.projectSlug, () =>
    client.transaction().patch(draftId, { ifRevisionID: input.rev, unset: ['_lifecycleGuard'] }).delete(draftId).commit()
  )
}

/**
 * Deletes a gallery (published and draft). Needs gallery.gallery.delete (Owner / Site admin). Refused with "in_use"
 * (and where) while a page or post of the site shows it. The photos stay in
 * the Media Library.
 */
export async function deleteGallery(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; rev?: string },
  deps: GalleryDeps = {}
): Promise<void> {
  grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const grant = grantFor(ctx, projectId, GALLERY_DELETE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  if (!isGalleryId(input?.id)) notFound()
  const { published, draft } = await readPair(client, input.id, grant.projectSlug)
  if (!published && !draft) notFound()
  const current = draft?._rev ?? published?._rev
  if (input.rev && input.rev !== current && input.rev !== published?._rev) {
    throw new GalleryError('conflict', 'This gallery was changed elsewhere.')
  }
  const site = await readSite(client, grant.projectSlug)
  const used = (await usage(client, grant.projectSlug, [input.id], site.defaultLocale)).get(input.id) ?? []
  if (used.length) throw new GalleryError('in_use', 'This gallery is shown on the website.', { usedIn: used })
  await commit(client, grant.projectSlug, () => {
    let tx = client.transaction()
    if (published?._rev) tx = tx.patch(input.id, { ifRevisionID: published._rev, unset: ['_lifecycleGuard'] })
    if (draft?._rev) tx = tx.patch(`drafts.${input.id}`, { ifRevisionID: draft._rev, unset: ['_lifecycleGuard'] })
    if (published) tx = tx.delete(input.id)
    if (draft) tx = tx.delete(`drafts.${input.id}`)
    return tx.commit()
  })
}

// ── Batch (select several) ────────────────────────────────────────────────────

export type GalleryBatchResult = { id: string; ok: true } | { id: string; ok: false; code: 'not_found' | 'in_use' | 'forbidden' | 'conflict' | 'invalid_value' | 'failed' }

/**
 * Deletes or tags up to 100 galleries, each checked on its own (same project,
 * a gallery, write permission; delete = owners only and never while a page or
 * post shows it: that one is reported as "in_use", i.e. skipped). Tags are
 * merged into the published AND the draft version directly (they are not part
 * of the website content, so no "Unpublished changes" is created).
 */
export async function batchGalleries(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { ids: string[]; op: 'delete' | 'tags'; addTags?: string[] },
  deps: GalleryDeps = {}
): Promise<{ results: GalleryBatchResult[] }> {
  const grant = grantFor(ctx, projectId, GALLERY_WRITE_PERMISSION)
  const client = deps.client ?? sanityWriteClient
  const ids = Array.isArray(input?.ids) ? input.ids : []
  if (!ids.length || ids.length > GALLERY_LIMITS.batch || ids.some((i) => !isGalleryId(i)) || new Set(ids).size !== ids.length) {
    throw new GalleryError('invalid_value', 'Choose 1 to 100 galleries.')
  }
  if (input.op !== 'delete' && input.op !== 'tags') throw new GalleryError('invalid_value', 'Unknown action.')
  const add = input.op === 'tags' ? cleanGalleryTags(input.addTags) : []
  if (input.op === 'tags' && !add.length) throw new GalleryError('invalid_value', 'Nothing to save.')
  if (input.op === 'delete') assertModuleAction(ctx, projectId, GALLERY_DELETE_PERMISSION)

  const results: GalleryBatchResult[] = []
  for (const id of ids) {
    try {
      if (input.op === 'delete') {
        await deleteGallery(ctx, projectId, { id }, deps)
      } else {
        const { published, draft } = await readPair(client, id, grant.projectSlug)
        if (!published && !draft) notFound()
        const merge = (doc: Doc) => {
          const own = Array.isArray(doc.tags) ? doc.tags.filter((t): t is string => typeof t === 'string') : []
          return [...own, ...add.filter((t) => !own.includes(t))]
        }
        const next = merge((draft ?? published)!)
        if (next.length > GALLERY_LIMITS.tags) throw new GalleryError('invalid_value', 'Up to 10 tags.')
        await commit(client, grant.projectSlug, () => {
          let tx = client.transaction()
          if (published?._rev) tx = tx.patch(id, { ifRevisionID: published._rev, set: { tags: merge(published) } })
          if (draft?._rev) tx = tx.patch(`drafts.${id}`, { ifRevisionID: draft._rev, set: { tags: merge(draft) } })
          return tx.commit()
        })
      }
      results.push({ id, ok: true })
    } catch (error) {
      if (error instanceof TenantAuthorizationError) results.push({ id, ok: false, code: 'forbidden' })
      else if (error instanceof GalleryError) {
        const code = error.code
        results.push({ id, ok: false, code: code === 'in_use' || code === 'not_found' || code === 'conflict' || code === 'invalid_value' || code === 'forbidden' ? code : 'failed' })
      } else results.push({ id, ok: false, code: 'failed' })
    }
  }
  return { results }
}
