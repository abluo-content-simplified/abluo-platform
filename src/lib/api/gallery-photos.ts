/**
 * Client dashboard — a photo's own facts, written to its Media Library asset
 * so they apply everywhere the photo is used (galleries, covers, sections):
 * description (alt text), title, caption, tags and focal point (Sanity
 * hotspot, ADR-022 §4a). Per-gallery title/caption overrides live on the
 * gallery item instead (`patchGalleryDraft`).
 *
 * Enforcement (post-media pattern):
 *   1. `assertProjectAccess(ctx, projectId, gallery.gallery.write | media)` first.
 *   2. The asset is re-read and must be a published `mediaAsset` of the
 *      grant's project — anything else is "not_found".
 *   3. Site languages only; alt ≤ 200, title ≤ 120, caption ≤ 300 chars;
 *      ≤ 10 tags of ≤ 40 safe characters (the listProjectMedia rules);
 *      focal x/y in 0..1.
 *   4. `assertSingleSanityProject`, then one patch guarded by the asset's
 *      revision (`rev` from the caller when given) → "conflict".
 * Fields left `undefined` are not touched; a given field replaces the whole
 * localized value (an empty object clears it).
 */
import { assertProjectAccess } from '@/lib/api/media-permission'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { GALLERY_WRITE_PERMISSION, GalleryError, photoFromAsset, type FocalPoint, type GalleryPhoto } from '@/lib/api/gallery-drafts'

export const PHOTO_LIMITS = { name: 120, batch: 100, alt: 200, title: 120, caption: 300, tags: 10, tagLength: 40, hotspotSize: 0.3 } as const

const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch' | 'patch'> & {
  transaction?: typeof sanityWriteClient.transaction
}
export type GalleryPhotoDeps = { client?: Client }

export type UpdateGalleryPhotoInput = {
  assetId: string
  /** The asset revision the editor last saw (optional; guards concurrent edits). */
  rev?: string
  /** The photo's own name (not translated); '' clears it. */
  name?: string
  alt?: Record<string, string>
  title?: Record<string, string>
  caption?: Record<string, string>
  tags?: string[]
  focal?: FocalPoint | null
}

/** A name: one line, ≤ 120 characters. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string' || value.length > PHOTO_LIMITS.name) throw new GalleryError('invalid_value', 'Name is too long or not text.')
  return value.trim().replace(/\s+/g, ' ')
}

function texts(value: unknown, locales: Set<string>, max: number, what: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GalleryError('invalid_value', `${what} must be one text per language.`)
  }
  const out: Record<string, string> = {}
  for (const [locale, v] of Object.entries(value as Record<string, unknown>)) {
    if (!locales.has(locale)) throw new GalleryError('invalid_value', `Language "${locale}" is not on this site.`)
    if (typeof v !== 'string' || v.length > max) throw new GalleryError('invalid_value', `${what} is too long or not text.`)
    const t = v.trim().replace(/\s+/g, ' ')
    if (t) out[locale] = t
  }
  return out
}

/** ≤ 10 unique lower-case tags of ≤ 40 safe characters. */
export function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PHOTO_LIMITS.tags) throw new GalleryError('invalid_value', 'Up to 10 tags.')
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') throw new GalleryError('invalid_value', 'Bad tag.')
    const t = raw.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!t) continue
    if (t.length > PHOTO_LIMITS.tagLength || !TAG.test(t)) throw new GalleryError('invalid_value', 'Bad tag.')
    if (!out.includes(t)) out.push(t)
  }
  return out
}

function focalPoint(value: unknown): FocalPoint {
  const v = value as { x?: unknown; y?: unknown } | null
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
  if (!v || typeof v !== 'object' || Array.isArray(v) || !ok(v.x) || !ok(v.y)) {
    throw new GalleryError('invalid_value', 'Focal point must be x and y between 0 and 1.')
  }
  const r = (n: number) => Math.round(n * 10000) / 10000
  return { x: r(v.x), y: r(v.y) }
}

