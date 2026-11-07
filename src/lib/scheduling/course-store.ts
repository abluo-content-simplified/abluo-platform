// Server-only: service role; never import from a client component.
// ── Scheduling — the course (weekly class) store (ADR-038 Amendment A, migration 064) ──
//
// The ONLY code that talks to schedule_editions / schedule_closures /
// schedule_meeting_rooms and to the course rows of event_series /
// event_occurrences. Same rules as store.ts: every read and write is scoped by
// project_id; multi-row changes go through the migration-064 functions (one
// Postgres transaction, optimistic concurrency, conflicts = AB409).
//
// Generation: the DATABASE never expands a rule. `syncSeries` expands it here
// (recurrence.ts, DST-safe) and hands the full set to schedule_occurrences_sync,
// which inserts missing sessions, moves the times of unedited ones and removes
// the ones no longer in the set. Sessions edited individually (is_modified) are
// never touched; sync reports the ones that fell outside the rule.
//
// Meeting rooms hold join links and passcodes: they are read here only for
// authenticated dashboard code or Access-protected pages, and are NEVER part of
// a series or occurrence result.
// Authorisation and ownership/place/people checks are the caller's job —
// course-guarded.server.ts is the only write entry for dashboard actions.

import { isValidTimeZone } from '@/lib/time/zones'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { addDays, coerceClassRule, dayNumber, expandRule, formatClassRule, parseClassRule, nextStartDate, previousRuleDate, ruleWeekdays, MAX_WEEK_INTERVAL, type ClassRule } from './recurrence'
import { localOf, normaliseLocal, resolveSessionTimes, type SessionTimes } from './time'
import {
  ScheduleError,
  type AttendanceMode,
  type ClassOccurrence,
  type ClassSeries,
  type MeetingRoom,
  type OccurrenceStatus,
  type ScheduleClosure,
  type ScheduleEdition,
  type ScheduleOwnerType,
  type SchedulePlace,
} from './types'

type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

const REASON = 'ADR-038 A / ADR-045 course schedules: server-only schedule_* tables and course rows of event_series (migration 064)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCATION_KEY = /^[a-z0-9_-]{1,64}$/
const LANGUAGE = /^[a-z]{2}$/
const LOCALE_KEY = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_WINDOW_ROWS = 1000
const MAX_INSTRUCTORS = 50
const OPEN_ENDED_DAYS = 366

// ── Inputs ───────────────────────────────────────────────────────────────────

export type SaveClassInput = {
  projectId: string
  /** null = create. */
  seriesId: string | null
  ownerType?: ScheduleOwnerType
  ownerPublicId: string
  editionId?: string | null
  timeZone: string
  /** How the class repeats (a preset). Omitted = the legacy weekly form below. */
  repeat?: ClassRule
  /** Legacy: weekly on ONE weekday (1 = Monday … 7 = Sunday), every `interval` weeks. Used only when `repeat` is omitted. */
  weekday?: number
  interval?: number
  startTime: string
  endTime?: string | null
  /** The class's first session: must be a date the repeat produces (for "once", its one date). */
  startsOn: string
  /** Last possible date, optional (empty = until the term ends / open). Must be a date the repeat produces; ignored for "once" (stored equal to `startsOn`). */
  endsOn?: string | null
  place: SchedulePlace | null
  attendanceMode: AttendanceMode
  instructorPublicIds?: string[]
  languages?: string[]
  meetingRoomId?: string | null
  /** Required when updating; must be null when creating. */
  expectedVersion: number | null
  actorId?: string | null
}

export type UpdateOccurrenceInput = {
  projectId: string
  occurrenceId: string
  expectedVersion: number
  status?: OccurrenceStatus
  /** Substitute hosts for this date ([] = nobody). Omit to leave. */
  instructorPublicIds?: string[]
  /** Back to "same as the class". */
  clearInstructors?: boolean
  /** New time for this date. The end may be null. */
  times?: { timeZone: string; startLocal: string; endLocal?: string | null }
  /** Short note per language. Omit to leave. */
  note?: Record<string, string>
  clearNote?: boolean
  /** A different place for this date only (migration 065). Omit to leave. */
  place?: SchedulePlace
  /** Back to the class's own place. */
  clearPlace?: boolean
}

export type SyncResult = {
  inserted: number
  updated: number
  removed: number
  /** True when the 400-dates cap stopped the expansion. */
  truncated: boolean
  /** Edited sessions (is_modified) at/after the sync start that the rule no longer produces: kept, for the editor to review. */
  modifiedOutsideRule: string[]
}

export type SaveEditionInput = {
  projectId: string
  id?: string | null
  ownerType?: ScheduleOwnerType | null
  ownerPublicId?: string | null
  label: Record<string, string>
  startsOn: string
  endsOn: string
  timeZone: string
  expectedVersion?: number | null
}

export type SaveClosureInput = {
  projectId: string
  id?: string | null
  editionId?: string | null
  startsOn: string
  endsOn: string
  label: Record<string, string>
}

export type SaveMeetingRoomInput = {
  projectId: string
  id?: string | null
  label: string
  joinUrl?: string | null
  meetingId?: string | null
  passcode?: string | null
  note?: Record<string, string> | null
  expectedVersion?: number | null
}

export type ClassWindow = {
  from: string
  to?: string
  ownerType?: ScheduleOwnerType
  ownerPublicIds?: string[]
  limit?: number
}

