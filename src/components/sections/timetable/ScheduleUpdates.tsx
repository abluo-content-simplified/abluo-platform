'use client'

// "Schedule updates": the changes to the regular timetable (cancelled,
// substitute, new time, moved) for the period on screen. Desktop: a concise
// list; phone: a collapsed summary line that expands. Each item opens that
// session's details. Hidden when nothing changed.

import { useId, useState } from 'react'
import type { TimetableData, TimetableOccurrence } from '@/lib/modules/courses/timetable'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import { formatDate, listNames, timeRange } from './format'
import { Info } from 'lucide-react'
import { changeOf, placeShort, type ScheduleChangeItem } from './status'
import { CARD_INTERACTION, CARD_STYLE, StatusBadge } from './parts'

type Props = {
  items: ScheduleChangeItem[]
  data: TimetableData
  locale: string
  msg: TimetableMessages
  onOpen: (occurrenceId: string, date: string) => void
}

/** What changed, as one phrase: "Substitute: Alain · New time 18:30". */
export function describeChange(occ: TimetableOccurrence, data: TimetableData, msg: TimetableMessages, locale = 'en'): string {
  const series = data.series.find((s) => s.id === occ.seriesId)
  const c = changeOf(occ, series)
  if (c.cancelled) return msg.cancelled
  const parts: string[] = []
  if (c.substitute) {
    const names = occ.teacherIds.flatMap((id) => (data.teachers[id] ? [data.teachers[id].name] : []))
    parts.push(names.length > 0 ? msg.changeSubstitute(listNames(locale, names)) : msg.substituteBadge)
  }
  if (c.timeChanged) parts.push(msg.changeNewTime(timeRange(occ.start, occ.end)))
  if (c.moved) {
    const place = occ.placeKey ? data.places[occ.placeKey] : null
    parts.push(place ? msg.changeMovedTo(placeShort(place)) : msg.movedBadge)
  }
  return parts.join(' · ')
}

type ListProps = Props & { className?: string }

/** One sentence per change: "Hatha Yoga at 12:30 — Melissa Watkins replaces Sabrina Messal." */
export function changeSentence(occ: TimetableOccurrence, data: TimetableData, msg: TimetableMessages, locale = 'en'): string {
  const series = data.series.find((s) => s.id === occ.seriesId)
  const c = changeOf(occ, series)
  const course = data.courses[occ.courseId]?.title ?? ''
  const head = msg.courseAt(course, c.originalStart ?? occ.start)
  if (c.cancelled) return `${head} — ${msg.cancelled}`
  const names = (ids: string[]) => listNames(locale, ids.flatMap((id) => (data.teachers[id] ? [data.teachers[id].name] : [])))
  const parts: string[] = []
  if (c.substitute) {
    const now = names(occ.teacherIds)
    const was = names(c.originalTeacherIds ?? [])
    parts.push(now && was ? msg.replaces(now, was) : now ? msg.changeSubstitute(now) : msg.substituteBadge)
  }
  if (c.timeChanged) parts.push(msg.changeNewTime(timeRange(occ.start, occ.end)))
  if (c.moved) {
    const place = occ.placeKey ? data.places[occ.placeKey] : null
    parts.push(place ? msg.changeMovedTo(placeShort(place)) : msg.movedBadge)
  }
  return `${head} — ${parts.join(' · ')}`
}

const KIND_ORDER = ['cancelled', 'substitute', 'timeChanged', 'moved'] as const

