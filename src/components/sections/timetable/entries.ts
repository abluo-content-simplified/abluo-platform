import type { TimetableData, TimetableEvent, TimetableOccurrence } from '@/lib/modules/courses/timetable'

/** A day's classes and events, in time order. */
export type Entry = { kind: 'class'; start: string; o: TimetableOccurrence } | { kind: 'event'; start: string; e: TimetableEvent }

export function entriesOn(data: TimetableData, date: string): Entry[] {
  const list: Entry[] = [
    ...data.occurrences.filter((o) => o.date === date).map((o): Entry => ({ kind: 'class', start: o.start, o })),
    ...data.events.filter((e) => e.date === date).map((e): Entry => ({ kind: 'event', start: e.start, e })),
  ]
  return list.sort((a, b) => a.start.localeCompare(b.start))
}
