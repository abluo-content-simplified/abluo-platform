/**
 * Client dashboard — images for blog posts (ADR-025 · Create flow step 6,
 * "Add a cover image").
 *
 * Three server-side operations, all gated exactly like `post-drafts.ts`:
 *
 *   uploadPostImage   file -> Tinify -> Sanity asset -> project-scoped
 *                     `mediaAsset` (standing rules: every image is a Media
 *                     Library asset before it is used, and is optimised first).
 *   listProjectMedia  this project's Media Library images, newest first, paged,
 *                     with search (name + alt text, any language, accent-
 *                     insensitive) and tag filters ("any of"), plus the
 *                     project's tags for filter chips.
 *   setPostCover      writes / removes the draft's `coverImage` — referencing
 *                     an asset of THIS project only — with alt text.
 *   getPostCover      reads the current cover back (resume a wizard session).
 *
 * Enforcement, in order, on every call:
 *   1. `assertModuleAction(ctx, projectId, 'blog.post.write')` — before any I/O.
 *   2. Identity comes from the GRANT: the mediaAsset's tenant/project/projectSlug
 *      are read from this project's own Sanity `project` document (looked up by
 *      the grant's projectSlug), never from the caller.
 *   3. Uploads: type allowlist (JPEG/PNG/WebP, checked against the file's own
 *      bytes, not only its declared type) and size limit BEFORE any upload.
 *   4. Cover writes: the draft is re-read (must be a `post` draft of the
 *      grant's project, otherwise "not_found"), `rev` must match, the media
 *      asset must belong to the same project (`assertSameTenantReference`),
 *      alt text is OPTIONAL (the wizard sets the cover first, then autosaves
 *      the description; the shell gates "Next" on the default-language alt),
 *      only the site's languages, ≤ 200 chars each, and the patch uses
 *      `ifRevisionId` ("conflict" -> "edited elsewhere").
 *
 * The written `coverImage` is the website's shape (`localizedImage`, read by
 * `locImage('coverImage')` in `src/lib/sanity/queries.ts`):
 *   { _type: 'localizedImage', asset: { _type: 'reference', _ref: 'image-…' },
 *     alt: { _type: 'localizedString', <locale>: '…' } }
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import {
  assertSameTenantReference,
  tenantScopedSanityClient,
  TenantAuthorizationError,
  type SanityFetchFn,
} from '@/lib/api/tenant-scoped-sanity'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { createMediaAsset } from '@/lib/media/create-media-asset'
import type { OptimizeImageResult } from '@/lib/media/optimize-image'
import { BLOG_POST_WRITE_PERMISSION } from '@/lib/api/post-drafts'

export const POST_MEDIA_LIMITS = {
  /** Upload size limit (before optimisation). */
  maxBytes: 15 * 1024 * 1024,
  /** Alt text, per language. */
  alt: 200,
  /** Media library page size. */
  pageSize: 24,
  /** Search text length. */
  query: 80,
  /** Tags per filter, and characters per tag. */
  tags: 10,
  tagLength: 40,
  /** Assets considered per library request (filtered + paged in memory). */
  scan: 2000,
  /** Tag chips returned. */
  tagChips: 30,
} as const

export const POST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type PostImageType = (typeof POST_IMAGE_TYPES)[number]

export type PostMediaErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'unsupported_type'
  | 'too_large'
  | 'invalid_value'
  | 'conflict'
  | 'failed'

export class PostMediaError extends Error {
  constructor(
    readonly code: PostMediaErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PostMediaError'
  }
}

type WriteClient = Pick<typeof sanityWriteClient, 'assets' | 'create' | 'getDocument' | 'patch'>
export type PostMediaDeps = {
  client?: WriteClient
  /** Raw fetch behind the tenant-scoped read client (tests inject a fake). */
  fetch?: SanityFetchFn
  optimize?: (data: Buffer, contentType: string) => Promise<OptimizeImageResult>
  now?: () => Date
  /** Receives the optimisation outcome (e.g. "skipped: no key" in dev). */
  log?: (message: string) => void
}

