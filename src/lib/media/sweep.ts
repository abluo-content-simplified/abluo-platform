/**
 * Daily clean-up of background uploads (ADR-035 slice 2).
 *
 * 1. A record still `processing` after an hour will never finish (the
 *    function that held its bytes is long gone): mark it `failed`.
 * 2. A `failed` record has no image and is shown nowhere (every list filters
 *    `defined(image.asset)`); after a week, and only when nothing references
 *    it, delete it. These are upload placeholders, not editorial content, so
 *    the archive-before-delete rules don't apply.
 *
 * Runs across all projects with the write client — called only from the cron
 * route, behind CRON_SECRET.
 */
export const SWEEP_STUCK_AFTER_MS = 60 * 60 * 1000
export const SWEEP_DELETE_FAILED_AFTER_MS = 7 * 24 * 60 * 60 * 1000
/** Upper bound per run (a run that hits it simply continues tomorrow). */
export const SWEEP_LIMIT = 200

type SweepClient = {
  fetch: <T>(query: string, params: Record<string, unknown>) => Promise<T>
  patch: (id: string) => { set: (v: Record<string, unknown>) => { commit: () => Promise<unknown> } }
  delete: (id: string) => Promise<unknown>
}

export async function sweepMediaUploads(client: SweepClient, now = new Date()): Promise<{ markedFailed: number; deleted: number }> {
  const stuckBefore = new Date(now.getTime() - SWEEP_STUCK_AFTER_MS).toISOString()
  const failedBefore = new Date(now.getTime() - SWEEP_DELETE_FAILED_AFTER_MS).toISOString()

  const stuck = await client.fetch<string[]>(
    `*[_type == "mediaAsset" && processing.status == "processing" && processing.startedAt < $before && !(_id in path("drafts.**"))][0...${SWEEP_LIMIT}]._id`,
    { before: stuckBefore }
  )
  let markedFailed = 0
  for (const id of stuck ?? []) {
    try {
      await client.patch(id).set({ 'processing.status': 'failed', 'processing.finishedAt': now.toISOString() }).commit()
      markedFailed += 1
    } catch {
      // Tomorrow's run tries again.
    }
  }

  const failed = await client.fetch<string[]>(
    `*[_type == "mediaAsset" && processing.status == "failed" && !defined(image.asset)
        && coalesce(processing.finishedAt, _updatedAt) < $before
        && count(*[references(^._id)]) == 0 && !(_id in path("drafts.**"))][0...${SWEEP_LIMIT}]._id`,
    { before: failedBefore }
  )
  let deleted = 0
  for (const id of failed ?? []) {
    try {
      await client.delete(id)
      deleted += 1
    } catch {
      // Tomorrow's run tries again.
    }
  }
  return { markedFailed, deleted }
}