export type CourseScheduleStore = {
  /** Live (not ended) classes of ONE project, by start. */
  listSeries(projectId: string, opts?: { ownerPublicIds?: string[]; editionId?: string | null; ownerType?: ScheduleOwnerType }): Promise<ClassSeries[]>
  saveSeries(input: SaveClassInput): Promise<{ seriesId: string; version: number }>
  /** Ends a class: it and its future sessions are tombstoned, past sessions stay. Returns how many sessions were removed. */
  endSeries(projectId: string, seriesId: string, expectedVersion: number): Promise<number>
  /** Regenerates the class's sessions from today on (see header). */
  syncSeries(projectId: string, seriesId: string, opts?: { now?: Date }): Promise<SyncResult>
  updateOccurrence(input: UpdateOccurrenceInput): Promise<number>
  /** Sessions of ONE project not over before `from` and starting before `to`, earliest first (series fields applied). */
  occurrencesInWindow(projectId: string, window: ClassWindow): Promise<ClassOccurrence[]>

  listEditions(projectId: string, opts?: { ownerType?: ScheduleOwnerType | null; ownerPublicId?: string | null }): Promise<ScheduleEdition[]>
  saveEdition(input: SaveEditionInput): Promise<{ id: string; version: number }>
  removeEdition(projectId: string, id: string, expectedVersion: number): Promise<void>

  listClosures(projectId: string, opts?: { editionId?: string | null }): Promise<ScheduleClosure[]>
  /** Saves a holiday and re-syncs the classes it affects. */
  saveClosure(input: SaveClosureInput): Promise<{ id: string; resynced: number }>
  removeClosure(projectId: string, id: string): Promise<{ resynced: number }>

  /** Private details — server code only. */
  listMeetingRooms(projectId: string): Promise<MeetingRoom[]>
  saveMeetingRoom(input: SaveMeetingRoomInput): Promise<{ id: string; version: number }>
  removeMeetingRoom(projectId: string, id: string, expectedVersion: number): Promise<void>
  /** Never send the result to a public page unless the page is Access-protected and the check ran on the server. */
  meetingRoomsById(projectId: string, ids: string[]): Promise<Map<string, MeetingRoom>>
}

// ── Validation and mapping helpers ───────────────────────────────────────────

function assertUuid(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ScheduleError('invalid', `Not a valid ${what}.`)
}

function assertDate(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || dayNumber(value) === null) throw new ScheduleError('invalid', `The ${what} is not valid.`)
}

function mapDbError(error: { code?: string; message?: string } | null | undefined): ScheduleError {
  const code = error?.code
  if (code === 'AB409' || code === '40001') return new ScheduleError('conflict', 'This schedule was changed elsewhere.')
  if (code === 'P0002') return new ScheduleError('not_found', 'This schedule no longer exists.')
  if (code === '23514' || code === '23503' || code === '23505' || code === '22023' || code === '22P02' || code === '22007' || code === '22008') {
    return new ScheduleError('invalid', 'The schedule is not valid.')
  }
  return new ScheduleError('unavailable', 'Scheduling is unavailable right now.')
}

function checkPlace(p: SchedulePlace | null) {
  if (p === null) return
  if (p.kind === 'location' && typeof p.key === 'string' && LOCATION_KEY.test(p.key)) return
  if (p.kind === 'venue') {
    assertUuid(p.venuePublicId, 'venue id')
    return
  }
  throw new ScheduleError('invalid', 'The place is not valid.')
}

function checkLabel(value: unknown, what: string, max = 2000): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ScheduleError('invalid', `The ${what} is not valid.`)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!LOCALE_KEY.test(k) || typeof v !== 'string') throw new ScheduleError('invalid', `The ${what} is not valid.`)
    const t = v.trim()
    if (t) out[k] = t
  }
  if (JSON.stringify(out).length > max) throw new ScheduleError('invalid', `The ${what} is too long.`)
  return out
}

const optionalText = (v: unknown, what: string, max: number): string | null => {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || v.trim().length > max) throw new ScheduleError('invalid', `The ${what} is not valid.`)
  return v.trim()
}

const place = (v: unknown): SchedulePlace | null => {
  const p = v as { kind?: unknown; key?: unknown; venuePublicId?: unknown } | null
  if (p?.kind === 'location' && typeof p.key === 'string') return { kind: 'location', key: p.key }
  if (p?.kind === 'venue' && typeof p.venuePublicId === 'string') return { kind: 'venue', venuePublicId: p.venuePublicId }
  return null
}
const mode = (v: unknown): AttendanceMode => (v === 'online' || v === 'mixed' ? v : 'inPerson')
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const local = (v: unknown) => normaliseLocal(v) ?? ''
const iso = (v: unknown) => {
  if (typeof v !== 'string' || !v) return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}
const ownerType = (v: unknown): ScheduleOwnerType => (v === 'event' ? 'event' : 'course')
const labelOf = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x
  return out
}
const dateOnly = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '')

type Row = Record<string, unknown>

const SERIES_COLUMNS =
  'id, owner_type, owner_public_id, edition_id, time_zone, start_local, end_local, rule, rule_weekday, starts_on, ends_on, place, attendance_mode, instructor_public_ids, languages, meeting_room_id, status, version'
const OCCURRENCE_COLUMNS =
  'id, series_id, owner_type, owner_public_id, original_start_local, start_local, end_local, time_zone, starts_at, ends_at, status, is_modified, place_override, attendance_override, instructor_override, note, version'
