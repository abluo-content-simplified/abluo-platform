// What differs between a dated session and its weekly pattern, for the cards,
// the schedule updates and the class panel. The data layer (courses/timetable)
// fills `occurrence.change`; when it is absent (older data), the same facts are
// derived from the weekly series so the UI never depends on the field.

import { exceptionsOf, type TimetableData, type TimetableOccurrence, type TimetablePlace, type TimetableSeries } from '@/lib/modules/courses/timetable'

export type SessionChange = {
  cancelled: boolean
  substitute: boolean
  timeChanged: boolean
  moved: boolean
  originalStart: string | null
  originalEnd: string | null
  originalDate: string | null
  originalTeacherIds: string[]
  originalPlaceKey: string | null
}

export const NO_CHANGE: SessionChange = { cancelled: false, substitute: false, timeChanged: false, moved: false, originalStart: null, originalEnd: null, originalDate: null, originalTeacherIds: [], originalPlaceKey: null }

export const hasChange = (c: SessionChange) => c.cancelled || c.substitute || c.timeChanged || c.moved

export function changeOf(occ: TimetableOccurrence, series?: TimetableSeries | null): SessionChange {
  // The data layer decides (null = no change). The series-derived fallback is only for data without the field.
  const given = (occ as { change?: Partial<SessionChange> | null }).change
  if (given !== undefined) return given ? { ...NO_CHANGE, ...given, cancelled: given.cancelled === true || occ.status === 'cancelled' } : { ...NO_CHANGE, cancelled: occ.status === 'cancelled' }
  if (!series) return { ...NO_CHANGE, cancelled: occ.status === 'cancelled' }
  const ex = exceptionsOf(occ, series)
  const cancelled = occ.status === 'cancelled'
  const substitute = ex.some((e) => e.kind === 'substitute')
  const timeChanged = ex.some((e) => e.kind === 'time')
  const moved = !cancelled && !!occ.placeKey && !!series.placeKey && occ.placeKey !== series.placeKey
  return {
    cancelled,
    substitute,
    timeChanged,
    moved,
    originalStart: timeChanged ? series.start : null,
    originalEnd: timeChanged ? series.end : null,
    originalDate: null,
    originalTeacherIds: substitute ? series.teacherIds : [],
    originalPlaceKey: moved ? series.placeKey : null,
  }
}

/** The place's short name (cards), falling back to its name. */
export const placeShort = (place: TimetablePlace | null | undefined): string => (place ? place.short || place.name : '')

export function changeKinds(c: SessionChange): ('cancelled' | 'substitute' | 'timeChanged' | 'moved')[] {
  const k: ('cancelled' | 'substitute' | 'timeChanged' | 'moved')[] = []
  if (c.cancelled) k.push('cancelled')
  if (c.substitute) k.push('substitute')
  if (c.timeChanged) k.push('timeChanged')
  if (c.moved) k.push('moved')
  return k
}

export type ScheduleChangeItem = { occurrenceId: string; date: string; start: string; courseId: string; kinds: ('cancelled' | 'substitute' | 'timeChanged' | 'moved')[] }

/**
 * The schedule changes in a date range, in time order. Mirrors `scheduleChanges`
 * of the data layer (same shape) and runs on the already filtered data, so the
 * list follows the filters.
 */
export function scheduleChangesIn(data: TimetableData, range: { from: string; to: string }): ScheduleChangeItem[] {
  const seriesById = new Map(data.series.map((s) => [s.id, s]))
  const out: ScheduleChangeItem[] = []
  for (const o of data.occurrences) {
    if (o.date < range.from || o.date > range.to) continue
    const kinds = changeKinds(changeOf(o, seriesById.get(o.seriesId)))
    if (kinds.length > 0) out.push({ occurrenceId: o.id, date: o.date, start: o.start, courseId: o.courseId, kinds })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.occurrenceId.localeCompare(b.occurrenceId))
}