export type UploadedPostImage = {
  assetId: string
  url: string
  width: number | null
  height: number | null
  /** False when Tinify was unavailable — the original was uploaded. */
  optimized: boolean
  /** Bytes received by the server, and bytes stored after optimisation. */
  bytesBefore: number
  bytesAfter: number
}

/** Focal point in fractions of the ORIGINAL image (Sanity hotspot centre). */
export type FocalPoint = { x: number; y: number }

export type ProjectMediaItem = {
  assetId: string
  url: string
  thumbUrl: string
  width: number | null
  height: number | null
  alt: Record<string, string>
  /** The asset's focal point ("set once, applies everywhere"), or null. */
  focal: FocalPoint | null
}

export type PostCover = { assetId: string; url: string; alt: Record<string, string>; focal: FocalPoint | null }

/** Hotspot ellipse size written with a focal point (Sanity requires one). */
export const HOTSPOT_SIZE = 0.3

/** Validates a focal point: finite numbers in 0..1, rounded to 4 decimals. */
export function parseFocal(value: unknown): FocalPoint {
  const v = value as { x?: unknown; y?: unknown } | null
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
  if (!v || typeof v !== 'object' || Array.isArray(v) || !ok(v.x) || !ok(v.y)) {
    throw new PostMediaError('invalid_value', 'Focal point must be x and y between 0 and 1.')
  }
  const r = (n: number) => Math.round(n * 10000) / 10000
  return { x: r(v.x), y: r(v.y) }
}

function focalOf(hotspot: unknown): FocalPoint | null {
  const h = hotspot as { x?: unknown; y?: unknown } | null | undefined
  return h && typeof h.x === 'number' && typeof h.y === 'number' ? { x: h.x, y: h.y } : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CURSOR = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)\|([A-Za-z0-9._-]{1,128})$/

function grantFor(ctx: TenantAuthorizationContext, projectId: string) {
  assertModuleAction(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  return ctx.projects.find((p) => p.projectId === projectId)!
}

/** Sanity image CDN thumbnail of an asset URL. */
export function thumbnailUrl(url: string, size = 480): string {
  if (!url) return ''
  return `${url}?w=${size}&h=${size}&fit=crop&auto=format`
}

/** Reads the real format from the first bytes; never trusts the declared type. */
export function sniffImageType(bytes: Uint8Array): PostImageType | 'heic' | null {
  const at = (i: number) => bytes[i]
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(8, 12))) return 'heic'
  return null
}