const EDITION_COLUMNS = 'id, owner_type, owner_public_id, label, starts_on, ends_on, time_zone, version'
const CLOSURE_COLUMNS = 'id, edition_id, starts_on, ends_on, label'
const ROOM_COLUMNS = 'id, label, join_url, meeting_id, passcode, note, version'

function seriesOf(r: Row): ClassSeries {
  const rule = typeof r.rule === 'string' ? r.rule : null
  const parsed = parseClassRule(rule)
  const firstDate = local(r.start_local).slice(0, 10) || null
  const weekdays = parsed ? ruleWeekdays(parsed, firstDate) : typeof r.rule_weekday === 'number' ? [r.rule_weekday] : []
  return {
    id: String(r.id),
    ownerType: ownerType(r.owner_type),
    ownerPublicId: String(r.owner_public_id),
    editionId: typeof r.edition_id === 'string' ? r.edition_id : null,
    timeZone: String(r.time_zone),
    startLocal: local(r.start_local),
    endLocal: r.end_local ? local(r.end_local) : null,
    rule,
    weekday: typeof r.rule_weekday === 'number' ? r.rule_weekday : weekdays[0] ?? null,
    weekdays,
    interval: parsed?.kind === 'weekly' ? parsed.interval : 1,
    startsOn: r.starts_on ? dateOnly(r.starts_on) : null,
    endsOn: r.ends_on ? dateOnly(r.ends_on) : null,
    place: place(r.place),
    attendanceMode: mode(r.attendance_mode),
    instructorPublicIds: strings(r.instructor_public_ids),
    languages: strings(r.languages),
    meetingRoomId: typeof r.meeting_room_id === 'string' ? r.meeting_room_id : null,
    status: r.status === 'ended' ? 'ended' : 'active',
    version: Number(r.version) || 1,
  }
}

function occurrenceOf(r: Row, s: ClassSeries): ClassOccurrence {
  return {
    id: String(r.id),
    seriesId: s.id,
    ownerType: s.ownerType,
    ownerPublicId: s.ownerPublicId,
    originalStartLocal: r.original_start_local ? local(r.original_start_local) : null,
    isModified: r.is_modified === true,
    startLocal: local(r.start_local),
    endLocal: r.end_local ? local(r.end_local) : null,
    timeZone: String(r.time_zone),
    startsAt: iso(r.starts_at) ?? '',
    endsAt: iso(r.ends_at),
    status: r.status === 'cancelled' ? 'cancelled' : 'scheduled',
    place: r.place_override ? place(r.place_override) : s.place,
    attendanceMode: r.attendance_override ? mode(r.attendance_override) : s.attendanceMode,
    instructorPublicIds: Array.isArray(r.instructor_override) ? strings(r.instructor_override) : s.instructorPublicIds,
    note: r.note && typeof r.note === 'object' ? (r.note as Record<string, string>) : null,
    version: Number(r.version) || 1,
    languages: s.languages,
    meetingRoomId: s.meetingRoomId,
  }
}

const editionOf = (r: Row): ScheduleEdition => ({
  id: String(r.id),
  ownerType: r.owner_type ? ownerType(r.owner_type) : null,
  ownerPublicId: typeof r.owner_public_id === 'string' ? r.owner_public_id : null,
  label: labelOf(r.label),
  startsOn: dateOnly(r.starts_on),
  endsOn: dateOnly(r.ends_on),
  timeZone: String(r.time_zone),
  version: Number(r.version) || 1,
})

const closureOf = (r: Row): ScheduleClosure => ({
  id: String(r.id),
  editionId: typeof r.edition_id === 'string' ? r.edition_id : null,
  startsOn: dateOnly(r.starts_on),
  endsOn: dateOnly(r.ends_on),
  label: labelOf(r.label),
})

const roomOf = (r: Row): MeetingRoom => ({
  id: String(r.id),
  label: String(r.label),
  joinUrl: typeof r.join_url === 'string' ? r.join_url : null,
  meetingId: typeof r.meeting_id === 'string' ? r.meeting_id : null,
  passcode: typeof r.passcode === 'string' ? r.passcode : null,
  note: r.note && typeof r.note === 'object' ? (r.note as Record<string, string>) : null,
  version: Number(r.version) || 1,
})

/** The repeat of a save: the preset given, else the legacy weekday + interval as a weekly rule. */
function repeatOf(input: SaveClassInput): ClassRule {
  if (input.repeat !== undefined) {
    const clean = coerceClassRule(input.repeat)
    if (!clean) throw new ScheduleError('invalid', 'The repeat is not valid.')
    return clean
  }
  const interval = input.interval ?? 1
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_WEEK_INTERVAL) throw new ScheduleError('invalid', 'The interval is not valid.')
  return { kind: 'weekly', weekdays: [input.weekday as number], interval }
}

// ── The store ────────────────────────────────────────────────────────────────

