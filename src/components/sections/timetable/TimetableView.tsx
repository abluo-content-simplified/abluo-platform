'use client'

// The interactive part of the Timetable section: week and month views, the
// view switch, navigation and the print sheet. It receives the data the server
// hydrated (plain JSON) and asks the timetable route for other months. The
// route re-runs the page gate itself, so meeting details never depend on
// anything this component sends.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTimetableMessages, type TimetableMessages } from '@/lib/i18n/timetable-messages'
import {
  addMonths,
  buildPrintMonth,
  closureOn,
  coveredMonths,
  exceptionsOf,
  mergeTimetables,
  monthOf,
  monthRange,
  monthWeeks,
  monthsOfDates,
  weekDates,
  weekStart,
  type TimetableData,
  type TimetableOccurrence,
  type TimetableSeries,
} from '@/lib/modules/courses/timetable'
import { addDays } from '@/lib/scheduling/recurrence'
import { PRINT_CSS, PrintSheet, teacherHref, type ProfileLinks } from './PrintSheet'
import { ClassPanel } from './ClassPanel'
import { courseTint, Meeting } from './parts'
import { dayNumber, formatDate, languageName, monthTitle, splitTemplate, timeRange, weekdayName } from './format'

type View = 'week' | 'month'

export type TimetableViewProps = {
  locale: string
  initial: { month: string; today: string; data: TimetableData; onlineDetails: boolean }
  defaultView: View
  allowViewSwitch: boolean
  showPrintButton: boolean
  /** Print: add the "About the courses" page. */
  showCourseDescriptions?: boolean
  title: string
  /** Where other months are fetched from; null = no navigation beyond the hydrated data. */
  endpoint: string | null
  pageId: string | null
  sectionKey: string
  profile: ProfileLinks
}

const MAX_MONTHS_FROM_TODAY = 24

const btn = 'inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40'
const btnStyle = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)', color: 'var(--color-text-primary)', backgroundColor: 'transparent' } as const
const btnActive = { ...btnStyle, backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-background)' } as const