function toLocalized(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

/** Optimises and files one image as this project's Media Library asset. */
export async function uploadPostImage(
  ctx: TenantAuthorizationContext,
  projectId: string,
  file: File,
  deps: PostMediaDeps = {}
): Promise<UploadedPostImage> {
  const grant = grantFor(ctx, projectId)

  if (!file || typeof file !== 'object' || typeof file.size !== 'number' || typeof file.arrayBuffer !== 'function') {
    throw new PostMediaError('invalid_value', 'No file.')
  }
  if (file.size <= 0) throw new PostMediaError('invalid_value', 'Empty file.')
  if (file.size > POST_MEDIA_LIMITS.maxBytes) throw new PostMediaError('too_large', 'File too large.')
  if (!POST_IMAGE_TYPES.includes(file.type as PostImageType)) {
    throw new PostMediaError('unsupported_type', 'Only JPEG, PNG and WebP images are supported.')
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length > POST_MEDIA_LIMITS.maxBytes) throw new PostMediaError('too_large', 'File too large.')
  const sniffed = sniffImageType(bytes)
  if (!sniffed || sniffed === 'heic') {
    throw new PostMediaError('unsupported_type', 'Only JPEG, PNG and WebP images are supported.')
  }

  // The project document gives the tenant + project references. Looked up by
  // the GRANT's projectSlug through the tenant-scoped chokepoint.
  const scoped = tenantScopedSanityClient(ctx, projectId, deps.fetch ? { fetch: deps.fetch } : {})
  const project = await scoped.fetch<{ _id?: string; clientId?: string | null } | null>(
    `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ _id, "clientId": clientRef._ref }`
  )
  if (!project?._id || !project.clientId) {
    throw new PostMediaError('failed', 'This site is not set up for images yet.')
  }

  const ext = sniffed === 'image/png' ? 'png' : sniffed === 'image/webp' ? 'webp' : 'jpg'
  const base = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 80) || 'image'
  let created: Awaited<ReturnType<typeof createMediaAsset>>
  try {
    // createMediaAsset runs Tinify first (never blocks the upload).
    created = await createMediaAsset(
      deps.client ?? sanityWriteClient,
      {
        data: bytes,
        filename: `${base}.${ext}`,
        contentType: sniffed,
        tenantId: project.clientId,
        projectId: project._id,
        projectSlug: grant.projectSlug,
        name: file.name ? file.name.slice(0, 120) : null,
        tags: ['blog'],
        uploadedBy: ctx.userId,
      },
      { optimize: deps.optimize, log: deps.log }
    )
  } catch {
    throw new PostMediaError('failed', 'Could not upload.')
  }
  return {
    assetId: created.mediaAssetId,
    url: created.url,
    width: created.width,
    height: created.height,
    optimized: created.optimization.optimized,
    bytesBefore: created.optimization.bytesBefore,
    bytesAfter: created.optimization.bytesAfter,
  }
}

/** Lower-case, accents removed — "Città" matches "citta". */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u

export type ListProjectMediaOptions = {
  cursor?: string | null
  /** Free text: every word must appear in the name or the alt text (any language). */
  q?: string | null
  /** "Any of" these tags (case-insensitive). */
  tags?: string[] | null
}

/**
 * This project's Media Library images, newest first. `cursor` comes from the
 * previous page (same q/tags). Search and tag filters run in memory over the
 * project's newest `POST_MEDIA_LIMITS.scan` assets — GROQ has no
 * accent-insensitive match — after ONE read that is scoped by the grant's
 * `$projectSlug` through the tenant-scoped client. `tags` lists this
 * project's tags (most used first) for filter chips.
 */
