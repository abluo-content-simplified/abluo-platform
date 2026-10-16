/**
 * The dashboard's upload store (ADR-035 slice 2) — one per dashboard layout,
 * so uploads keep going when the person moves to another screen.
 *
 * Plain TypeScript, no React: the queue (gallery-upload-queue.ts) plus the
 * work around it — prepare in the browser, send with `background=1`, poll
 * the record until it is ready. Screens that add photos subscribe as an
 * `owner`; a photo that lands while its owner is gone stays in the Media
 * Library and is counted as `orphanLanded` (the layout tells the person).
 *
 * Server access is injected (`api`), so the store is testable and the same
 * code serves the client dashboard and the admin.
 */
import { nextToStart, processingAssetIds, queueReducer, type QueueAction, type QueueItem } from '@/lib/client/gallery-upload-queue'

export type UploadScope = 'gallery' | 'media' | 'admin'

/** What a finished upload hands to its screen. */
export type LandedPhoto = {
  assetId: string
  url: string
  name: string
  optimized: boolean
  bytesBefore: number | null
  bytesAfter: number | null
}

type UploadResponse =
  | ({ ok: true; status: 'processing' | 'ready' } & LandedPhoto)
  | { ok: false; error: string }
type StatusResponse =
  | { ok: true; items: Array<{ assetId: string; status: 'processing' | 'ready' | 'failed' } & LandedPhoto> }
  | { ok: false; error: string }

export type UploadApi = {
  upload: (scope: UploadScope, form: FormData) => Promise<UploadResponse>
  status: (scope: UploadScope, input: { projectSlug: string; assetIds: string[] }) => Promise<StatusResponse>
}

export type UploadListener = {
  onLanded: (photo: LandedPhoto, queueId: string) => void
  onSettled?: (queueId: string, landed: LandedPhoto | null) => void
}

type Meta = { owner: string; projectSlug: string; scope: UploadScope }

export type UploadStoreDeps = {
  api: UploadApi
  /** Browser preparation (planUpload); null = unusable file. */
  prepare: (file: File) => Promise<File | null>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  createPreview?: (file: File) => string | undefined
  revokePreview?: (url: string) => void
}

/** Finished rows stay this long ("✓ Optimised …") before they go. */
export const DONE_LINGER_MS = 4000
export const POLL_MS = 1500
/** A record still processing after this is reported as failed (Retry sends it again). */
export const PROCESSING_GIVE_UP_MS = 2 * 60 * 1000

export class UploadStore {
  private items: QueueItem[] = []
  private readonly meta = new Map<string, Meta>()
  private readonly files = new Map<string, File>()
  private readonly since = new Map<string, number>()
  private readonly subs = new Set<() => void>()
  private readonly listeners = new Map<string, { primary?: UploadListener; fallback?: UploadListener }>()
  private pollTimer: unknown = null
  private orphans = 0
  private seq = 0
  private disposed = false

  constructor(private readonly deps: UploadStoreDeps) {}

  // ── React glue (useSyncExternalStore) ────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }
  getSnapshot = () => this.items
  /** Photos that finished while their screen was gone (they are in the Media Library). */
  getOrphanLanded = () => this.orphans
  clearOrphanLanded() {
    if (!this.orphans) return
    this.orphans = 0
    this.emit()
  }

  /**
   * A screen that adds photos. `primary` = the component showing the queue
   * (Add Photos); `fallback` = its longer-lived parent (a wizard), which takes
   * over when the primary is gone — so a photo still lands in the item when
   * the person moved to the next step. Returns the unsubscribe.
   */
  listen(owner: string, listener: UploadListener, role: 'primary' | 'fallback' = 'primary') {
    const slot = this.listeners.get(owner) ?? {}
    slot[role] = listener
    this.listeners.set(owner, slot)
    this.emit()
    return () => {
      const now = this.listeners.get(owner)
      if (now?.[role] !== listener) return
      delete now[role]
      if (!now.primary && !now.fallback) this.listeners.delete(owner)
      this.emit()
    }
  }
  hasListener(owner: string) {
    return this.listeners.has(owner)
  }
  private listenerOf(owner: string | undefined) {
    const slot = owner ? this.listeners.get(owner) : undefined
    return slot?.primary ?? slot?.fallback
  }
  ownerOf(id: string) {
    return this.meta.get(id)?.owner
  }

  /** Not finished yet (optionally: for one owner). */
  inFlight(owner?: string) {
    return this.items.filter((i) => i.status !== 'done' && i.status !== 'error' && (!owner || this.meta.get(i.id)?.owner === owner)).length
  }
  /** Bytes still only in this tab (closing it would lose them). */
  unsent() {
    return this.items.some((i) => i.status === 'waiting' || i.status === 'preparing' || i.status === 'uploading')
  }

