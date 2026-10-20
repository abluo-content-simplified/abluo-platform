// ── Events module — "live / upcoming / past" from the dates ──────────────────
//
// Pure (no React, no I/O): shared by the website cards, the featured event
// block and the client dashboard, so every surface agrees on an event's timing.
//
// The legacy `status` field (upcoming / live / past) is set once when an event
// is created and never updated when its dates change, so it must not decide
// "upcoming" or "past". Its one remaining meaning is a manual "live" that Abluo
// sets for a streamed event (Live module); that stays honoured until the event
// has ended. ADR-031 D7.2 retires the field later, in a separate step.

export type EventTiming = 'upcoming' | 'live' | 'past'

export type EventTimingSource = {
  status?: unknown
  startDate?: unknown
  endDate?: unknown
}

const parse = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) : NaN)

/** "upcoming" until the event ends (end date, else start date); a manual "live" stays live until then. */
export function eventTiming(event: EventTimingSource, now: Date): EventTiming {
  const start = parse(event.startDate)
  const end = parse(event.endDate)
  const last = Number.isNaN(end) ? start : end
  const ended = !Number.isNaN(last) && last < now.getTime()
  if (event.status === 'live') return Number.isNaN(end) || !ended ? 'live' : 'past'
  if (Number.isNaN(last)) return 'upcoming'
  return ended ? 'past' : 'upcoming'
}