function Items({ items, data, locale, msg, onOpen, card }: Props & { card: boolean }) {
  const byId = new Map(data.occurrences.map((o) => [o.id, o]))
  const label = (k: (typeof KIND_ORDER)[number]) => (k === 'cancelled' ? msg.cancelled : k === 'substitute' ? msg.teacherChange : k === 'timeChanged' ? msg.timeChangedBadge : msg.movedBadge)
  return (
    <>
      {items.map((item) => {
        const occ = byId.get(item.occurrenceId)
        if (!occ) return null
        const course = data.courses[occ.courseId]?.title ?? ''
        const what = `${course}, ${formatDate(locale, occ.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${timeRange(occ.start, occ.end)}`
        const sentence = changeSentence(occ, data, msg, locale)
        return (
          <li key={item.occurrenceId}>
            <button
              type="button"
              aria-label={`${msg.openDetails(what)} — ${sentence}`}
              onClick={() => onOpen(occ.id, occ.date)}
              className={`flex w-full flex-col gap-1.5 p-3.5 ${CARD_INTERACTION}`}
              style={card ? CARD_STYLE : { ...CARD_STYLE, border: 'none' }}
              data-update-item={item.kinds.join(' ')}
            >
              <span className="flex flex-wrap gap-1.5">
                {KIND_ORDER.filter((k) => item.kinds.includes(k)).map((k) => (
                  <StatusBadge key={k} kind={k}>
                    {label(k)}
                  </StatusBadge>
                ))}
              </span>
              <span className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {formatDate(locale, occ.date, { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
              <span className="text-sm leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                {sentence}
              </span>
            </button>
          </li>
        )
      })}
    </>
  )
}

/** Desktop: the changes in the shown week or month, as small cards above the calendar. Hidden when nothing changed. */
const DESKTOP_LIMIT = 6

export function ScheduleUpdates({ className = '', ...props }: ListProps) {
  const [all, setAll] = useState(false)
  if (props.items.length === 0) return null
  const items = all ? props.items : props.items.slice(0, DESKTOP_LIMIT)
  return (
    <div role="region" aria-label={props.msg.scheduleUpdates} data-schedule-updates className={`mb-8 p-4 ${className}`} style={{ borderRadius: 'var(--radius-lg)', backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 4%, var(--color-background))' }}>
      <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        <Info aria-hidden="true" width={18} height={18} strokeWidth={1.75} style={{ color: 'var(--color-text-secondary)' }} />
        {props.msg.scheduleUpdates}
      </h3>
      <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
        <Items {...props} items={items} card />
      </ul>
      {props.items.length > DESKTOP_LIMIT && (
        <button type="button" className="mt-3 text-sm font-medium underline underline-offset-2" style={{ color: 'var(--color-text-secondary)' }} aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? props.msg.showFewerChanges : props.msg.showAllChanges(props.items.length)}
        </button>
      )}
    </div>
  )
}

/**
 * Phone: a one-line pill that lives in the agenda's sticky header. Its height never changes (it says "No changes
 * this week" when empty), and the list opens as an overlay under the header, so nothing above the scrolled agenda
 * moves while weeks change.
 */
export function MobileScheduleUpdates(props: Props) {
  const { items, msg } = props
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const open = expanded && items.length > 0
  return (
    <div data-schedule-updates-mobile className="mt-2">
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between gap-2 px-3.5 text-left text-[13px] font-medium"
        style={{ borderRadius: 'var(--radius-btn)', color: items.length > 0 ? 'var(--color-text-primary)' : 'var(--color-text-muted)', backgroundColor: items.length > 0 ? 'color-mix(in srgb, var(--color-primary) 14%, var(--color-surface))' : 'color-mix(in srgb, var(--color-text-primary) 4%, var(--color-surface))' }}
        aria-expanded={open}
        aria-controls={listId}
        disabled={items.length === 0}
        onClick={() => setExpanded((v) => !v)}
        data-updates-summary
      >
        <span className="truncate">{items.length > 0 ? msg.scheduleChangesThisWeek(items.length) : msg.noScheduleChanges}</span>
        {items.length > 0 && <span aria-hidden="true">{open ? '−' : '+'}</span>}
      </button>
      {open && (
        <ul id={listId} aria-label={msg.scheduleUpdates} className="absolute inset-x-0 top-full z-20 flex max-h-[60vh] flex-col gap-2 overflow-auto px-1 py-3 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.25)]" style={{ backgroundColor: 'var(--color-background)', borderBottom: '1px solid var(--color-border)' }}>
          <Items {...props} card onOpen={(id, date) => { setExpanded(false); props.onOpen(id, date) }} />
        </ul>
      )}
    </div>
  )
}
