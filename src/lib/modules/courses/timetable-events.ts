// ── Events in the timetable (workshops) — pure shaping ────────────────────────
//
// The Events module owns events; the timetable only PRESENTS the ones that fall
// in the window (Sections vs Modules). This turns what the server read — the
// published, listed events of the site (Sanity) and their sessions in the window
// (scheduling, one query) — into the plain `TimetableEvent` rows the views show.
//
// Dates follow the schedule overlay (src/lib/scheduling/overlay.ts): an event WITH
// a schedule shows the schedule's sessions; an event WITHOUT one keeps its Sanity
// dates — and only an event with NO schedule anywhere; one whose sessions are all outside the window is not shown
// at its (possibly stale) Sanity date. A cancelled event, or a cancelled session, is simply not listed.

import { resolveEventPlace } from '@/lib/modules/events/structured'
import { localOf } from '@/lib/scheduling/time'
import type { Occurrence } from '@/lib/scheduling/types'
import type { Event, SiteLocation } from '@/lib/sanity/types'
import { compareEvents, type TimetableEvent } from './timetable'

/** The Sanity fields the timetable reads of an event (timetableEventsQuery). */
export type TimetableEventSource = Pick<Event, 'place' | 'attendanceMode' | 'location'> & {
  _id?: string
  publicId?: string | null
  title?: string | null
  slug?: { current?: string | null } | null
  eventStatus?: string | null
  startDate?: string | null
  endDate?: string | null
}

export function shapeTimetableEvents(input: {
  window: { from: string; to: string }
  events: readonly TimetableEventSource[]
  /** The sessions of the window from scheduling (events only). */
  occurrences: readonly Occurrence[]
  siteLocations?: SiteLocation[] | null
  timeZone?: string | null
  /** publicIds of events that own a schedule at all (a series anywhere in time). Only events NOT in here may fall back to their Sanity dates. */
  withSchedule?: ReadonlySet<string> | null
}): TimetableEvent[] {
  const { window } = input
  const shown = input.events.filter((e) => e?.title?.trim() && e.eventStatus !== 'cancelled')
  const byPublicId = new Map(shown.filter((e) => e.publicId).map((e) => [e.publicId as string, e]))
  // Every event that has a schedule (even only cancelled sessions) is decided by it, never by its Sanity dates.
  const scheduled = new Set(input.occurrences.map((o) => o.eventPublicId))

  const row = (e: TimetableEventSource, id: string, startLocal: string, endLocal: string | null): TimetableEvent | null => {
    const date = startLocal.slice(0, 10)
    if (date < window.from || date > window.to) return null
    const place = resolveEventPlace(e, input.siteLocations)
    return {
      id,
      eventId: e.publicId ?? e._id ?? id,
      title: (e.title ?? '').trim(),
      slug: e.slug?.current?.trim() || null,
      date,
      start: startLocal.slice(11, 16),
      end: endLocal && endLocal.slice(0, 10) === date ? endLocal.slice(11, 16) : null,
      placeName: place?.name?.trim() || e.location?.trim() || null,
    }
  }

  const out: TimetableEvent[] = []
  for (const o of input.occurrences) {
    const e = byPublicId.get(o.eventPublicId)
    if (!e || o.status === 'cancelled') continue
    const r = row(e, o.id, o.startLocal, o.endLocal)
    if (r) out.push(r)
  }
  for (const e of shown) {
    if (e.publicId && (scheduled.has(e.publicId) || input.withSchedule?.has(e.publicId))) continue
    if (!e.startDate) continue
    try {
      const zone = resolveEventPlace(e, input.siteLocations)?.timeZone || input.timeZone || 'UTC'
      const r = row(e, `ev:${e.publicId ?? e._id}`, localOf(e.startDate, zone), e.endDate ? localOf(e.endDate, zone) : null)
      if (r) out.push(r)
    } catch {
      // An unreadable date: the event is left out, never the page.
    }
  }
  return out.sort(compareEvents)
}
