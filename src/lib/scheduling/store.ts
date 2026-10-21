// Server-only: service role; never import from a client component.
// ── Scheduling — the Supabase store (ADR-038, migration 043) ──────────────────
//
// The ONLY code that talks to event_series / event_occurrences. Every read and
// write is scoped by project_id (the tables are server-only; isolation is this
// file's job, proven by tests). Writes go through the migration-043 functions,
// so each change is one Postgres transaction with optimistic concurrency.
// Authorisation (who may call this for which project) is the caller's job —
// the event API checks permissions and capabilities before reaching here.

import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { normaliseLocal, type SessionTimes } from './time'
import {
  ScheduleError,
  type AttendanceMode,
  type EventSchedule,
  type Occurrence,
  type OccurrenceStatus,
  type SchedulePlace,
  type Series,
} from './types'

type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

const REASON = 'ADR-038 event scheduling: server-only event_series / event_occurrences (migration 043)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_WINDOW_ROWS = 500

export type SaveOneOffInput = {
  projectId: string
  eventPublicId: string
  times: SessionTimes
  place: SchedulePlace | null
  attendanceMode: AttendanceMode
  instructorPublicIds?: string[]
  /** null = create (refused when one exists); otherwise the version the editor loaded. */
  expectedVersion: number | null
  actorId?: string | null
  origin?: 'dashboard' | 'migrated'
}

export type ScheduleStore = {
  saveOneOff(input: SaveOneOffInput): Promise<{ seriesId: string; occurrenceId: string; version: number }>
  setOccurrenceStatus(projectId: string, occurrenceId: string, status: OccurrenceStatus, expectedVersion: number): Promise<number>
  /** Tombstones every schedule of an event (its Sanity document was deleted). */
  removeEventSchedule(projectId: string, eventPublicId: string): Promise<number>
  /** The live schedules of some events of ONE project, keyed by event publicId (events without one are absent). */
  schedulesForEvents(projectId: string, eventPublicIds: string[]): Promise<Map<string, EventSchedule>>
  /** Sessions of ONE project that are not over before `from` and start before `to`, earliest first. */
  occurrencesInWindow(projectId: string, window: { from: string; to?: string; eventPublicIds?: string[]; limit?: number }): Promise<Occurrence[]>
}

function assertUuid(value: string, what: string) {
  if (!UUID.test(value)) throw new ScheduleError('invalid', `Not a valid ${what}.`)
}

function mapDbError(error: { code?: string; message?: string } | null | undefined): ScheduleError {
  const code = error?.code
  // AB409 since migration 044 (40001 made the Data API hang); 40001 kept for safety.
  if (code === 'AB409' || code === '40001') return new ScheduleError('conflict', 'This schedule was changed elsewhere.')
  if (code === 'P0002') return new ScheduleError('not_found', 'This schedule no longer exists.')
  if (code === '23514' || code === '23503' || code === '22023' || code === '22P02' || code === '22007' || code === '22008') {
    return new ScheduleError('invalid', 'The schedule is not valid.')
  }
  return new ScheduleError('unavailable', 'Scheduling is unavailable right now.')
}

const place = (v: unknown): SchedulePlace | null => {
  const p = v as { kind?: unknown; key?: unknown; venuePublicId?: unknown } | null
  if (p?.kind === 'location' && typeof p.key === 'string') return { kind: 'location', key: p.key }
  if (p?.kind === 'venue' && typeof p.venuePublicId === 'string') return { kind: 'venue', venuePublicId: p.venuePublicId }
  return null
}
const mode = (v: unknown): AttendanceMode => (v === 'online' || v === 'mixed' ? v : 'inPerson')
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const local = (v: unknown) => normaliseLocal(v) ?? ''
const iso = (v: unknown) => (typeof v === 'string' && v ? new Date(v).toISOString() : null)

type SeriesRow = Record<string, unknown>
type OccurrenceRow = Record<string, unknown>

