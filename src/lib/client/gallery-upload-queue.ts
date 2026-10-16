/**
 * The multi-file upload queue — pure state + browser preparation (ADR-035).
 *
 * Each file goes waiting → preparing (browser pre-resize only when needed,
 * see planUpload) → uploading (the server answers as soon as the record
 * exists) → processing (policy, TinyPNG and the Sanity upload run on the
 * server after that answer; the queue polls) → done | error.
 *
 * Two limits: `UPLOAD_CONCURRENCY` files are sent at once, and at most
 * `PROCESSING_CONCURRENCY` wait on the server — so TinyPNG and the per-user
 * cap are never hammered, while a batch's uploads overlap its processing.
 * Progress is per step (server actions report no byte progress).
 */
import { planUpload } from '@/lib/client/upload-plan'

export type QueueStatus = 'waiting' | 'preparing' | 'uploading' | 'processing' | 'done' | 'error'

export type UploadResult = {
  assetId: string
  url: string
  optimized: boolean
  bytesBefore: number
  bytesAfter: number
}

export type QueueItem = {
  id: string
  name: string
  /** Size of the file the person chose ("before" in "Optimised · x → y"). */
  size: number
  status: QueueStatus
  /** Local preview of the picked file (object URL), when the browser made one. */
  preview?: string
  /** The Media Library record, once the server has created it (processing). */
  assetId?: string
  result?: UploadResult
  /** An error code (MediaActionError-like) for the UI to translate. */
  error?: string
}

export type QueueAction =
  | { type: 'add'; items: { id: string; name: string; size: number; preview?: string }[] }
  | { type: 'status'; id: string; status: Exclude<QueueStatus, 'processing' | 'done' | 'error'> }
  | { type: 'processing'; id: string; assetId: string }
  | { type: 'done'; id: string; result: UploadResult }
  | { type: 'fail'; id: string; error: string }
  | { type: 'retry'; id: string }
  | { type: 'clearFinished' }
  | { type: 'remove'; id: string }

export const UPLOAD_CONCURRENCY = 3
/** Photos waiting on the server (TinyPNG + Sanity) at once. */
export const PROCESSING_CONCURRENCY = 4
export const MAX_FILES_PER_BATCH = 50

export function queueReducer(state: QueueItem[], action: QueueAction): QueueItem[] {
  switch (action.type) {
    case 'add': {
      const known = new Set(state.map((i) => i.id))
      const room = Math.max(0, MAX_FILES_PER_BATCH - state.filter((i) => i.status !== 'done' && i.status !== 'error').length)
      const fresh = action.items.filter((i) => !known.has(i.id)).slice(0, room)
      return [...state, ...fresh.map((i) => ({ ...i, status: 'waiting' as const }))]
    }
    case 'status':
      return state.map((i) => (i.id === action.id && i.status !== 'done' ? { ...i, status: action.status, error: undefined } : i))
    case 'processing':
      return state.map((i) =>
        i.id === action.id && i.status !== 'done' ? { ...i, status: 'processing', assetId: action.assetId, error: undefined } : i
      )
    case 'done':
      return state.map((i) => (i.id === action.id ? { ...i, status: 'done', result: action.result, error: undefined } : i))
    case 'fail':
      return state.map((i) => (i.id === action.id ? { ...i, status: 'error', error: action.error } : i))
    case 'retry':
      // A retry sends the file again (a failed record is left behind, unseen: it has no image).
      return state.map((i) => (i.id === action.id && i.status === 'error' ? { ...i, status: 'waiting', error: undefined, assetId: undefined } : i))
    case 'clearFinished':
      return state.filter((i) => i.status !== 'done')
    case 'remove':
      return state.filter((i) => i.id !== action.id)
  }
}

/**
 * The waiting items to start now: at most `concurrency` being sent, and never
 * more than `processing` in flight in total (sent + waiting on the server).
 */
export function nextToStart(state: QueueItem[], concurrency = UPLOAD_CONCURRENCY, processing = PROCESSING_CONCURRENCY): string[] {
  const sending = state.filter((i) => i.status === 'preparing' || i.status === 'uploading').length
  const onServer = state.filter((i) => i.status === 'processing').length
  const room = Math.max(0, Math.min(concurrency - sending, processing - onServer - sending))
  return state
    .filter((i) => i.status === 'waiting')
    .slice(0, room)
    .map((i) => i.id)
}

/** The server records to poll: rows waiting on the server. */
export function processingAssetIds(state: QueueItem[]): string[] {
  return state.filter((i) => i.status === 'processing' && i.assetId).map((i) => i.assetId!)
}

/** 0..1 for a progress bar. */
export function queueProgress(item: QueueItem): number {
  return { waiting: 0, preparing: 0.15, uploading: 0.45, processing: 0.8, done: 1, error: 1 }[item.status]
}

/** True once nothing is waiting or running. */
export function queueIdle(state: QueueItem[]): boolean {
  return state.every((i) => i.status === 'done' || i.status === 'error')
}

export const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp'

/**
 * Browser-side preparation (same rule as the cover step): send the original
 * when it fits; re-encode as high-quality JPEG only when planUpload says so.
 * Returns null when the browser cannot read the image.
 */
export async function prepareForUpload(file: File): Promise<File | null> {
  const supported = ACCEPTED_TYPES.split(',').includes(file.type)
  let bitmap: ImageBitmap | null = null
  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      bitmap = null
    }
  }
  try {
    const plan = planUpload({ size: file.size, type: file.type, width: bitmap?.width, height: bitmap?.height })
    if (plan.action === 'send') return file
    if (!bitmap || typeof document === 'undefined') return supported ? file : null
    const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`
    let last: Blob | null = null
    for (const attempt of plan.attempts) {
      const scale = Math.min(1, attempt.maxEdge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const g = canvas.getContext('2d')
      if (!g) break
      g.fillStyle = 'white'
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      last = await new Promise<Blob | null>((res) => canvas.toBlob(res, attempt.type, attempt.quality))
      if (last && planUpload({ size: last.size, type: attempt.type }).action === 'send') {
        return new File([last], name, { type: attempt.type })
      }
    }
    return last ? new File([last], name, { type: 'image/jpeg' }) : supported ? file : null
  } finally {
    bitmap?.close()
  }
}