  enqueue(list: File[], meta: Meta): string[] {
    const items = list.map((file) => {
      const id = `u${++this.seq}-${file.size}-${file.lastModified}`
      this.files.set(id, file)
      this.meta.set(id, meta)
      return { id, name: file.name, size: file.size, preview: this.deps.createPreview?.(file) }
    })
    this.apply({ type: 'add', items })
    const kept = new Set(this.items.map((q) => q.id))
    for (const i of items) if (!kept.has(i.id)) this.forget(i.id, i.preview)
    this.pump()
    return items.filter((i) => kept.has(i.id)).map((i) => i.id)
  }

  retry(id: string) {
    this.apply({ type: 'retry', id })
    this.pump()
  }
  dismiss(id: string) {
    const preview = this.items.find((i) => i.id === id)?.preview
    this.apply({ type: 'remove', id })
    this.forget(id, preview)
  }

  dispose() {
    this.disposed = true
    if (this.pollTimer) this.deps.clearTimer?.(this.pollTimer)
    for (const i of this.items) if (i.preview) this.deps.revokePreview?.(i.preview)
  }

  // ── Internals ───────────────────────────────────────────────────────────
  private emit() {
    for (const fn of this.subs) fn()
  }
  private apply(action: QueueAction) {
    this.items = queueReducer(this.items, action)
    this.emit()
  }
  private forget(id: string, preview?: string) {
    if (preview) this.deps.revokePreview?.(preview)
    this.files.delete(id)
    this.meta.delete(id)
    this.since.delete(id)
  }
  private now() {
    return (this.deps.now ?? Date.now)()
  }
  private later(fn: () => void, ms: number) {
    return (this.deps.setTimer ?? ((f: () => void, m: number) => setTimeout(f, m)))(fn, ms)
  }

  private pump() {
    if (this.disposed) return
    for (const id of nextToStart(this.items)) {
      this.apply({ type: 'status', id, status: 'preparing' })
      void this.run(id)
    }
  }

  private land(id: string, r: LandedPhoto) {
    this.since.delete(id)
    this.apply({ type: 'done', id, result: { assetId: r.assetId, url: r.url, optimized: r.optimized, bytesBefore: r.bytesBefore ?? 0, bytesAfter: r.bytesAfter ?? 0 } })
    this.files.delete(id)
    const listener = this.listenerOf(this.meta.get(id)?.owner)
    if (listener) {
      listener.onLanded(r, id)
      listener.onSettled?.(id, r)
    } else {
      this.orphans += 1
      this.emit()
    }
    this.later(() => this.dismiss(id), DONE_LINGER_MS)
  }

  private fail(id: string, error: string) {
    this.since.delete(id)
    this.apply({ type: 'fail', id, error })
    this.listenerOf(this.meta.get(id)?.owner)?.onSettled?.(id, null)
  }

  private async run(id: string) {
    const file = this.files.get(id)
    const meta = this.meta.get(id)
    try {
      if (!file || !meta) throw new Error('gone')
      const prepared = await this.deps.prepare(file)
      if (!prepared) return this.fail(id, 'unsupported_type')
      this.apply({ type: 'status', id, status: 'uploading' })
      const form = new FormData()
      form.set('projectSlug', meta.projectSlug)
      form.set('file', prepared)
      form.set('background', '1')
      const r = await this.deps.api.upload(meta.scope, form)
      if (!r.ok) return this.fail(id, r.error)
      if (r.status === 'ready') return this.land(id, r)
      this.since.set(id, this.now())
      this.apply({ type: 'processing', id, assetId: r.assetId })
      this.schedulePoll()
    } catch {
      this.fail(id, 'failed')
    } finally {
      this.pump()
    }
  }

  private schedulePoll() {
    if (this.pollTimer || this.disposed) return
    this.pollTimer = this.later(() => void this.poll(), POLL_MS)
  }

  /** One status call per project + scope for the rows waiting on the server. */
  async poll() {
    this.pollTimer = null
    const waiting = this.items.filter((i) => i.status === 'processing' && i.assetId)
    if (!waiting.length) return
    const groups = new Map<string, { scope: UploadScope; projectSlug: string; ids: string[] }>()
    for (const q of waiting) {
      const m = this.meta.get(q.id)
      if (!m) continue
      const key = `${m.scope}|${m.projectSlug}`
      const g = groups.get(key) ?? { scope: m.scope, projectSlug: m.projectSlug, ids: [] }
      g.ids.push(q.assetId!)
      groups.set(key, g)
    }
    for (const g of groups.values()) {
      try {
        const r = await this.deps.api.status(g.scope, { projectSlug: g.projectSlug, assetIds: g.ids })
        if (!r.ok) continue
        const byAsset = new Map(r.items.map((i) => [i.assetId, i]))
        for (const q of this.items) {
          if (q.status !== 'processing' || !q.assetId || !g.ids.includes(q.assetId)) continue
          const s = byAsset.get(q.assetId)
          if (s?.status === 'ready') this.land(q.id, s)
          else if (s?.status === 'failed') this.fail(q.id, 'failed')
          else if (this.now() - (this.since.get(q.id) ?? this.now()) > PROCESSING_GIVE_UP_MS) this.fail(q.id, 'failed')
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
    }
    this.pump()
    if (processingAssetIds(this.items).length) this.schedulePoll()
  }
}