export async function listProjectMedia(
  ctx: TenantAuthorizationContext,
  projectId: string,
  options: ListProjectMediaOptions = {},
  deps: PostMediaDeps = {}
): Promise<{ items: ProjectMediaItem[]; nextCursor: string | null; tags: string[] }> {
  grantFor(ctx, projectId)

  let cursorAt = ''
  let cursorId = ''
  if (options.cursor) {
    const m = typeof options.cursor === 'string' ? CURSOR.exec(options.cursor) : null
    if (!m) throw new PostMediaError('invalid_value', 'Bad cursor.')
    ;[, cursorAt, cursorId] = m
  }
  if (options.q != null && typeof options.q !== 'string') throw new PostMediaError('invalid_value', 'Bad search.')
  const q = (options.q ?? '').trim()
  if (q.length > POST_MEDIA_LIMITS.query) throw new PostMediaError('invalid_value', 'Search too long.')
  const words = foldText(q).split(/\s+/).filter(Boolean)

  const rawTags = options.tags ?? []
  if (!Array.isArray(rawTags) || rawTags.length > POST_MEDIA_LIMITS.tags) {
    throw new PostMediaError('invalid_value', 'Too many tags.')
  }
  const wanted = new Set<string>()
  for (const tag of rawTags) {
    if (typeof tag !== 'string' || tag.length > POST_MEDIA_LIMITS.tagLength || !TAG.test(tag.trim())) {
      throw new PostMediaError('invalid_value', 'Bad tag.')
    }
    wanted.add(tag.trim().toLowerCase())
  }

  const scoped = tenantScopedSanityClient(ctx, projectId, deps.fetch ? { fetch: deps.fetch } : {})
  const rows = await scoped.fetch<
    Array<{
      _id: string
      _createdAt: string
      name?: string | null
      alt?: unknown
      tags?: unknown
      hotspot?: unknown
      url?: string | null
      width?: number | null
      height?: number | null
    }>
  >(
    `*[_type == "mediaAsset" && projectSlug == $projectSlug && defined(image.asset) && !(_id in path("drafts.**"))]
      | order(_createdAt desc, _id desc)[0...${POST_MEDIA_LIMITS.scan}]{
        _id, _createdAt, name, tags,
        "alt": altText,
        "hotspot": image.hotspot,
        "url": image.asset->url,
        "width": image.asset->metadata.dimensions.width,
        "height": image.asset->metadata.dimensions.height
      }`
  )
  const all = (Array.isArray(rows) ? rows : []).filter((r) => typeof r.url === 'string' && r.url)

  const tagsOf = (r: { tags?: unknown }) =>
    Array.isArray(r.tags)
      ? [...new Set(r.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim().toLowerCase()))]
      : []
  const altOf = (r: { alt?: unknown }) =>
    typeof r.alt === 'string' ? (r.alt.trim() ? { en: r.alt } : {}) : toLocalized(r.alt)

  const counts = new Map<string, number>()
  for (const r of all) for (const t of tagsOf(r)) counts.set(t, (counts.get(t) ?? 0) + 1)
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, POST_MEDIA_LIMITS.tagChips)
    .map(([t]) => t)

  const matching = all.filter((r) => {
    if (wanted.size && !tagsOf(r).some((t) => wanted.has(t))) return false
    if (!words.length) return true
    const haystack = foldText([r.name ?? '', ...Object.values(altOf(r))].join(' '))
    return words.every((w) => haystack.includes(w))
  })
  // Rows are already newest first (_createdAt desc, _id desc).
  const start = cursorAt
    ? matching.findIndex((r) => r._createdAt < cursorAt || (r._createdAt === cursorAt && r._id < cursorId))
    : 0
  const rest = start < 0 ? [] : matching.slice(start)
  const page = rest.slice(0, POST_MEDIA_LIMITS.pageSize)
  const last = rest.length > POST_MEDIA_LIMITS.pageSize ? page[page.length - 1] : null

  return {
    items: page.map((r) => ({
      assetId: r._id,
      url: r.url!,
      thumbUrl: thumbnailUrl(r.url!),
      width: r.width ?? null,
      height: r.height ?? null,
      alt: altOf(r),
      focal: focalOf(r.hotspot),
    })),
    nextCursor: last ? `${last._createdAt}|${last._id}` : null,
    tags,
  }
}

type DraftDoc = { _type?: string; _rev?: string; projectSlug?: string; coverImage?: { asset?: { _ref?: string }; alt?: unknown } }

async function readOwnedDraft(client: WriteClient, id: unknown, rev: unknown, projectSlug: string, checkRev = true) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new PostMediaError('not_found', 'Unknown draft id.')
  if (checkRev && (typeof rev !== 'string' || !rev)) throw new PostMediaError('conflict', 'Missing revision.')
  const draftId = `drafts.${id}`
  const current = (await client.getDocument(draftId)) as DraftDoc | undefined
  if (!current || current._type !== 'post' || current.projectSlug !== projectSlug) {
    throw new PostMediaError('not_found', 'Unknown draft id.')
  }
  if (checkRev && current._rev !== rev) throw new PostMediaError('conflict', 'This draft was edited elsewhere.')
  return { draftId, current }
}

export type SetPostCoverInput =
  | { id: string; rev: string; assetId: string; alt?: Record<string, string> | null; focal?: FocalPoint | null }
  | { id: string; rev: string; remove: true }

