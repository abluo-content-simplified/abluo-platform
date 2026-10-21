// ── Scheduling — shared types (ADR-038) ──────────────────────────────────────
//
// Independent of Events on purpose: a future appointment system reuses the time
// handling and the session model without becoming a public event (ADR-038 D9).
// Events uses it with `eventPublicId` = the Sanity event's permanent publicId.

/** 'YYYY-MM-DDTHH:mm' — a wall-clock time in a named IANA zone. */
export type LocalDateTime = string

export type AttendanceMode = 'inPerson' | 'online' | 'mixed'

/** Where a session happens: one of the site's locations, or a venue (by its permanent publicId). */
export type SchedulePlace =
  | { kind: 'location'; key: string }
  | { kind: 'venue'; venuePublicId: string }

export type OccurrenceStatus = 'scheduled' | 'cancelled'

/** One session as the readers see it (tombstoned sessions are never returned). */
export type Occurrence = {
  id: string
  seriesId: string
  eventPublicId: string
  startLocal: LocalDateTime
  endLocal: LocalDateTime | null
  timeZone: string
  startsAt: string // UTC ISO
  endsAt: string | null
  status: OccurrenceStatus
  /** The session's own values where they override the series. */
  place: SchedulePlace | null
  attendanceMode: AttendanceMode
  instructorPublicIds: string[]
  note: Record<string, string> | null
  version: number
}

export type Series = {
  id: string
  eventPublicId: string
  timeZone: string
  startLocal: LocalDateTime
  endLocal: LocalDateTime | null
  place: SchedulePlace | null
  attendanceMode: AttendanceMode
  instructorPublicIds: string[]
  /** null = one-off (Phase 1). */
  rule: string | null
  origin: 'dashboard' | 'migrated'
  version: number
}

export type EventSchedule = { series: Series; occurrences: Occurrence[] }

export type ScheduleErrorCode = 'conflict' | 'not_found' | 'invalid' | 'unavailable'

export class ScheduleError extends Error {
  constructor(readonly code: ScheduleErrorCode, message: string) {
    super(message)
    this.name = 'ScheduleError'
  }
}