export async function updateGalleryPhoto(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: UpdateGalleryPhotoInput,
  deps: GalleryPhotoDeps = {},
  /** The calling surface's gate: galleries (default) or the Media screen (MEDIA_MANAGE_PERMISSION). */
  permission: string = GALLERY_WRITE_PERMISSION
): Promise<{ rev: string; photo: Omit<GalleryPhoto, 'key' | 'titleOverride' | 'captionOverride'> }> {
  const grant = assertProjectAccess(ctx, projectId, permission)
  const client = deps.client ?? sanityWriteClient
  if (!input || typeof input.assetId !== 'string' || !ASSET_ID.test(input.assetId)) {
    throw new GalleryError('not_found', 'Unknown photo.')
  }
  // Validate everything that needs no read first.
  const tags = input.tags === undefined ? undefined : cleanTags(input.tags)
  const name = input.name === undefined ? undefined : cleanName(input.name)
  const focal = input.focal == null ? undefined : focalPoint(input.focal)

  const asset = (await client.getDocument(input.assetId)) as
    | (Record<string, unknown> & { _type?: string; _rev?: string; projectSlug?: string; image?: { hotspot?: Record<string, unknown> } })
    | undefined
  if (!asset || asset._type !== 'mediaAsset' || asset.projectSlug !== grant.projectSlug) {
    throw new GalleryError('not_found', 'Unknown photo.')
  }
  if (input.rev !== undefined && input.rev !== asset._rev) {
    throw new GalleryError('conflict', 'This photo was changed elsewhere.')
  }
  const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
    { projectSlug: grant.projectSlug }
  )
  const locales = new Set([site?.defaultLocale, ...(site?.supportedLocales ?? [])].filter((l): l is string => !!l))
  if (!locales.size) throw new GalleryError('failed', 'Site languages are not configured.')

  const set: Record<string, unknown> = {}
  if (name !== undefined) set.name = name
  if (input.alt !== undefined) set.altText = { _type: 'localizedString', ...texts(input.alt, locales, PHOTO_LIMITS.alt, 'Description') }
  if (input.title !== undefined) set.title = { _type: 'localizedString', ...texts(input.title, locales, PHOTO_LIMITS.title, 'Title') }
  if (input.caption !== undefined) {
    set.caption = { _type: 'localizedString', ...texts(input.caption, locales, PHOTO_LIMITS.caption, 'Caption') }
  }
  if (tags !== undefined) set.tags = tags
  if (focal) {
    const h = asset.image?.hotspot
    set['image.hotspot'] = {
      _type: 'sanity.imageHotspot',
      x: focal.x,
      y: focal.y,
      width: typeof h?.width === 'number' ? h.width : PHOTO_LIMITS.hotspotSize,
      height: typeof h?.height === 'number' ? h.height : PHOTO_LIMITS.hotspotSize,
    }
  }
  if (!Object.keys(set).length) throw new GalleryError('invalid_value', 'Nothing to save.')

  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  let rev = ''
  try {
    const result = (await client.patch(input.assetId).ifRevisionId(asset._rev ?? '').set(set).commit()) as { _rev?: string }
    rev = result?._rev ?? ''
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new GalleryError('conflict', 'This photo was changed elsewhere.')
    throw new GalleryError('failed', 'Could not save.')
  }

  const url = await client.fetch<string | null>(`*[_type == "mediaAsset" && _id == $id && projectSlug == $projectSlug][0].image.asset->url`, {
    id: input.assetId,
    projectSlug: grant.projectSlug,
  })
  const merged = {
    _id: input.assetId,
    _rev: rev,
    url,
    name: set.name ?? asset.name,
    altText: set.altText ?? asset.altText,
    title: set.title ?? asset.title,
    caption: set.caption ?? asset.caption,
    tags: set.tags ?? asset.tags,
    hotspot: (set['image.hotspot'] as { x: number; y: number } | undefined) ?? asset.image?.hotspot ?? null,
  }
  const p = photoFromAsset(merged as never, input.assetId, 'x')
  return {
    rev,
    photo: { assetId: p.assetId, rev: p.rev, url: p.url, thumbUrl: p.thumbUrl, name: p.name, alt: p.alt, title: p.title, caption: p.caption, tags: p.tags, focal: p.focal, missing: p.missing },
  }
}

// ── Batch: rename / add tags to many photos at once ─────────────────────────

export type BatchPhotosInput = {
  /** 1..100 photos; each is re-read and checked against the grant's project. */
  assetIds: string[]
  /** "Summer party" → "Summer party 1", "Summer party 2"… in the given order. */
  baseName?: string
  /** Added to each photo's own tags (merged, still ≤ 10). */
  addTags?: string[]
}

