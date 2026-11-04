// Server-only. ── Scheduling — a removed event's schedule is tombstoned (ADR-038 C6) ──
//
// Called by the Sanity removals webhook (already signature-verified) for every
// deleted or unpublished published document. Only `event`s with a valid
// publicId of a known project are acted on; anything else is ignored. Never
// throws: the partner tombstone must not depend on scheduling, and the nightly
// reconcile reports a schedule left behind.

import { projectIdForSlug } from './read.server'
import { createSupabaseScheduleStore, type ScheduleStore } from './store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function removeScheduleForRemovedEvent(
  payload: unknown,
  deps: { store?: Pick<ScheduleStore, 'removeEventSchedule'>; resolveProject?: (slug: string) => Promise<string | null> } = {}
): Promise<boolean> {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  if ((p.type ?? p._type) !== 'event') return false
  if (typeof p.publicId !== 'string' || !UUID.test(p.publicId) || typeof p.projectSlug !== 'string' || !p.projectSlug) return false
  try {
    const projectId = await (deps.resolveProject ?? projectIdForSlug)(p.projectSlug)
    if (!projectId) return false
    await (deps.store ?? createSupabaseScheduleStore()).removeEventSchedule(projectId, p.publicId)
    return true
  } catch (error) {
    console.error('[scheduling] could not tombstone the schedule of a removed event', { publicId: p.publicId, error: (error as Error)?.message })
    return false
  }
}
