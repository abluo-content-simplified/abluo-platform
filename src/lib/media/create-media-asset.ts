/**
 * Upload one image binary to Sanity and file it as a `mediaAsset` document —
 * the Media Library write behind every upload (client dashboard and admin
 * Media, both through `src/lib/api/post-media.ts`).
 *
 * Two ways in (ADR-035):
 *
 * - `createMediaAsset` — one call, returns once the asset is in Sanity. Used
 *   where the caller needs the image right away (blog cover step).
 * - `reserveMediaAsset` + `completeMediaAsset` — the record exists first
 *   (`processing.status: 'processing'`, no image yet) so the caller can answer
 *   at once; `completeMediaAsset` then runs the policy, Tinify and the Sanity
 *   upload in the background and marks the record `ready` (or `failed`). The
 *   file goes into Sanity ONCE, already final: no swap, no orphaned original.
 *
 * Both run the processing policy (`decideProcessing`): small or already
 * compressed images skip Tinify. Optimisation never blocks an upload — without
 * a key, or when Tinify fails, the prepared bytes are stored and the stats say so.
 *
 * The helper does no authorization and no ownership checks — callers must
 * have verified the (tenant, project, projectSlug) triple BEFORE calling it,
 * so a rejected request never leaves an orphaned binary behind.
 */
import { span } from '@/lib/perf/timing'
import type { sanityWriteClient } from '@/lib/sanity/server-clients'
import { optimizeImage, type OptimizeImageResult } from '@/lib/media/optimize-image'
import { readImageInfo } from '@/lib/media/image-info'
import { decideProcessing, type ProcessingDecision } from '@/lib/media/processing-policy'

export type MediaAssetWriteClient = Pick<typeof sanityWriteClient, 'assets' | 'create'>
export type MediaAssetPatchClient = Pick<typeof sanityWriteClient, 'assets' | 'patch'>
export type OptimizeFn = (data: Buffer, contentType: string) => Promise<OptimizeImageResult>
export type DecideFn = (input: { bytes: number; data: Buffer }) => ProcessingDecision

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

/** What happened to the bytes — stored on the record (`processing`) for the Media Library. */
export type MediaProcessingStats = {
  optimized: boolean
  /** Why Tinify was not used (policy decision or Tinify outcome). */
  reason?: OptimizeImageResult['reason'] | ProcessingDecision['reason']
  bytesBefore: number
  bytesAfter: number
}

export type MediaProcessingStatus = 'processing' | 'ready' | 'failed'

export interface CreatedMediaAsset {
  /** The `mediaAsset` document id. */
  mediaAssetId: string
  /** The `sanity.imageAsset` id (`image-…`) — what an image field references. */
  imageAssetId: string
  url: string
  width: number | null
  height: number | null
  optimization: MediaProcessingStats
}

type Deps = { optimize?: OptimizeFn; decide?: DecideFn; log?: (message: string) => void; now?: () => Date }

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }

const defaultDecide: DecideFn = ({ bytes, data }) => decideProcessing({ bytes, info: readImageInfo(data) })

/** Policy → (maybe) Tinify → the bytes and filename to store. */
async function prepareBinary(input: Pick<CreateMediaAssetInput, 'data' | 'filename' | 'contentType'>, deps: Deps) {
  const contentType = input.contentType || 'application/octet-stream'
  const log = deps.log ?? ((m: string) => console.info(m))
  const decision = (deps.decide ?? defaultDecide)({ bytes: input.data.length, data: input.data })

  if (decision.action === 'keep') {
    log(`[media] kept as is (${decision.reason}) — ${input.data.length} bytes`)
    return {
      data: input.data,
      contentType,
      filename: input.filename,
      stats: { optimized: false, reason: decision.reason, bytesBefore: input.data.length, bytesAfter: input.data.length } satisfies MediaProcessingStats,
    }
  }

  const optimised = await span('media.optimize', () => (deps.optimize ?? optimizeImage)(input.data, contentType))
  log(
    optimised.optimized
      ? `[media] optimised ${optimised.bytesBefore} -> ${optimised.bytesAfter} bytes`
      : `[media] NOT optimised (${optimised.reason}) — stored ${optimised.bytesBefore} bytes`
  )
  // Keep the filename's extension honest when Tinify changed the format.
  const ext = optimised.optimized ? EXT[optimised.contentType] : undefined
  return {
    data: optimised.data,
    contentType: optimised.contentType,
    filename: ext ? `${input.filename.replace(/\.[^.]+$/, '')}.${ext}` : input.filename,
    stats: {
      optimized: optimised.optimized,
      ...(optimised.reason && { reason: optimised.reason }),
      bytesBefore: optimised.bytesBefore,
      bytesAfter: optimised.bytesAfter,
    } satisfies MediaProcessingStats,
  }
}