export function createCourseScheduleStore(dbOverride?: Db): CourseScheduleStore {
  const withDb = <T>(fn: (db: Db) => Promise<T>): Promise<T> =>
    dbOverride ? fn(dbOverride) : runAsTrustedSystemOperation(REASON, (sb) => fn(sb as unknown as Db))

  /** The dates of a live term, or null when it does not exist (the database then refuses the id). */
  async function termOf(db: Db, projectId: string, editionId: string): Promise<{ startsOn: string; endsOn: string } | null> {
    const { data, error } = await db.from('schedule_editions').select('starts_on, ends_on').eq('project_id', projectId).eq('id', editionId).is('removed_at', null).limit(1)
    if (error) throw mapDbError(error)
    const row = (data ?? [])[0]
    return row ? { startsOn: dateOnly(row.starts_on), endsOn: dateOnly(row.ends_on) } : null
  }

  async function seriesById(db: Db, projectId: string, id: string): Promise<ClassSeries> {
    const { data, error } = await db.from('event_series').select(SERIES_COLUMNS).eq('project_id', projectId).eq('id', id).is('removed_at', null).limit(1)
    if (error) throw mapDbError(error)
    const row = (data ?? [])[0]
    if (!row) throw new ScheduleError('not_found', 'This class no longer exists.')
    return seriesOf(row)
  }

  /** Series (including ended ones: their past sessions stay visible) for some ids of ONE project. */
  async function seriesMap(db: Db, projectId: string, ids: string[]): Promise<Map<string, ClassSeries>> {
    if (!ids.length) return new Map()
    const { data, error } = await db.from('event_series').select(SERIES_COLUMNS).eq('project_id', projectId).in('id', ids)
    if (error) throw mapDbError(error)
    return new Map((data ?? []).map((r: Row) => [String(r.id), seriesOf(r)]))
  }

  /**
   * Days of the current month before the sync's start: only sessions that never existed are added. An existing
   * session of that day (live, edited or removed) is never updated, removed or brought back.
   */
  async function fillMissingPast(
    db: Db,
    projectId: string,
    s: ClassSeries,
    sessions: Array<{ originalStartLocal: string; startLocal: string; endLocal: string | null; startsAt: string; endsAt: string | null }>,
    fromUtc: string,
  ): Promise<void> {
    const past = sessions.filter((x) => x.startsAt < fromUtc)
    if (!past.length) return
    const { data, error } = await db.from('event_occurrences').select('original_start_local').eq('project_id', projectId).eq('series_id', s.id).lt('starts_at', fromUtc)
    if (error) throw mapDbError(error)
    const have = new Set((data ?? []).map((r: Row) => (r.original_start_local ? local(r.original_start_local) : '')))
    const rows = past
      .filter((x) => !have.has(x.originalStartLocal))
      .map((x) => ({
        series_id: s.id,
        project_id: projectId,
        owner_type: s.ownerType,
        owner_public_id: s.ownerPublicId,
        original_start_local: x.originalStartLocal,
        start_local: x.startLocal,
        end_local: x.endLocal,
        time_zone: s.timeZone,
        starts_at: x.startsAt,
        ends_at: x.endsAt,
      }))
    if (!rows.length) return
    const { error: insErr } = await db.from('event_occurrences').insert(rows)
    if (insErr && (insErr as { code?: string }).code !== '23505') throw mapDbError(insErr)
  }

  async function syncSeriesDb(db: Db, projectId: string, seriesId: string, now: Date): Promise<SyncResult> {
    const s = await seriesById(db, projectId, seriesId)
    const rule = parseClassRule(s.rule)
    if (!rule) throw new ScheduleError('invalid', 'This class does not repeat in a way scheduling knows.')

    let edition: ScheduleEdition | null = null
    if (s.editionId) {
      const { data, error } = await db.from('schedule_editions').select(EDITION_COLUMNS).eq('project_id', projectId).eq('id', s.editionId).is('removed_at', null).limit(1)
      if (error) throw mapDbError(error)
      edition = (data ?? [])[0] ? editionOf(data[0]) : null
    }
    let cq = db.from('schedule_closures').select(CLOSURE_COLUMNS).eq('project_id', projectId).is('removed_at', null)
    cq = s.editionId ? cq.or(`edition_id.is.null,edition_id.eq.${s.editionId}`) : cq.is('edition_id', null)
    const { data: cRows, error: cErr } = await cq
    if (cErr) throw mapDbError(cErr)
    const closures = (cRows ?? []).map((r: Row) => closureOf(r))

    const startDate = s.startLocal.slice(0, 10)
    const today = localOf(now.toISOString(), s.timeZone).slice(0, 10) // today in the class's own zone
    // Sessions are generated from the first day of the current month so a class created on the 6th also gets the 3rd–5th.
    // Days before today are only FILLED when missing (below); the sync itself works from today on, as before.
    const monthStart = `${today.slice(0, 8)}01`
    const lower = (day: string) => [day, s.startsOn, edition?.startsOn, startDate].filter((d): d is string => !!d).reduce((x, y) => (x > y ? x : y))
    const from = lower(today)
    const fillFrom = lower(monthStart)
    const ends = [s.endsOn, edition?.endsOn].filter((d): d is string => !!d)
    const until = ends.length ? ends.reduce((a, b) => (a < b ? a : b)) : addDays(from, OPEN_ENDED_DAYS)

    const expanded = expandRule({
      rule,
      startTime: s.startLocal.slice(11, 16),
      endTime: s.endLocal ? s.endLocal.slice(11, 16) : null,
      timeZone: s.timeZone,
      from: fillFrom < from ? fillFrom : from,
      until,
      anchor: startDate,
      closures,
    })
    const fromUtc = resolveSessionTimes({ timeZone: s.timeZone, startLocal: `${from}T00:00` }).startsAt
    const { data, error } = await db.rpc('schedule_occurrences_sync', {
      p_project_id: projectId,
      p_series_id: seriesId,
      p_from: fromUtc,
      p_rows: expanded.sessions.map((x) => ({
        original_start_local: x.originalStartLocal,
        start_local: x.startLocal,
        end_local: x.endLocal,
        starts_at: x.startsAt,
        ends_at: x.endsAt,
      })),
      p_closed: expanded.closed.filter((k) => k.slice(0, 10) >= from), // closures of past days are not this sync's business
    })
    if (error) throw mapDbError(error)
    await fillMissingPast(db, projectId, s, expanded.sessions, fromUtc)
    const counts = (Array.isArray(data) ? data[0] : data) as { inserted?: number; updated?: number; removed?: number } | undefined
    if (!counts) throw new ScheduleError('unavailable', 'Scheduling did not answer.')

    // Edited sessions are never regenerated: report the ones the rule no longer produces.
    const { data: mRows, error: mErr } = await db
      .from('event_occurrences')
      .select('original_start_local')
      .eq('project_id', projectId)
      .eq('series_id', seriesId)
      .eq('is_modified', true)
      .is('removed_at', null)
      .gte('starts_at', fromUtc)
    if (mErr) throw mapDbError(mErr)
    const wanted = new Set(expanded.sessions.map((x) => x.originalStartLocal))
    const modifiedOutsideRule = (mRows ?? [])
      .map((r: Row) => (r.original_start_local ? local(r.original_start_local) : ''))
      .filter((k: string) => k && !wanted.has(k))
    return {
      inserted: Number(counts.inserted) || 0,
      updated: Number(counts.updated) || 0,
      removed: Number(counts.removed) || 0,
      truncated: expanded.truncated,
      modifiedOutsideRule,
    }
  }

  /** Re-syncs the live classes of a project that a term or holiday change affects (edition null = all). */
  async function resyncAffected(db: Db, projectId: string, editionIds: Array<string | null>): Promise<number> {
    let q = db.from('event_series').select('id, edition_id, rule').eq('project_id', projectId).eq('owner_type', 'course').is('removed_at', null)
    if (!editionIds.includes(null)) q = q.in('edition_id', editionIds.filter((x): x is string => !!x))
    const { data, error } = await q
    if (error) throw mapDbError(error)
    const rows = ((data ?? []) as Row[]).filter((r) => parseClassRule(typeof r.rule === 'string' ? r.rule : null))
    for (const r of rows) await syncSeriesDb(db, projectId, String(r.id), new Date())
    return rows.length
  }

  return {
    listSeries: (projectId, opts = {}) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        let q = db.from('event_series').select(SERIES_COLUMNS).eq('project_id', projectId).eq('owner_type', opts.ownerType ?? 'course').is('removed_at', null)
        if (opts.ownerPublicIds) {
          const wanted = opts.ownerPublicIds.filter((id) => UUID.test(id))
          if (!wanted.length) return []
          q = q.in('owner_public_id', wanted)
        }
        if (opts.editionId !== undefined) {
          if (opts.editionId === null) q = q.is('edition_id', null)
          else {
            assertUuid(opts.editionId, 'term id')
            q = q.eq('edition_id', opts.editionId)
          }
        }
        const { data, error } = await q.order('start_local', { ascending: true })
        if (error) throw mapDbError(error)
        return (data ?? []).map((r: Row) => seriesOf(r))
      }),

    saveSeries: (input) =>
      withDb(async (db) => {
        assertUuid(input.projectId, 'project')
        if (input.seriesId !== null) assertUuid(input.seriesId, 'class id')
        assertUuid(input.ownerPublicId, 'owner id')
        if (input.editionId != null) assertUuid(input.editionId, 'term id')
        if (input.meetingRoomId != null) assertUuid(input.meetingRoomId, 'meeting room id')
        const instructors = input.instructorPublicIds ?? []
        if (instructors.length > MAX_INSTRUCTORS) throw new ScheduleError('invalid', 'Too many people.')
        for (const id of instructors) assertUuid(id, 'host id')
        const languages = input.languages ?? []
        if (languages.length > 6 || new Set(languages).size !== languages.length || !languages.every((l) => LANGUAGE.test(l))) {
          throw new ScheduleError('invalid', 'The languages are not valid.')
        }
        checkPlace(input.place)
        if (input.attendanceMode !== 'inPerson' && input.attendanceMode !== 'online' && input.attendanceMode !== 'mixed') {
          throw new ScheduleError('invalid', 'The attendance mode is not valid.')
        }
        if (!TIME.test(input.startTime) || (input.endTime != null && !TIME.test(input.endTime))) throw new ScheduleError('invalid', 'The time is not valid.')
        assertDate(input.startsOn, 'first date')
        if (input.endsOn != null) {
          assertDate(input.endsOn, 'last date')
          if (input.endsOn < input.startsOn) throw new ScheduleError('invalid', 'The last date is before the first.')
        }
        const repeat = repeatOf(input)
        const rule = formatClassRule(repeat) // validates the repeat too
        // An unaligned first date rolls forward to the next class day, an unaligned last date back to the previous one;
        // only when nothing fits is the input refused. The first session is that first date (also the "every N weeks" anchor).
        const startsOn = nextStartDate(repeat, input.startsOn)
        if (!startsOn) throw new ScheduleError('invalid', 'The first class is not on one of the class days.')
        let endsOn: string | null = null
        if (repeat.kind === 'once') endsOn = startsOn // one date: the last date is that date
        else if (input.endsOn != null) {
          endsOn = previousRuleDate(repeat, input.endsOn, startsOn)
          if (!endsOn || endsOn < startsOn) throw new ScheduleError('invalid', 'The last class is before the first class day.')
        }
        // A class cannot start outside its term (a "once" class in particular would have no session).
        if (input.editionId != null) {
          const term = await termOf(db, input.projectId, input.editionId)
          if (term && (startsOn < term.startsOn || startsOn > term.endsOn)) throw new ScheduleError('outside_term', 'The first class is outside the term.')
        }
        const weekday = ruleWeekdays(repeat, startsOn)[0]
        if ((input.seriesId === null) !== (input.expectedVersion === null)) {
          throw new ScheduleError('invalid', input.seriesId === null ? 'A new class has no version.' : 'The version is required.')
        }

        // The series' own start is its first session: that date is also the "every N weeks" anchor.
        const times = resolveSessionTimes({
          timeZone: input.timeZone,
          startLocal: `${startsOn}T${input.startTime}`,
          endLocal: input.endTime ? `${startsOn}T${input.endTime}` : null,
        })
        const { data, error } = await db.rpc('schedule_series_save', {
          p_project_id: input.projectId,
          p_series_id: input.seriesId,
          p_owner_type: input.ownerType ?? 'course',
          p_owner_public_id: input.ownerPublicId,
          p_edition_id: input.editionId ?? null,
          p_time_zone: times.timeZone,
          p_start_local: times.startLocal,
          p_end_local: times.endLocal,
          p_rule: rule,
          p_rule_weekday: weekday, // the first weekday (keeps readers of rule_weekday working)
          p_starts_on: startsOn,
          p_ends_on: endsOn,
          p_place: input.place,
          p_attendance_mode: input.attendanceMode,
          p_instructors: instructors,
          p_languages: languages,
          p_meeting_room_id: input.meetingRoomId ?? null,
          p_expected_version: input.expectedVersion,
          p_actor: input.actorId ?? null,
        })
        if (error) throw mapDbError(error)
        const row = (Array.isArray(data) ? data[0] : data) as { series_id?: string; version?: number } | undefined
        if (!row?.series_id) throw new ScheduleError('unavailable', 'Scheduling did not answer.')
        return { seriesId: row.series_id, version: Number(row.version) }
      }),

    endSeries: (projectId, seriesId, expectedVersion) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(seriesId, 'class id')
        const { data, error } = await db.rpc('schedule_series_end', { p_project_id: projectId, p_series_id: seriesId, p_expected_version: expectedVersion })
        if (error) throw mapDbError(error)
        return Number(data) || 0
      }),

    syncSeries: (projectId, seriesId, opts = {}) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(seriesId, 'class id')
        return syncSeriesDb(db, projectId, seriesId, opts.now ?? new Date())
      }),

    updateOccurrence: (input) =>
      withDb(async (db) => {
        assertUuid(input.projectId, 'project')
        assertUuid(input.occurrenceId, 'session id')
        if (input.status !== undefined && input.status !== 'scheduled' && input.status !== 'cancelled') throw new ScheduleError('invalid', 'The status is not valid.')
        if (input.instructorPublicIds !== undefined) {
          if (input.instructorPublicIds.length > MAX_INSTRUCTORS) throw new ScheduleError('invalid', 'Too many people.')
          for (const id of input.instructorPublicIds) assertUuid(id, 'host id')
          if (input.clearInstructors) throw new ScheduleError('invalid', 'Choose either new hosts or the class default.')
        }
        if (input.note !== undefined && input.clearNote) throw new ScheduleError('invalid', 'Choose either a note or none.')
        if (input.place !== undefined && input.clearPlace) throw new ScheduleError('invalid', 'Choose either a place or the class place.')
        if (input.place !== undefined) {
          if (input.place === null) throw new ScheduleError('invalid', 'Choose a place.')
          checkPlace(input.place)
        }
        const note = input.note === undefined ? null : checkLabel(input.note, 'note', 4000)
        let t: SessionTimes | null = null
        if (input.times) {
          t = resolveSessionTimes({ timeZone: input.times.timeZone, startLocal: input.times.startLocal, endLocal: input.times.endLocal ?? null })
        }
        const { data, error } = await db.rpc('schedule_occurrence_update', {
          p_project_id: input.projectId,
          p_occurrence_id: input.occurrenceId,
          p_expected_version: input.expectedVersion,
          p_status: input.status ?? null,
          p_instructor_override: input.instructorPublicIds ?? null,
          p_clear_instructor: input.clearInstructors === true,
          p_start_local: t?.startLocal ?? null,
          p_end_local: t?.endLocal ?? null,
          p_starts_at: t?.startsAt ?? null,
          p_ends_at: t?.endsAt ?? null,
          p_note: note,
          p_clear_note: input.clearNote === true,
          // Sent only when used, so the call stays the 12-argument one otherwise (065 gives both a default).
          ...(input.place !== undefined && { p_place: input.place }),
          ...(input.clearPlace && { p_clear_place: true }),
        })
        if (error) throw mapDbError(error)
        return Number(data)
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
          .eq('owner_type', window.ownerType ?? 'course')
          .is('removed_at', null)
          .or(`ends_at.gte.${from},and(ends_at.is.null,starts_at.gte.${from})`)
        if (to) q = q.lt('starts_at', to)
        if (window.ownerPublicIds) {
          const wanted = window.ownerPublicIds.filter((id) => UUID.test(id))
          if (!wanted.length) return []
          q = q.in('owner_public_id', wanted)
        }
        const { data, error } = await q.order('starts_at', { ascending: true }).limit(Math.min(window.limit ?? MAX_WINDOW_ROWS, MAX_WINDOW_ROWS))
        if (error) throw mapDbError(error)
        const rows = (data ?? []) as Row[]
        const series = await seriesMap(db, projectId, [...new Set(rows.map((r) => String(r.series_id)))])
        return rows.flatMap((r) => {
          const s = series.get(String(r.series_id))
          return s ? [occurrenceOf(r, s)] : []
        })
      }),

    // ── Editions (terms) ──
    listEditions: (projectId, opts = {}) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        let q = db.from('schedule_editions').select(EDITION_COLUMNS).eq('project_id', projectId).is('removed_at', null)
        if (opts.ownerType !== undefined) {
          if (opts.ownerType === null) q = q.is('owner_type', null)
          else {
            q = q.eq('owner_type', opts.ownerType)
            if (opts.ownerPublicId) {
              assertUuid(opts.ownerPublicId, 'owner id')
              q = q.eq('owner_public_id', opts.ownerPublicId)
            }
          }
        }
        const { data, error } = await q.order('starts_on', { ascending: true })
        if (error) throw mapDbError(error)
        return (data ?? []).map((r: Row) => editionOf(r))
      }),

    saveEdition: (input) =>
      withDb(async (db) => {
        assertUuid(input.projectId, 'project')
        if (input.id != null) assertUuid(input.id, 'term id')
        if ((input.ownerType == null) !== (input.ownerPublicId == null)) throw new ScheduleError('invalid', 'The owner is not valid.')
        if (input.ownerPublicId != null) assertUuid(input.ownerPublicId, 'owner id')
        const label = checkLabel(input.label, 'label')
        assertDate(input.startsOn, 'start date')
        assertDate(input.endsOn, 'end date')
        if (input.endsOn < input.startsOn) throw new ScheduleError('invalid', 'The end is before the start.')
        if (typeof input.timeZone !== 'string' || !isValidTimeZone(input.timeZone)) throw new ScheduleError('invalid', 'Unknown time zone.')
        const fields = {
          owner_type: input.ownerType ?? null,
          owner_public_id: input.ownerPublicId ?? null,
          label,
          starts_on: input.startsOn,
          ends_on: input.endsOn,
          time_zone: input.timeZone,
        }
        if (input.id == null) {
          if (input.expectedVersion != null) throw new ScheduleError('invalid', 'A new term has no version.')
          const { data, error } = await db.from('schedule_editions').insert({ project_id: input.projectId, ...fields }).select('id, version')
          if (error) throw mapDbError(error)
          const row = (Array.isArray(data) ? data[0] : data) as { id?: string; version?: number } | undefined
          if (!row?.id) throw new ScheduleError('unavailable', 'Scheduling did not answer.')
          return { id: row.id, version: Number(row.version) || 1 }
        }
        if (input.expectedVersion == null) throw new ScheduleError('invalid', 'The version is required.')
        const { data, error } = await db
          .from('schedule_editions')
          .update({ ...fields, version: input.expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', input.projectId)
          .eq('id', input.id)
          .eq('version', input.expectedVersion)
          .is('removed_at', null)
          .select('id, version')
        if (error) throw mapDbError(error)
        const row = (data ?? [])[0] as { id?: string; version?: number } | undefined
        if (!row?.id) throw new ScheduleError('conflict', 'This term was changed elsewhere.')
        await resyncAffected(db, input.projectId, [input.id]) // new dates move or end its classes
        return { id: row.id, version: Number(row.version) }
      }),

    removeEdition: (projectId, id, expectedVersion) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(id, 'term id')
        const { data: used, error: uErr } = await db.from('event_series').select('id').eq('project_id', projectId).eq('edition_id', id).is('removed_at', null).limit(1)
        if (uErr) throw mapDbError(uErr)
        if ((used ?? []).length) throw new ScheduleError('conflict', 'This term still has classes.')
        const { data, error } = await db
          .from('schedule_editions')
          .update({ removed_at: new Date().toISOString(), version: expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('id', id)
          .eq('version', expectedVersion)
          .is('removed_at', null)
          .select('id')
        if (error) throw mapDbError(error)
        if (!(data ?? []).length) throw new ScheduleError('conflict', 'This term was changed elsewhere.')
      }),

    // ── Closures (holidays) ──
    listClosures: (projectId, opts = {}) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        let q = db.from('schedule_closures').select(CLOSURE_COLUMNS).eq('project_id', projectId).is('removed_at', null)
        if (opts.editionId !== undefined) {
          if (opts.editionId === null) q = q.is('edition_id', null)
          else {
            assertUuid(opts.editionId, 'term id')
            q = q.or(`edition_id.is.null,edition_id.eq.${opts.editionId}`)
          }
        }
        const { data, error } = await q.order('starts_on', { ascending: true })
        if (error) throw mapDbError(error)
        return (data ?? []).map((r: Row) => closureOf(r))
      }),

    saveClosure: (input) =>
      withDb(async (db) => {
        assertUuid(input.projectId, 'project')
        if (input.id != null) assertUuid(input.id, 'holiday id')
        if (input.editionId != null) assertUuid(input.editionId, 'term id')
        assertDate(input.startsOn, 'start date')
        assertDate(input.endsOn, 'end date')
        if (input.endsOn < input.startsOn) throw new ScheduleError('invalid', 'The end is before the start.')
        const label = checkLabel(input.label, 'label')
        const fields = { edition_id: input.editionId ?? null, starts_on: input.startsOn, ends_on: input.endsOn, label }
        const affected: Array<string | null> = [input.editionId ?? null]
        let id = input.id ?? null
        if (id === null) {
          const { data, error } = await db.from('schedule_closures').insert({ project_id: input.projectId, ...fields }).select('id')
          if (error) throw mapDbError(error)
          const row = (Array.isArray(data) ? data[0] : data) as { id?: string } | undefined
          if (!row?.id) throw new ScheduleError('unavailable', 'Scheduling did not answer.')
          id = row.id
        } else {
          const { data: before, error: bErr } = await db.from('schedule_closures').select(CLOSURE_COLUMNS).eq('project_id', input.projectId).eq('id', id).is('removed_at', null).limit(1)
          if (bErr) throw mapDbError(bErr)
          if (!(before ?? [])[0]) throw new ScheduleError('not_found', 'This holiday no longer exists.')
          affected.push(closureOf(before[0]).editionId)
          const { data, error } = await db
            .from('schedule_closures')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('project_id', input.projectId)
            .eq('id', id)
            .is('removed_at', null)
            .select('id')
          if (error) throw mapDbError(error)
          if (!(data ?? []).length) throw new ScheduleError('not_found', 'This holiday no longer exists.')
        }
        return { id, resynced: await resyncAffected(db, input.projectId, affected) }
      }),

    removeClosure: (projectId, id) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(id, 'holiday id')
        const { data, error } = await db
          .from('schedule_closures')
          .update({ removed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('id', id)
          .is('removed_at', null)
          .select(CLOSURE_COLUMNS)
        if (error) throw mapDbError(error)
        const row = (data ?? [])[0] as Row | undefined
        if (!row) throw new ScheduleError('not_found', 'This holiday no longer exists.')
        return { resynced: await resyncAffected(db, projectId, [closureOf(row).editionId]) }
      }),

    // ── Meeting rooms (private) ──
    listMeetingRooms: (projectId) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        const { data, error } = await db.from('schedule_meeting_rooms').select(ROOM_COLUMNS).eq('project_id', projectId).is('removed_at', null).order('label', { ascending: true })
        if (error) throw mapDbError(error)
        return (data ?? []).map((r: Row) => roomOf(r))
      }),

    saveMeetingRoom: (input) =>
      withDb(async (db) => {
        assertUuid(input.projectId, 'project')
        if (input.id != null) assertUuid(input.id, 'meeting room id')
        const label = optionalText(input.label, 'label', 80)
        if (!label) throw new ScheduleError('invalid', 'The label is required.')
        const joinUrl = optionalText(input.joinUrl, 'link', 2000)
        if (joinUrl) {
          let ok = false
          try {
            ok = new URL(joinUrl).protocol === 'https:'
          } catch {
            ok = false
          }
          if (!ok) throw new ScheduleError('invalid', 'The link must start with https://.')
        }
        const fields = {
          label,
          join_url: joinUrl,
          meeting_id: optionalText(input.meetingId, 'meeting id', 40),
          passcode: optionalText(input.passcode, 'passcode', 40),
          note: input.note == null ? null : checkLabel(input.note, 'note', 4000),
        }
        if (input.id == null) {
          if (input.expectedVersion != null) throw new ScheduleError('invalid', 'A new room has no version.')
          const { data, error } = await db.from('schedule_meeting_rooms').insert({ project_id: input.projectId, ...fields }).select('id, version')
          if (error) throw mapDbError(error)
          const row = (Array.isArray(data) ? data[0] : data) as { id?: string; version?: number } | undefined
          if (!row?.id) throw new ScheduleError('unavailable', 'Scheduling did not answer.')
          return { id: row.id, version: Number(row.version) || 1 }
        }
        if (input.expectedVersion == null) throw new ScheduleError('invalid', 'The version is required.')
        const { data, error } = await db
          .from('schedule_meeting_rooms')
          .update({ ...fields, version: input.expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', input.projectId)
          .eq('id', input.id)
          .eq('version', input.expectedVersion)
          .is('removed_at', null)
          .select('id, version')
        if (error) throw mapDbError(error)
        const row = (data ?? [])[0] as { id?: string; version?: number } | undefined
        if (!row?.id) throw new ScheduleError('conflict', 'This room was changed elsewhere.')
        return { id: row.id, version: Number(row.version) }
      }),

    removeMeetingRoom: (projectId, id, expectedVersion) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        assertUuid(id, 'meeting room id')
        const { data: used, error: uErr } = await db.from('event_series').select('id').eq('project_id', projectId).eq('meeting_room_id', id).is('removed_at', null).limit(1)
        if (uErr) throw mapDbError(uErr)
        if ((used ?? []).length) throw new ScheduleError('conflict', 'This room is still used by classes.')
        const { data, error } = await db
          .from('schedule_meeting_rooms')
          .update({ removed_at: new Date().toISOString(), version: expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('id', id)
          .eq('version', expectedVersion)
          .is('removed_at', null)
          .select('id')
        if (error) throw mapDbError(error)
        if (!(data ?? []).length) throw new ScheduleError('conflict', 'This room was changed elsewhere.')
      }),

    meetingRoomsById: (projectId, ids) =>
      withDb(async (db) => {
        assertUuid(projectId, 'project')
        const wanted = [...new Set(ids.filter((id) => UUID.test(id)))]
        const out = new Map<string, MeetingRoom>()
        if (!wanted.length) return out
        const { data, error } = await db.from('schedule_meeting_rooms').select(ROOM_COLUMNS).eq('project_id', projectId).in('id', wanted).is('removed_at', null)
        if (error) throw mapDbError(error)
        for (const r of (data ?? []) as Row[]) out.set(String(r.id), roomOf(r))
        return out
      }),
  }
}