/** Sets or removes the draft's cover image. Returns the new revision. */
export async function setPostCover(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: SetPostCoverInput,
  deps: PostMediaDeps = {}
): Promise<{ rev: string; cover: PostCover | null }> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient
  if (!input || typeof input !== 'object') throw new PostMediaError('invalid_value', 'Nothing to save.')
  const { draftId, current } = await readOwnedDraft(client, input.id, input.rev, grant.projectSlug)
  const now = (deps.now ?? (() => new Date()))().toISOString()

  const commit = async (build: (p: ReturnType<WriteClient['patch']>) => ReturnType<WriteClient['patch']>) => {
    try {
      const result = (await build(client.patch(draftId).ifRevisionId(input.rev)).commit()) as { _rev?: string }
      return result._rev ?? ''
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 409) {
        throw new PostMediaError('conflict', 'This draft was edited elsewhere.')
      }
      throw new PostMediaError('failed', 'Could not save.')
    }
  }

  if ('remove' in input) {
    if (input.remove !== true) throw new PostMediaError('invalid_value', 'Nothing to save.')
    const rev = await commit((p) => p.unset(['coverImage']).set({ 'wizard.updatedAt': now }))
    return { rev, cover: null }
  }

  if (typeof input.assetId !== 'string' || !DOC_ID.test(input.assetId) || input.assetId.startsWith('drafts.')) {
    throw new PostMediaError('not_found', 'Unknown image.')
  }
  const inputAlt = input.alt ?? {}
  if (typeof inputAlt !== 'object' || Array.isArray(inputAlt)) {
    throw new PostMediaError('invalid_value', 'Alt text must be one text per language.')
  }
  const focal = input.focal == null ? null : parseFocal(input.focal)

  const scoped = tenantScopedSanityClient(ctx, projectId, deps.fetch ? { fetch: deps.fetch } : {})
  const site = await scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
  )
  const locales = site?.supportedLocales?.length ? site.supportedLocales : []
  const defaultLocale = site?.defaultLocale || locales[0]
  if (!defaultLocale) throw new PostMediaError('failed', 'Site languages are not configured.')
  const allowed = new Set([defaultLocale, ...locales])

  const alt: Record<string, string> = {}
  for (const [locale, value] of Object.entries(inputAlt)) {
    if (!allowed.has(locale)) throw new PostMediaError('invalid_value', `Language "${locale}" is not on this site.`)
    if (typeof value !== 'string' || value.length > POST_MEDIA_LIMITS.alt) {
      throw new PostMediaError('invalid_value', 'Alt text is too long or not text.')
    }
    const text = value.trim().replace(/\s+/g, ' ')
    if (text) alt[locale] = text
  }

  // A draft read back by the wizard names its cover by the image asset id
  // (`image-…`); resolve it to THIS project's Media Library asset.
  let mediaAssetId = input.assetId
  if (mediaAssetId.startsWith('image-')) {
    const found = await scoped.fetch<string | null>(
      `*[_type == "mediaAsset" && projectSlug == $projectSlug && image.asset._ref == $ref && !(_id in path("drafts.**"))]
        | order(_createdAt desc)[0]._id`,
      { ref: mediaAssetId }
    )
    if (typeof found !== 'string' || !found) throw new PostMediaError('not_found', 'Unknown image.')
    mediaAssetId = found
  }

  // Same-project check on the media asset (ADR-015 R3). A foreign or missing
  // asset is reported as "not_found" so ids can't be probed.
  try {
    await assertSameTenantReference(scoped, mediaAssetId, grant)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) throw new PostMediaError('not_found', 'Unknown image.')
    throw error
  }
  const asset = await scoped.fetch<{
    ref?: string | null
    url?: string | null
    altText?: unknown
    hotspot?: { x?: number; y?: number; width?: number; height?: number } | null
    crop?: Record<string, unknown> | null
  } | null>(
    `*[_type == "mediaAsset" && _id == $assetId && projectSlug == $projectSlug][0]{ "ref": image.asset._ref, "url": image.asset->url, altText, "hotspot": image.hotspot, "crop": image.crop }`,
    { assetId: mediaAssetId }
  )
  if (!asset?.ref || !asset.ref.startsWith('image-')) throw new PostMediaError('not_found', 'Unknown image.')

  // The focal point lives on the Media Library asset ("set once, applies
  // everywhere", ADR-022 §4a); the cover carries a copy so the website's
  // locImage('coverImage') projection sees it. Asset first: if the draft
  // write then conflicts, re-sending the same point is harmless.
  const assetFocal = focalOf(asset.hotspot)
  const hotspot = focal
    ? {
        _type: 'sanity.imageHotspot',
        x: focal.x,
        y: focal.y,
        width: typeof asset.hotspot?.width === 'number' ? asset.hotspot.width : HOTSPOT_SIZE,
        height: typeof asset.hotspot?.height === 'number' ? asset.hotspot.height : HOTSPOT_SIZE,
      }
    : asset.hotspot ?? null
  if (focal && (assetFocal?.x !== focal.x || assetFocal?.y !== focal.y)) {
    try {
      await client.patch(mediaAssetId).set({ 'image.hotspot': hotspot }).commit()
    } catch {
      throw new PostMediaError('failed', 'Could not save the focal point.')
    }
  }

  // Keep the crop: the asset's (source of truth), else the cover's own for the same image.
  const existing = current
  const crop =
    asset.crop ?? (existing.coverImage?.asset?._ref === asset.ref ? (existing.coverImage as { crop?: unknown }).crop : null)

  // Without any description the cover is stored without `alt` (the website's
  // locImage() then resolves alt to null); the wizard asks for it next.
  const coverImage = {
    _type: 'localizedImage',
    asset: { _type: 'reference', _ref: asset.ref },
    ...(hotspot && { hotspot: { _type: 'sanity.imageHotspot', ...hotspot } }),
    ...(crop ? { crop } : {}),
    ...(Object.keys(alt).length && { alt: { _type: 'localizedString', ...alt } }),
  }
  const rev = await commit((p) => p.set({ coverImage, 'wizard.updatedAt': now }))

  // Best effort: give the Media Library asset the alt text it is missing, so
  // the next use of this image starts from it. Never overwrites existing text
  // and never touches a legacy plain-string altText.
  if (asset.altText === undefined || asset.altText === null || (typeof asset.altText === 'object' && !Array.isArray(asset.altText))) {
    const existingAlt = toLocalized(asset.altText)
    const missing = Object.entries(alt).filter(([l]) => !existingAlt[l])
    if (missing.length) {
      try {
        let p = client.patch(mediaAssetId).setIfMissing({ altText: { _type: 'localizedString' } })
        p = p.set(Object.fromEntries(missing.map(([l, v]) => [`altText.${l}`, v])))
        await p.commit()
      } catch {
        // The cover is saved; the library alt text can be added later.
      }
    }
  }

  return { rev, cover: { assetId: mediaAssetId, url: asset.url ?? '', alt, focal: focalOf(hotspot) } }
}

/** The draft's current cover, resolved back to its Media Library asset (or null). */
export async function getPostCover(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string },
  deps: PostMediaDeps = {}
): Promise<PostCover | null> {
  const grant = grantFor(ctx, projectId)
  const client = deps.client ?? sanityWriteClient
  const { current } = await readOwnedDraft(client, input?.id, null, grant.projectSlug, false)
  const ref = current.coverImage?.asset?._ref
  if (!ref) return null
  const scoped = tenantScopedSanityClient(ctx, projectId, deps.fetch ? { fetch: deps.fetch } : {})
  const asset = await scoped.fetch<{ _id?: string; url?: string | null; hotspot?: unknown } | null>(
    `*[_type == "mediaAsset" && projectSlug == $projectSlug && image.asset._ref == $ref && !(_id in path("drafts.**"))]
      | order(_createdAt desc)[0]{ _id, "url": image.asset->url, "hotspot": image.hotspot }`,
    { ref }
  )
  if (!asset?._id) return null
  return {
    assetId: asset._id,
    url: asset.url ?? '',
    alt: toLocalized(current.coverImage?.alt),
    focal: focalOf(asset.hotspot) ?? focalOf((current.coverImage as { hotspot?: unknown } | undefined)?.hotspot),
  }
}