function seriesOf(r: SeriesRow): Series {
  return {
    id: String(r.id),
    eventPublicId: String(r.event_public_id),
    timeZone: String(r.time_zone),
    startLocal: local(r.start_local),
    endLocal: r.end_local ? local(r.end_local) : null,
    place: place(r.place),
    attendanceMode: mode(r.attendance_mode),
    instructorPublicIds: ids(r.instructor_public_ids),
    rule: typeof r.rule === 'string' ? r.rule : null,
    origin: r.origin === 'migrated' ? 'migrated' : 'dashboard',
    version: Number(r.version) || 1,
  }
}

/** A session with the series defaults applied where it does not override them. */
function occurrenceOf(r: OccurrenceRow, s: Series): Occurrence {
  return {
    id: String(r.id),
    seriesId: s.id,
    eventPublicId: s.eventPublicId,
    startLocal: local(r.start_local),
    endLocal: r.end_local ? local(r.end_local) : null,
    timeZone: String(r.time_zone),
    startsAt: iso(r.starts_at) ?? '',
    endsAt: iso(r.ends_at),
    status: r.status === 'cancelled' ? 'cancelled' : 'scheduled',
    place: r.place_override ? place(r.place_override) : s.place,
    attendanceMode: r.attendance_override ? mode(r.attendance_override) : s.attendanceMode,
    instructorPublicIds: Array.isArray(r.instructor_override) ? ids(r.instructor_override) : s.instructorPublicIds,
    note: r.note && typeof r.note === 'object' ? (r.note as Record<string, string>) : null,
    version: Number(r.version) || 1,
  }
}

const SERIES_COLUMNS = 'id, event_public_id, time_zone, start_local, end_local, place, attendance_mode, instructor_public_ids, rule, origin, version'
const OCCURRENCE_COLUMNS = 'id, series_id, start_local, end_local, time_zone, starts_at, ends_at, status, place_override, attendance_override, instructor_override, note, version'

