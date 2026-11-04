// Server-only. ── Scheduling — keep a one-off event's schedule in step with its published dates (ADR-038 C6a) ──
//
// Phase 1 cutover, step one. Readers already prefer the Supabase schedule
// (overlay.ts). From now on every PUBLISH of an event writes the schedule too,
// so the published Sanity dates and the schedule are always the same values:
//   - the Sanity dates stay the shadow copy (ADR-038 D10.3) — redeploying the
//     pre-cutover version shows correct dates with no reverse sync;
//   - editors keep today's flow (edit the draft, "Publish changes").
// Immediate, draft-free date changes (D4) arrive with the scheduling editor
// (Phase 2), where repeating series can't live in a Sanity draft anyway.
//
// Order and failure (D5): Sanity is committed FIRST; then the schedule. If the
// schedule write fails, the schedule is tombstoned so readers fall back to the
// (correct) Sanity dates, and the nightly reconcile recreates it. A visitor can
// therefore never see stale dates. Instructors already on the series are kept.

import { utcToLocal } from '@/lib/lifecycle/time'
import { isValidTimeZone } from '@/lib/time/zones'
import { createSupabaseScheduleStore, type ScheduleStore } from './store'
import { resolveSessionTimes, type SessionTimes } from './time'
import type { AttendanceMode, EventSchedule, SchedulePlace } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** What a published event says about its single session. */
export type PublishedEventFacts = {
  publicId: string
  startDate: string
  endDate: string | null
  attendanceMode: AttendanceMode
  place: SchedulePlace | null
  /** venue zone wins over the site zone (ADR-031 D7). */
  timeZone: string
  cancelled: boolean
}

export type SyncPlan =
  | { kind: 'none' }
  | { kind: 'save'; times: SessionTimes; expectedVersion: number | null; instructorPublicIds: string[]; status: 'scheduled' | 'cancelled' }

const sameTimes = (a: SessionTimes, s: EventSchedule) => {
  const o = s.occurrences[0]
  return !!o && s.series.timeZone === a.timeZone && o.startLocal === a.startLocal && (o.endLocal ?? null) === (a.endLocal ?? null)
}
const samePlace = (a: SchedulePlace | null, b: SchedulePlace | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Pure: what to write so the schedule matches the published event. */
export function planEventScheduleSync(facts: PublishedEventFacts, existing: EventSchedule | null): SyncPlan {
  const times = resolveSessionTimes({
    timeZone: facts.timeZone,
    startLocal: utcToLocal(facts.startDate, facts.timeZone),
    endLocal: facts.endDate ? utcToLocal(facts.endDate, facts.timeZone) : null,
  })
  const status = facts.cancelled ? 'cancelled' : 'scheduled'
  if (!existing) return { kind: 'save', times, expectedVersion: null, instructorPublicIds: [], status }
  const o = existing.occurrences[0]
  const unchanged =
    sameTimes(times, existing) &&
    samePlace(facts.place, existing.series.place) &&
    existing.series.attendanceMode === facts.attendanceMode &&
    o?.status === status
  if (unchanged) return { kind: 'none' }
  return { kind: 'save', times, expectedVersion: existing.series.version, instructorPublicIds: existing.series.instructorPublicIds, status }
}

/** Reads the facts of a published event document (already re-read from Sanity by the caller). */
export function factsOfPublishedEvent(
  doc: Record<string, unknown>,
  ctx: { siteTimeZone: string | null; venue: { publicId?: string | null; timeZone?: string | null } | null }
): PublishedEventFacts | null {
  const publicId = typeof doc.publicId === 'string' && UUID.test(doc.publicId) ? doc.publicId : null
  const startDate = typeof doc.startDate === 'string' && doc.startDate ? doc.startDate : null
  if (!publicId || !startDate) return null
  const zone = (ctx.venue?.timeZone && isValidTimeZone(ctx.venue.timeZone) ? ctx.venue.timeZone : null) ?? (ctx.siteTimeZone && isValidTimeZone(ctx.siteTimeZone) ? ctx.siteTimeZone : null)
  if (!zone) return null
  const mode: AttendanceMode = doc.attendanceMode === 'online' || doc.attendanceMode === 'mixed' ? doc.attendanceMode : 'inPerson'
  const raw = (doc.place ?? null) as { kind?: unknown; locationKey?: unknown } | null
  let place: SchedulePlace | null = null
  if (mode !== 'online' && raw) {
    if (raw.kind === 'location' && typeof raw.locationKey === 'string' && raw.locationKey) place = { kind: 'location', key: raw.locationKey }
    else if (raw.kind === 'venue' && typeof ctx.venue?.publicId === 'string' && UUID.test(ctx.venue.publicId)) place = { kind: 'venue', venuePublicId: ctx.venue.publicId }
  }
  return {
    publicId,
    startDate,
    endDate: typeof doc.endDate === 'string' && doc.endDate ? doc.endDate : null,
    attendanceMode: mode,
    place,
    timeZone: zone,
    cancelled: doc.eventStatus === 'cancelled',
  }
}

export type SyncDeps = { store?: Pick<ScheduleStore, 'saveOneOff' | 'setOccurrenceStatus' | 'removeEventSchedule' | 'schedulesForEvents'> }
export type SyncResult = { ok: true; changed: boolean } | { ok: false; fellBack: boolean }

/**
 * Makes the schedule match the published event. Never throws: on failure it
 * tombstones the schedule (readers fall back to the Sanity dates) and reports.
 */
export async function syncEventSchedule(projectId: string, facts: PublishedEventFacts, actorId: string | null, deps: SyncDeps = {}): Promise<SyncResult> {
  const store = deps.store ?? createSupabaseScheduleStore()
  try {
    const existing = (await store.schedulesForEvents(projectId, [facts.publicId])).get(facts.publicId) ?? null
    const plan = planEventScheduleSync(facts, existing)
    if (plan.kind === 'none') return { ok: true, changed: false }
    const saved = await store.saveOneOff({
      projectId,
      eventPublicId: facts.publicId,
      times: plan.times,
      place: facts.place,
      attendanceMode: facts.attendanceMode,
      instructorPublicIds: plan.instructorPublicIds,
      expectedVersion: plan.expectedVersion,
      actorId,
      origin: 'dashboard',
    })
    const after = (await store.schedulesForEvents(projectId, [facts.publicId])).get(facts.publicId)
    const occ = after?.occurrences.find((o) => o.id === saved.occurrenceId)
    if (occ && occ.status !== plan.status) await store.setOccurrenceStatus(projectId, occ.id, plan.status, occ.version)
    return { ok: true, changed: true }
  } catch (error) {
    console.error('[scheduling] sync failed, falling back to Sanity dates', { projectId, publicId: facts.publicId, error: (error as Error)?.message })
    try {
      await store.removeEventSchedule(projectId, facts.publicId)
      return { ok: false, fellBack: true }
    } catch {
      return { ok: false, fellBack: false }
    }
  }
}
