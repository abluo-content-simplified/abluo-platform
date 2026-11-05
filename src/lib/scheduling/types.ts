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

// ── Course schedules (ADR-038 Amendment A, ADR-045, migration 064) ───────────
//
// A series/session now has an OWNER: an event or a course (the owner's Sanity
// publicId). The event types above are unchanged (they keep `eventPublicId`);
// these types describe repeating weekly classes that belong to a course.

export type ScheduleOwnerType = 'event' | 'course'

/** A weekly class: one series of a course (migration 064 columns on event_series). */
export type ClassSeries = {
  id: string
  ownerType: ScheduleOwnerType
  ownerPublicId: string
  editionId: string | null
  timeZone: string
  /** First session ('YYYY-MM-DDTHH:mm'); also the anchor for "every N weeks". */
  startLocal: LocalDateTime
  endLocal: LocalDateTime | null
  /** 'FREQ=WEEKLY;INTERVAL=n;BYDAY=XX' (null only for odd legacy rows). */
  rule: string | null
  /** 1 = Monday … 7 = Sunday. */
  weekday: number | null
  interval: number
  /** First / last possible date of the class ('YYYY-MM-DD'). */
  startsOn: string | null
  endsOn: string | null
  place: SchedulePlace | null
  attendanceMode: AttendanceMode
  instructorPublicIds: string[]
  languages: string[]
  meetingRoomId: string | null
  /** 'ended' once the class was ended (its past sessions remain). */
  status: 'active' | 'ended'
  version: number
}

/** One dated class session, with the series defaults applied where it does not override them. */
export type ClassOccurrence = Omit<Occurrence, 'eventPublicId'> & {
  ownerType: ScheduleOwnerType
  ownerPublicId: string
  /** The date-time the rule generated (stable key; null = added by hand). */
  originalStartLocal: LocalDateTime | null
  /** True once edited individually: the rule never overwrites it again. */
  isModified: boolean
  languages: string[]
  meetingRoomId: string | null
}

/** A term / edition. owner null = the whole site's timetable. */
export type ScheduleEdition = {
  id: string
  ownerType: ScheduleOwnerType | null
  ownerPublicId: string | null
  label: Record<string, string>
  startsOn: string
  endsOn: string
  timeZone: string
  version: number
}

/** Holidays: no generated session takes place on these dates (inclusive). editionId null = every series. */
export type ScheduleClosure = {
  id: string
  editionId: string | null
  startsOn: string
  endsOn: string
  label: Record<string, string>
}

/** Private online meeting details. Server-only: never put one on a public page. */
export type MeetingRoom = {
  id: string
  label: string
  joinUrl: string | null
  meetingId: string | null
  passcode: string | null
  note: Record<string, string> | null
  version: number
}