export type BatchPhotoResult = { assetId: string; ok: true; rev: string; name: string; tags: string[] } | { assetId: string; ok: false; code: 'not_found' | 'invalid_value' }

/**
 * Names and tags many photos in one go (the "Name and tag all" sheet and the
 * Media page selection bar). Same gate as updateGalleryPhoto; every asset is
 * re-read and must be a `mediaAsset` of the grant's project — others come
 * back `not_found` and are not touched. One transaction, each patch guarded
 * by the revision just read → "conflict" when anything changed meanwhile.
 */
export async function batchUpdatePhotos(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: BatchPhotosInput,
  deps: GalleryPhotoDeps = {},
  permission: string = GALLERY_WRITE_PERMISSION
): Promise<{ results: BatchPhotoResult[] }> {
  const grant = assertProjectAccess(ctx, projectId, permission)
  const client = deps.client ?? sanityWriteClient
  const ids = Array.isArray(input?.assetIds) ? input.assetIds : []
  if (!ids.length || ids.length > PHOTO_LIMITS.batch) throw new GalleryError('invalid_value', 'Choose 1 to 100 photos.')
  if (ids.some((id) => typeof id !== 'string' || !ASSET_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new GalleryError('invalid_value', 'Bad photo list.')
  }
  const base = input.baseName === undefined ? undefined : cleanName(input.baseName)
  if (base !== undefined && (!base || base.length > PHOTO_LIMITS.name - 4)) throw new GalleryError('invalid_value', 'Name is empty or too long.')
  const add = input.addTags === undefined ? [] : cleanTags(input.addTags)
  if (base === undefined && !add.length) throw new GalleryError('invalid_value', 'Nothing to save.')

  const rows =
    (await client.fetch<{ _id: string; _rev: string; _type: string; projectSlug?: string; tags?: unknown }[]>(
      `*[_id in $ids]{ _id, _rev, _type, projectSlug, tags }`,
      { ids }
    )) ?? []
  const byId = new Map(rows.map((r) => [r._id, r]))
  const results: BatchPhotoResult[] = []
  const patches: { id: string; rev: string; set: Record<string, unknown> }[] = []
  ids.forEach((id, i) => {
    const row = byId.get(id)
    // Per-asset check: same project, a published media asset — never a draft id or another tenant's.
    if (!row || row._type !== 'mediaAsset' || row.projectSlug !== grant.projectSlug || id.startsWith('drafts.')) {
      results.push({ assetId: id, ok: false, code: 'not_found' })
      return
    }
    const own = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : []
    const merged = [...own, ...add.filter((t) => !own.includes(t))]
    if (merged.length > PHOTO_LIMITS.tags) {
      results.push({ assetId: id, ok: false, code: 'invalid_value' })
      return
    }
    const set: Record<string, unknown> = {}
    const name = base === undefined ? undefined : `${base} ${i + 1}`
    if (name !== undefined) set.name = name
    if (add.length) set.tags = merged
    patches.push({ id, rev: row._rev, set })
    results.push({ assetId: id, ok: true, rev: '', name: name ?? '', tags: merged })
  })
  if (!patches.length) return { results }

  await assertSingleSanityProject((q, p) => client.fetch(q, p), grant.projectSlug)
  if (!client.transaction) throw new GalleryError('failed', 'Could not save.')
  let tx = client.transaction()
  for (const p of patches) tx = tx.patch(p.id, { ifRevisionID: p.rev, set: p.set })
  try {
    await tx.commit()
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 409) throw new GalleryError('conflict', 'A photo was changed elsewhere.')
    throw new GalleryError('failed', 'Could not save.')
  }
  // Fresh revisions (and the names actually stored) for the caller to keep editing.
  const fresh =
    (await client.fetch<{ _id: string; _rev: string; name?: string }[]>(
      `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]{ _id, _rev, name }`,
      { projectSlug: grant.projectSlug, ids: patches.map((p) => p.id) }
    )) ?? []
  const freshById = new Map(fresh.map((f) => [f._id, f]))
  return {
    results: results.map((r) => {
      if (!r.ok) return r
      const f = freshById.get(r.assetId)
      return { ...r, rev: f?._rev ?? '', name: typeof f?.name === 'string' ? f.name : r.name }
    }),
  }
}
