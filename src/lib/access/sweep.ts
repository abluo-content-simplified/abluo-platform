/**
 * Site Access — daily clean-up of temporary files (ADR-040 §10, B2.4).
 *
 *   1. pending uploads past their expiry → 'expired', object queued;
 *   2. queued objects (replaced files, failed and expired uploads) are removed
 *      from the private bucket, in batches.
 *
 * Never deletes an active document: the database hands out only paths that NO
 * document file row points at (site_access_trash_batch), and forgets a path
 * only if it is still unreferenced (site_access_trash_done). Documents
 * themselves are never deleted (archive only). Visitor sessions and rate-limit
 * rows are NOT purged here (retention is a separate, later decision).
 */
import type { SiteAccessFiles } from './file-storage'
import type { SiteAccessStore } from './store'

export type SweepResult = { expiredUploads: number; removedObjects: number; failedBatches: number }

export async function sweepSiteAccessFiles(store: SiteAccessStore, files: SiteAccessFiles, opts: { batch?: number; maxBatches?: number } = {}): Promise<SweepResult> {
  const batch = opts.batch ?? 100
  const maxBatches = opts.maxBatches ?? 20
  const expiredUploads = await store.expireUploads(500)
  let removedObjects = 0
  let failedBatches = 0
  for (let i = 0; i < maxBatches; i++) {
    const rows = await store.trashBatch(batch)
    if (rows.length === 0) break
    const paths = [...new Set(rows.map((r) => r.storagePath))]
    try {
      const gone = await files.remove(paths)
      removedObjects += await store.trashDone(gone)
    } catch {
      failedBatches++
      break // storage unhappy: try again tomorrow, nothing is lost
    }
    if (rows.length < batch) break
  }
  return { expiredUploads, removedObjects, failedBatches }
}
