// ── Scheduling — dates from Supabase over Sanity content (ADR-038, step C3) ───
//
// Pure. During Phase 1 every reader keeps fetching events from Sanity exactly as
// before, then lays the schedule over them: an event WITH a schedule shows the
// schedule's dates (Supabase is authoritative); an event WITHOUT one keeps its
// Sanity dates (the fallback while the migration is pending — and the reason
// this step changes nothing visible today).
//
// Filtering and sorting by date (upcoming / past lists, Live page) stay in GROQ
// for one-off events in Phase 1: the scheduling API shadow-writes the same dates
// into the legacy Sanity fields (ADR-038 D10.3), so they never diverge. Windowed
// reads from Supabase replace them when repeating events arrive (Phase 2).

import type { EventSchedule, Occurrence } from './types'

export type SchedulableEvent = {
  publicId?: string | null
  startDate?: string | null
  endDate?: string | null
  eventStatus?: string | null
}

/** The session a one-off event shows: its only live session (earliest if several). */
export function displayOccurrence(schedule: EventSchedule | undefined): Occurrence | null {
  if (!schedule?.occurrences.length) return null
  return [...schedule.occurrences].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
}

/**
 * The event with its schedule applied. Dates come from the session; a cancelled
 * session makes the event read as cancelled unless Abluo already set another
 * announcement (postponed / sold out stay as authored). Never mutates.
 */
export function applySchedule<T extends SchedulableEvent>(event: T, schedule: EventSchedule | undefined): T {
  const o = displayOccurrence(schedule)
  if (!o) return event
  const status = o.status === 'cancelled' && (!event.eventStatus || event.eventStatus === 'scheduled') ? 'cancelled' : event.eventStatus
  return { ...event, startDate: o.startsAt, endDate: o.endsAt, ...(status !== undefined ? { eventStatus: status } : {}) }
}

/** Every event of a list with its schedule applied (events without a publicId are left as they are). */
export function applySchedules<T extends SchedulableEvent>(events: T[], schedules: Map<string, EventSchedule>): T[] {
  return events.map((e) => (e?.publicId ? applySchedule(e, schedules.get(e.publicId)) : e))
}