export function TimetableView({ locale, initial, defaultView, allowViewSwitch, showPrintButton, showCourseDescriptions = false, title, endpoint, pageId, sectionKey, profile }: TimetableViewProps) {
  const msg = useMemo(() => getTimetableMessages(locale), [locale])
  const [view, setView] = useState<View>(defaultView)
  const [anchor, setAnchor] = useState(initial.today)
  const [parts, setParts] = useState<TimetableData[]>([initial.data])
  const [covered, setCovered] = useState<Set<string>>(() => new Set(coveredMonths(initial.data.window)))
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const inflight = useRef(new Set<string>())
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  /** The session whose details panel is open (id), or null. */
  const [openId, setOpenId] = useState<string | null>(null)

  const data = useMemo(() => mergeTimetables(parts), [parts])
  const today = initial.today
  const lastMonth = addMonths(monthOf(today), MAX_MONTHS_FROM_TODAY)
  const firstMonth = addMonths(monthOf(today), -MAX_MONTHS_FROM_TODAY)

  const fetchMonth = useCallback(
    async (month: string): Promise<boolean> => {
      if (covered.has(month)) return true
      if (!endpoint || !pageId || inflight.current.has(month)) return false
      if (month < firstMonth || month > lastMonth) return false
      inflight.current.add(month)
      setPending((s) => new Set(s).add(month))
      try {
        const qs = new URLSearchParams({ page: pageId, section: sectionKey, month })
        const res = await fetch(`${endpoint}?${qs.toString()}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as TimetableData
        setParts((p) => [...p, next])
        setCovered((s) => new Set(s).add(month))
        setFailed((s) => {
          const n = new Set(s)
          n.delete(month)
          return n
        })
        return true
      } catch {
        setFailed((s) => new Set(s).add(month))
        return false
      } finally {
        inflight.current.delete(month)
        setPending((s) => {
          const n = new Set(s)
          n.delete(month)
          return n
        })
      }
    },
    [covered, endpoint, pageId, sectionKey, firstMonth, lastMonth],
  )

  const monday = weekStart(anchor)
  const shownMonths = view === 'week' ? monthsOfDates(weekDates(monday)) : [monthOf(anchor)]
  useEffect(() => {
    for (const m of shownMonths) if (!covered.has(m) && !failed.has(m)) void fetchMonth(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownMonths.join('|'), covered, failed])

  const loading = shownMonths.some((m) => pending.has(m))
  const loadError = shownMonths.some((m) => failed.has(m))

  const step = (dir: 1 | -1) => {
    if (view === 'week') setAnchor(addDays(anchor, 7 * dir))
    else {
      const next = addMonths(monthOf(anchor), dir)
      setAnchor(next === monthOf(today) ? today : `${next}-01`)
    }
  }
  const canStep = (dir: 1 | -1) => {
    const edge = view === 'week' ? monthOf(addDays(anchor, 7 * dir)) : addMonths(monthOf(anchor), dir)
    return edge >= firstMonth && edge <= lastMonth
  }

  const seriesById = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series])
  const openOcc = useMemo(() => (openId ? (data.occurrences.find((o) => o.id === openId) ?? null) : null), [openId, data.occurrences])

  // ── Print: make sure the month is loaded, then open the browser's print dialog.
  const printMonth = monthOf(anchor)
  const print = useMemo(() => buildPrintMonth(data, printMonth), [data, printMonth])
  const onPrint = async () => {
    await fetchMonth(printMonth)
    // Let React commit the merged data before the dialog freezes the page.
    setTimeout(() => window.print(), 50)
  }

  const periodLabel =
    view === 'week'
      ? `${formatDate(locale, monday, { day: 'numeric', month: 'short' })} – ${formatDate(locale, addDays(monday, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`
      : monthTitle(locale, monthOf(anchor))

  const empty = data.occurrences.length === 0 && data.series.length === 0

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={msg.navigation}>
          <button type="button" className={btn} style={btnStyle} onClick={() => step(-1)} disabled={!canStep(-1)} aria-label={view === 'week' ? msg.previousWeek : msg.previousMonth}>
            <span aria-hidden="true">‹</span>
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => setAnchor(today)}>
            {msg.today}
          </button>
          <button type="button" className={btn} style={btnStyle} onClick={() => step(1)} disabled={!canStep(1)} aria-label={view === 'week' ? msg.nextWeek : msg.nextMonth}>
            <span aria-hidden="true">›</span>
          </button>
          <p className="ml-1 text-base font-semibold" aria-live="polite" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
            {periodLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {allowViewSwitch && (
            <div className="flex gap-1" role="group" aria-label={msg.viewSwitch}>
              {(['week', 'month'] as const).map((v) => (
                <button key={v} type="button" className={btn} style={view === v ? btnActive : btnStyle} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === 'week' ? msg.viewWeek : msg.viewMonth}
                </button>
              ))}
            </div>
          )}
          {showPrintButton && (
            <button type="button" className={btn} style={btnStyle} onClick={onPrint}>
              {msg.printMonth}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <p className="mb-4 text-sm" role="status" style={{ color: 'var(--color-text-muted)' }}>
          {msg.loading}
        </p>
      )}
      {loadError && (
        <p className="mb-4 text-sm" role="alert" style={{ color: 'var(--color-text-secondary)' }}>
          {msg.loadError}
        </p>
      )}

      {empty && !loading && !loadError ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {msg.emptyTimetable}
        </p>
      ) : view === 'week' ? (
        <WeekView dates={weekDates(monday)} data={data} seriesById={seriesById} today={today} locale={locale} msg={msg} profile={profile} onOpen={setOpenId} />
      ) : (
        <MonthView month={monthOf(anchor)} data={data} seriesById={seriesById} today={today} locale={locale} msg={msg} profile={profile} onOpen={setOpenId} />
      )}

      <ClassPanel occ={openOcc} data={data} seriesById={seriesById} locale={locale} msg={msg} profile={profile} onClose={() => setOpenId(null)} />

      {showPrintButton &&
        mounted &&
        createPortal(
          <div className="ab-tt-print-root" aria-hidden="true">
            <style>{PRINT_CSS}</style>
            <PrintSheet print={print} data={data} title={title || msg.timetable} locale={locale} msg={msg} profile={profile} showCourseDescriptions={showCourseDescriptions} />
          </div>,
          document.body,
        )}
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

type ViewProps = {
  data: TimetableData
  seriesById: Map<string, TimetableSeries>
  today: string
  locale: string
  msg: TimetableMessages
  profile: ProfileLinks
  /** Opens the class details panel for a session id. */
  onOpen: (occurrenceId: string) => void
}

/** A class title that opens its details: a real button, named "Details: course, date, time". */
function OpenDetails({ occ, data, locale, msg, onOpen, children, className = '', style }: { occ: TimetableOccurrence; data: TimetableData; locale: string; msg: TimetableMessages; onOpen: (id: string) => void; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const what = `${data.courses[occ.courseId]?.title ?? ''}, ${formatDate(locale, occ.date, { weekday: 'long', day: 'numeric', month: 'long' })}, ${timeRange(occ.start, occ.end)}`
  return (
    <button type="button" aria-haspopup="dialog" aria-label={msg.openDetails(what)} onClick={() => onOpen(occ.id)} className={`cursor-pointer text-left hover:underline underline-offset-2 ${className}`} style={style}>
      {children}
    </button>
  )
}

function Teachers({ occ, seriesById, data, locale, msg, profile }: { occ: TimetableOccurrence; seriesById: Map<string, TimetableSeries>; data: TimetableData; locale: string; msg: TimetableMessages; profile: ProfileLinks }) {
  const list = occ.teacherIds.flatMap((id) => (data.teachers[id] ? [data.teachers[id]] : []))
  if (list.length === 0) return null
  const series = seriesById.get(occ.seriesId)
  const sub = !!series && exceptionsOf(occ, series).some((e) => e.kind === 'substitute')
  const [before, after] = splitTemplate(sub ? msg.substitute : msg.withTeachers)
  return (
    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      {before}
      {list.map((t, i) => {
        const href = teacherHref(profile, t)
        return (
          <span key={t.id}>
            {href ? (
              <a href={href} className="underline underline-offset-2">
                {t.name}
              </a>
            ) : (
              t.name
            )}
            {i < list.length - 1 ? ', ' : ''}
          </span>
        )
      })}
      {after}
    </p>
  )
}

function Badges({ occ, locale, msg }: { occ: TimetableOccurrence; locale: string; msg: TimetableMessages }) {
  const chip = 'inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest'
  const style = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)', color: 'var(--color-text-muted)' } as const
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {occ.mode === 'mixed' && (
        <span className={chip} style={style}>
          {msg.hybrid}
        </span>
      )}
      {occ.mode === 'online' && (
        <span className={chip} style={style}>
          {msg.online}
        </span>
      )}
      {occ.languages.length > 0 && (
        <span className={chip} style={style} title={occ.languages.map((l) => languageName(locale, l)).join(', ')}>
          {occ.languages.map((l) => l.toUpperCase()).join('/')}
        </span>
      )}
    </span>
  )
}

// ── Week ─────────────────────────────────────────────────────────────────────

function WeekView({ dates, data, seriesById, today, locale, msg, profile, onOpen }: ViewProps & { dates: string[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {dates.map((date) => {
        const items = data.occurrences.filter((o) => o.date === date)
        const closure = closureOn(data.closures, date)
        const isToday = date === today
        return (
          <section
            key={date}
            aria-label={formatDate(locale, date, { weekday: 'long', day: 'numeric', month: 'long' })}
            className="flex min-w-0 flex-col gap-2 p-3"
            style={{ border: '1px solid', borderColor: isToday ? 'var(--color-primary)' : 'var(--color-border)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--color-surface)' }}
          >
            <h3 className="flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: isToday ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
              <span>{weekdayName(locale, dates.indexOf(date) + 1, 'short')}</span>
              <span className="text-base normal-case tracking-normal" style={{ color: 'var(--color-text-primary)' }}>
                {dayNumber(locale, date)}
              </span>
            </h3>
            {items.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {closure ? (closure.label ? `${msg.closed} · ${closure.label}` : msg.closed) : msg.noClasses}
              </p>
            ) : (
              items.map((o) => {
                const course = data.courses[o.courseId]
                const cancelled = o.status === 'cancelled'
                const place = o.placeKey ? data.places[o.placeKey] : null
                return (
                  <article key={o.id} className="flex flex-col gap-1 pl-2" style={courseTint(course?.color ?? 'none')}>
                    <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
                      {timeRange(o.start, o.end)}
                    </p>
                    <p className="text-sm font-medium leading-snug" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
                      <OpenDetails occ={o} data={data} locale={locale} msg={msg} onOpen={onOpen}>
                        {course?.title}
                      </OpenDetails>
                    </p>
                    {cancelled ? (
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                        {msg.cancelled}
                        {o.note ? ` · ${o.note}` : ''}
                      </p>
                    ) : (
                      <>
                        <Teachers occ={o} seriesById={seriesById} data={data} locale={locale} msg={msg} profile={profile} />
                        {place && (
                          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {place.name}
                          </p>
                        )}
                        {o.note && (
                          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            {o.note}
                          </p>
                        )}
                      </>
                    )}
                    <Badges occ={o} locale={locale} msg={msg} />
                    <Meeting occ={o} data={data} msg={msg} />
                  </article>
                )
              })
            )}
          </section>
        )
      })}
    </div>
  )
}

// ── Month ────────────────────────────────────────────────────────────────────

function MonthView({ month, data, seriesById, today, locale, msg, profile, onOpen }: ViewProps & { month: string }) {
  const weeks = monthWeeks(month)
  const range = monthRange(month)
  const days = weeks.flat().filter((d) => d >= range.from && d <= range.to)
  const withClasses = days.filter((d) => data.occurrences.some((o) => o.date === d))

  return (
    <>
      {/* Calendar grid (tablet and up) */}
      <div className="hidden md:block" role="table" aria-label={monthTitle(locale, month)}>
        <div className="grid grid-cols-7 gap-px" role="row">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} role="columnheader" className="px-2 py-1 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-text-muted)' }}>
              {weekdayName(locale, i + 1, 'short')}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 gap-px" role="row">
            {week.map((date) => {
              const inMonth = date >= range.from && date <= range.to
              const items = inMonth ? data.occurrences.filter((o) => o.date === date) : []
              const closure = inMonth ? closureOn(data.closures, date) : null
              return (
                <div
                  key={date}
                  role="cell"
                  className="min-h-24 min-w-0 p-1.5"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: inMonth ? 'var(--color-surface)' : 'transparent', outline: date === today ? '2px solid var(--color-primary)' : undefined, outlineOffset: '-2px', opacity: inMonth ? 1 : 0.4 }}
                >
                  <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {dayNumber(locale, date)}
                  </p>
                  {closure && items.length === 0 && (
                    <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {msg.closed}
                    </p>
                  )}
                  <ul className="flex flex-col gap-0.5">
                    {items.map((o) => {
                      const cancelled = o.status === 'cancelled'
                      return (
                        <li key={o.id} className="truncate text-[11px] leading-snug" style={{ color: 'var(--color-text-secondary)', textDecoration: cancelled ? 'line-through' : undefined }} title={`${timeRange(o.start, o.end)} ${data.courses[o.courseId]?.title ?? ''}${cancelled ? ` — ${msg.cancelled}` : ''}`}>
                          <OpenDetails occ={o} data={data} locale={locale} msg={msg} onOpen={onOpen} className="block w-full truncate">
                            <span className="tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
                              {o.start}
                            </span>{' '}
                            {data.courses[o.courseId]?.title}
                            {cancelled && <span className="sr-only"> ({msg.cancelled})</span>}
                            {!cancelled && o.mode === 'mixed' && <span className="sr-only"> ({msg.hybrid})</span>}
                          </OpenDetails>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Agenda (phone): only the days that have classes */}
      <div className="flex flex-col gap-3 md:hidden">
        {withClasses.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {msg.noClasses}
          </p>
        )}
        {withClasses.map((date) => (
          <section key={date} aria-label={formatDate(locale, date, { weekday: 'long', day: 'numeric', month: 'long' })} className="p-3" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--color-surface)' }}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: date === today ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
              {formatDate(locale, date, { weekday: 'short', day: 'numeric', month: 'short' })}
            </h3>
            <ul className="flex flex-col gap-2">
              {data.occurrences
                .filter((o) => o.date === date)
                .map((o) => {
                  const cancelled = o.status === 'cancelled'
                  return (
                    <li key={o.id} className="flex flex-col gap-0.5 pl-2" style={courseTint(data.courses[o.courseId]?.color ?? 'none')}>
                      <p className="text-sm" style={{ color: 'var(--color-text-primary)', textDecoration: cancelled ? 'line-through' : undefined }}>
                        <OpenDetails occ={o} data={data} locale={locale} msg={msg} onOpen={onOpen}>
                          <span className="tabular-nums font-semibold">{timeRange(o.start, o.end)}</span> {data.courses[o.courseId]?.title}
                        </OpenDetails>
                      </p>
                      {cancelled ? (
                        <p className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                          {msg.cancelled}
                          {o.note ? ` · ${o.note}` : ''}
                        </p>
                      ) : (
                        <Teachers occ={o} seriesById={seriesById} data={data} locale={locale} msg={msg} profile={profile} />
                      )}
                      <Badges occ={o} locale={locale} msg={msg} />
                      <Meeting occ={o} data={data} msg={msg} />
                    </li>
                  )
                })}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
