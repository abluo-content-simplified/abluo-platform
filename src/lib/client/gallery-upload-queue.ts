/**
 * The gallery's multi-file upload queue — pure state + browser preparation.
 *
 * Each file goes waiting → preparing (browser pre-resize only when needed,
 * see planUpload) → uploading → compressing (TinyPNG on the server; the UI
 * switches once the body has had time to arrive, see `uploadEstimateMs`) →
 * done | error. A small number run at once so
 * the server (TinyPNG + Sanity) and the per-user upload cap are not hammered.
 * Progress is per step (server actions report no byte progress).
 */
import { planUpload } from '@/lib/client/upload-plan'

export type QueueStatus = 'waiting' | 'preparing' | 'uploading' | 'compressing' | 'done' | 'error'

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
  result?: UploadResult
  /** An error code (MediaActionError-like) for the UI to translate. */
  error?: string
}

export type QueueAction =
  | { type: 'add'; items: { id: string; name: string; size: number }[] }
  | { type: 'status'; id: string; status: Exclude<QueueStatus, 'done' | 'error'> }
  | { type: 'done'; id: string; result: UploadResult }
  | { type: 'fail'; id: string; error: string }
  | { type: 'retry'; id: string }
  | { type: 'clearFinished' }
  | { type: 'remove'; id: string }

export const UPLOAD_CONCURRENCY = 2
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
    case 'done':
      return state.map((i) => (i.id === action.id ? { ...i, status: 'done', result: action.result, error: undefined } : i))
    case 'fail':
      return state.map((i) => (i.id === action.id ? { ...i, status: 'error', error: action.error } : i))
    case 'retry':
      return state.map((i) => (i.id === action.id && i.status === 'error' ? { ...i, status: 'waiting', error: undefined } : i))
    case 'clearFinished':
      return state.filter((i) => i.status !== 'done')
    case 'remove':
      return state.filter((i) => i.id !== action.id)
  }
}

/** The waiting items to start now, keeping at most `concurrency` in flight. */
export function nextToStart(state: QueueItem[], concurrency = UPLOAD_CONCURRENCY): string[] {
  const busy = state.filter((i) => i.status === 'preparing' || i.status === 'uploading' || i.status === 'compressing').length
  return state
    .filter((i) => i.status === 'waiting')
    .slice(0, Math.max(0, concurrency - busy))
    .map((i) => i.id)
}

/** 0..1 for a progress bar. */
export function queueProgress(item: QueueItem): number {
  return { waiting: 0, preparing: 0.15, uploading: 0.5, compressing: 0.85, done: 1, error: 1 }[item.status]
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

/** Rough time for the browser to send `bytes` (≥ 0.6 s) — when the UI starts saying "Compressing…". */
export function uploadEstimateMs(bytes: number, bytesPerSecond = 1_500_000): number {
  return Math.max(600, Math.round((bytes / bytesPerSecond) * 1000))
}