function processingField(status: MediaProcessingStatus, at: string, stats?: MediaProcessingStats) {
  return {
    status,
    ...(status === 'processing' ? { startedAt: at } : { finishedAt: at }),
    ...(stats && {
      optimized: stats.optimized,
      ...(stats.reason && { reason: stats.reason }),
      originalBytes: stats.bytesBefore,
      finalBytes: stats.bytesAfter,
    }),
  }
}

function recordFields(input: CreateMediaAssetInput) {
  const { projectId, projectSlug, name, description, uploadedBy, uploadedByName } = input
  return {
    _type: 'mediaAsset' as const,
    mediaType: 'image',
    tenant: { _type: 'reference', _ref: input.tenantId },
    ...(projectId && { project: { _type: 'reference', _ref: projectId } }),
    ...(projectSlug && { projectSlug }),
    ...(name && { name }),
    tags: input.tags ?? [],
    ...(input.altText !== undefined && { altText: input.altText }),
    ...(description && { description }),
    ...(uploadedBy && { uploadedBy }),
    ...(uploadedByName && { uploadedByName }),
  }
}

type UploadedAsset = { _id: string; url?: string; metadata?: { dimensions?: { width?: number; height?: number } } }
const dimsOf = (a: UploadedAsset) => ({ width: a.metadata?.dimensions?.width ?? null, height: a.metadata?.dimensions?.height ?? null })

async function uploadBinary(client: Pick<MediaAssetWriteClient, 'assets'>, prepared: Awaited<ReturnType<typeof prepareBinary>>, declared?: string) {
  return (await span('sanity.assetUpload', () =>
    client.assets.upload('image', prepared.data, {
      filename: prepared.filename,
      ...(declared && { contentType: prepared.contentType }),
    })
  )) as UploadedAsset
}

/** One call: prepare, upload, create the record (status `ready`). */
export async function createMediaAsset(
  client: MediaAssetWriteClient,
  input: CreateMediaAssetInput,
  deps: Deps = {}
): Promise<CreatedMediaAsset> {
  const prepared = await prepareBinary(input, deps)
  const uploadedAsset = await uploadBinary(client, prepared, input.contentType)
  const now = (deps.now ?? (() => new Date()))().toISOString()
  const mediaAsset = await span('sanity.createMediaAsset', () =>
    client.create({
      ...recordFields(input),
      image: { _type: 'image', asset: { _type: 'reference', _ref: uploadedAsset._id } },
      processing: processingField('ready', now, prepared.stats),
    })
  )
  return {
    mediaAssetId: mediaAsset._id,
    imageAssetId: uploadedAsset._id,
    url: uploadedAsset.url ?? '',
    ...dimsOf(uploadedAsset),
    optimization: prepared.stats,
  }
}

/** Creates the record with no image yet (`processing`) — the caller answers right after. */
export async function reserveMediaAsset(
  client: Pick<MediaAssetWriteClient, 'create'>,
  input: Omit<CreateMediaAssetInput, 'data' | 'filename' | 'contentType'>,
  deps: Pick<Deps, 'now'> = {}
): Promise<{ mediaAssetId: string }> {
  const now = (deps.now ?? (() => new Date()))().toISOString()
  const doc = await span('sanity.reserveMediaAsset', () =>
    client.create({ ...recordFields(input as CreateMediaAssetInput), processing: processingField('processing', now) })
  )
  return { mediaAssetId: doc._id }
}

/**
 * Background half: prepare, upload, attach the image to the reserved record
 * and mark it `ready`. Any failure marks it `failed` (never throws — it runs
 * after the response, nobody is there to catch it).
 */
export async function completeMediaAsset(
  client: MediaAssetPatchClient,
  mediaAssetId: string,
  input: Pick<CreateMediaAssetInput, 'data' | 'filename' | 'contentType'>,
  deps: Deps = {}
): Promise<{ status: 'ready' | 'failed' }> {
  const now = () => (deps.now ?? (() => new Date()))().toISOString()
  try {
    const prepared = await prepareBinary(input, deps)
    const uploadedAsset = await uploadBinary(client, prepared, input.contentType)
    await span('sanity.completeMediaAsset', () =>
      client
        .patch(mediaAssetId)
        .set({
          image: { _type: 'image', asset: { _type: 'reference', _ref: uploadedAsset._id } },
          processing: processingField('ready', now(), prepared.stats),
        })
        .commit()
    )
    return { status: 'ready' }
  } catch (error) {
    ;(deps.log ?? ((m: string) => console.error(m)))(
      `[media] processing failed for ${mediaAssetId}: ${error instanceof Error ? error.message : String(error)}`
    )
    try {
      await client.patch(mediaAssetId).set({ processing: processingField('failed', now()) }).commit()
    } catch {
      // The sweep (ADR-035 slice 2) marks records stuck in `processing` as failed.
    }
    return { status: 'failed' }
  }
}