export function createSupabaseScheduleStore(dbOverride?: Db): ScheduleStore {
  const withDb = <T>(fn: (db: Db) => Promise<T>): Promise<T> =>
    dbOverride ? fn(dbOverride) : runAsTrustedSystemOperation(REASON, (sb) => fn(sb as unknown as Db))

  async function seriesByIds(db: Db, projectId: string, seriesIds: string[]): Promise<Map<string, Series>> {
    if (!seriesIds.length) return new Map()
    const { data, error } = await db
      .from('event_series')
      .select(SERIES_COLUMNS)
      .eq('project_id', projectId)
      .in('id', seriesIds)
      .is('removed_at', null)
    if (error) throw mapDbError(error)
    return new Map((data ?? []).map((r: SeriesRow) => [String(r.id), seriesOf(r)]))
  }

  return {
    saveOneOff: (input) =>
      withDb(async (db) => {
        assertUuid(input.projectId, 'project')
        assertUuid(input.eventPublicId, 'event id')
        for (const id of input.instructorPublicIds ?? []) assertUuid(id, 'host id')
        if (input.place?.kind === 'venue') assertUuid(input.place.venuePublicId, 'venue id')
        const t = input.times
        const { data, error } = await db.rpc('event_schedule_save_one_off', {
          p_project_id: input.projectId,
          p_event_public_id: input.eventPublicId,
          p_time_zone: t.timeZone,
          p_start_local: t.startLocal,
          p_end_local: t.endLocal,
          p_starts_at: t.startsAt,
          p_ends_at: t.endsAt,
          p_place: input.place,
          p_attendance_mode: input.attendanceMode,
          p_instructors: input.instructorPublicIds ?? [],
          p_expected_version: input.expectedVersion,
          p_actor: input.actorId ?? null,
          p_origin: input.origin ?? 'dashboard',
        })
        if (error) throw mapDbError(error)
        const row = (Array.isArray(data) ? data[0] : data) as { series_id?: string; occurrence_id?: string; version?: number } | undefined
        if (!row?.series_id || !row.occurrence_id) throw new ScheduleError('unavailable', 'Scheduling did not answer.')
        return { seriesId: row.series_id, occurrenceId: row.occurrence_id, version: Number(row.version) }
      }),

    setOccurrenceStatus: (projectId, occurrenceId, status, expectedVersion) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(occurrenceId, 'session id')
        const { data, error } = await db.rpc('event_occurrence_set_status', {
          p_project_id: projectId,
          p_occurrence_id: occurrenceId,
          p_status: status,
          p_expected_version: expectedVersion,
        })
        if (error) throw mapDbError(error)
        return Number(data)
      }),

    removeEventSchedule: (projectId, eventPublicId) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(eventPublicId, 'event id')
        const { data, error } = await db.rpc('event_schedule_remove', { p_project_id: projectId, p_event_public_id: eventPublicId })
        if (error) throw mapDbError(error)
        return Number(data) || 0
      }),

    schedulesForEvents: (projectId, eventPublicIds) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        const wanted = [...new Set(eventPublicIds.filter((id) => UUID.test(id)))]
        const out = new Map<string, EventSchedule>()
        if (!wanted.length) return out
        const { data: sRows, error: sErr } = await db
          .from('event_series')
          .select(SERIES_COLUMNS)
          .eq('project_id', projectId)
          .in('event_public_id', wanted)
          .is('removed_at', null)
        if (sErr) throw mapDbError(sErr)
        const series = (sRows ?? []).map((r: SeriesRow) => seriesOf(r))
        if (!series.length) return out
        const { data: oRows, error: oErr } = await db
          .from('event_occurrences')
          .select(OCCURRENCE_COLUMNS)
          .eq('project_id', projectId)
          .in('series_id', series.map((s: Series) => s.id))
          .is('removed_at', null)
          .order('starts_at', { ascending: true })
        if (oErr) throw mapDbError(oErr)
        for (const s of series) {
          const occurrences = (oRows ?? []).filter((r: OccurrenceRow) => r.series_id === s.id).map((r: OccurrenceRow) => occurrenceOf(r, s))
          // Phase 1: one schedule per event (the one-off series). Phase 2 merges several series.
          const existing = out.get(s.eventPublicId)
          if (existing) existing.occurrences.push(...occurrences)
          else out.set(s.eventPublicId, { series: s, occurrences })
        }
        return out
      }),

    occurrencesInWindow: (projectId, window) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        const from = iso(window.from)
        if (!from) throw new ScheduleError('invalid', 'Not a date.')
        const to = window.to ? iso(window.to) : null
        let q = db
          .from('event_occurrences')
          .select(OCCURRENCE_COLUMNS)
          .eq('project_id', projectId)
          .is('removed_at', null)
          // Not over before `from`: ends after it, or (no end) starts after it.
          .or(`ends_at.gte.${from},and(ends_at.is.null,starts_at.gte.${from})`)
        if (to) q = q.lt('starts_at', to)
        if (window.eventPublicIds) {
          const wanted = window.eventPublicIds.filter((id) => UUID.test(id))
          if (!wanted.length) return []
          q = q.in('event_public_id', wanted)
        }
        const { data, error } = await q.order('starts_at', { ascending: true }).limit(Math.min(window.limit ?? MAX_WINDOW_ROWS, MAX_WINDOW_ROWS))
        if (error) throw mapDbError(error)
        const rows = (data ?? []) as OccurrenceRow[]
        const series = await seriesByIds(db, projectId, [...new Set(rows.map((r) => String(r.series_id)))])
        return rows.flatMap((r) => {
          const s = series.get(String(r.series_id))
          return s ? [occurrenceOf(r, s)] : [] // a session whose series was removed is not shown
        })
      }),
  }
}
