/**
 * Upload one image binary to Sanity and file it as a `mediaAsset` document —
 * the Media Library write behind every upload (client dashboard and admin
 * Media, both through `src/lib/api/post-media.ts`).
 *
 * Every upload is optimised first (standing rule: all images go through
 * TinyPNG/Tinify before use) — see `optimizeImage`. Optimisation never blocks
 * an upload: without a key, for a format Tinify doesn't handle, or when Tinify
 * fails, the original bytes are uploaded and the result says so.
 *
 * The helper does no authorization and no ownership checks — callers must
 * have verified the (tenant, project, projectSlug) triple BEFORE calling it,
 * so a rejected request never leaves an orphaned binary behind.
 */
import type { sanityWriteClient } from '@/lib/sanity/server-clients'
import { optimizeImage, type OptimizeImageResult } from '@/lib/media/optimize-image'

export type MediaAssetWriteClient = Pick<typeof sanityWriteClient, 'assets' | 'create'>
export type OptimizeFn = (data: Buffer, contentType: string) => Promise<OptimizeImageResult>

export interface CreateMediaAssetInput {
  data: Buffer
  filename: string
  /** MIME type of `data` (the optimised type is passed on to Sanity). */
  contentType?: string
  /** `client` document id. */
  tenantId: string
  /** Sanity `project` document id, when the asset belongs to one project. */
  projectId?: string | null
  /** Denormalised from the VERIFIED project document — never from a request. */
  projectSlug?: string | null
  name?: string | null
  tags?: string[]
  /** Admin route: a plain string (legacy shape). Omitted when not known yet. */
  altText?: unknown
  description?: string | null
  uploadedBy?: string | null
  uploadedByName?: string | null
}

export interface CreatedMediaAsset {
  /** The `mediaAsset` document id. */
  mediaAssetId: string
  /** The `sanity.imageAsset` id (`image-…`) — what an image field references. */
  imageAssetId: string
  url: string
  width: number | null
  height: number | null
  optimization: {
    optimized: boolean
    reason?: OptimizeImageResult['reason']
    bytesBefore: number
    bytesAfter: number
  }
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }

export async function createMediaAsset(
  client: MediaAssetWriteClient,
  input: CreateMediaAssetInput,
  deps: { optimize?: OptimizeFn; log?: (message: string) => void } = {}
): Promise<CreatedMediaAsset> {
  const contentType = input.contentType || 'application/octet-stream'
  const optimised = await (deps.optimize ?? optimizeImage)(input.data, contentType)
  ;(deps.log ?? ((m: string) => console.info(m)))(
    optimised.optimized
      ? `[media] optimised ${optimised.bytesBefore} -> ${optimised.bytesAfter} bytes`
      : `[media] NOT optimised (${optimised.reason}) — uploaded original ${optimised.bytesBefore} bytes`
  )

  // Keep the filename's extension honest when Tinify changed the format.
  const ext = optimised.optimized ? EXT[optimised.contentType] : undefined
  const filename = ext ? `${input.filename.replace(/\.[^.]+$/, '')}.${ext}` : input.filename

  const uploadedAsset = await client.assets.upload('image', optimised.data, {
    filename,
    ...(input.contentType && { contentType: optimised.contentType }),
  })

  const { projectId, projectSlug, name, description, uploadedBy, uploadedByName } = input
  const mediaAsset = await client.create({
    _type: 'mediaAsset',
    image: {
      _type: 'image',
      asset: { _type: 'reference', _ref: uploadedAsset._id },
    },
    tenant: { _type: 'reference', _ref: input.tenantId },
    ...(projectId && { project: { _type: 'reference', _ref: projectId } }),
    ...(projectSlug && { projectSlug }),
    ...(name && { name }),
    tags: input.tags ?? [],
    ...(input.altText !== undefined && { altText: input.altText }),
    ...(description && { description }),
    ...(uploadedBy && { uploadedBy }),
    ...(uploadedByName && { uploadedByName }),
  })

  const dims = (uploadedAsset as { metadata?: { dimensions?: { width?: number; height?: number } } }).metadata
    ?.dimensions
  return {
    mediaAssetId: mediaAsset._id,
    imageAssetId: uploadedAsset._id,
    url: (uploadedAsset as { url?: string }).url ?? '',
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    optimization: {
      optimized: optimised.optimized,
      ...(optimised.reason && { reason: optimised.reason }),
      bytesBefore: optimised.bytesBefore,
      bytesAfter: optimised.bytesAfter,
    },
  }
}
