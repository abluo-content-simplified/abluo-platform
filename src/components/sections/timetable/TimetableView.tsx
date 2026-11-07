'use client'

// The interactive part of the Timetable section: week and month views on
// computers, one continuous agenda on phones, the schedule-updates list, the
// filters, the view switch, navigation and the print sheet. It receives the
// data the server hydrated (plain JSON) and asks the timetable route for other
// months. The route re-runs the page gate itself, so meeting details never
// depend on anything this component sends.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getTimetableMessages } from '@/lib/i18n/timetable-messages'
import {
  addMonths,
  anyVolunteer,
  closureOn,
  coveredMonths,
  isWeekend,
  languagesIn,
  mergeTimetables,
  monthOf,
  monthRange,
  monthWeeks,
  monthsOfDates,
  weekDates,
  weekStart,
  type TimetableData,
  type TimetableSeries,
} from '@/lib/modules/courses/timetable'
import { addDays } from '@/lib/scheduling/recurrence'
import { PrintView, teacherHref, type ProfileLinks } from './PrintSheet'
import { buildPrintDoc, monthsForPrint } from './print-model'
import { ClassPanel } from './ClassPanel'
import { ClassCard, EventCard } from './ClassCard'
import { entriesOn } from './entries'
import { ActiveFilters, FilterBar, type FilterChoices } from './FilterBar'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { applyFilters, filterOptions, NO_FILTERS, type Filters } from './filters'
import { MobileAgenda } from './MobileAgenda'
import { MobileScheduleUpdates, ScheduleUpdates } from './ScheduleUpdates'
import { scheduleChangesIn } from './status'
import { VolunteerNote, WEEKEND_BG } from './parts'
import { dayNumber, formatDate, monthTitle, weekdayName } from './format'
import type { CourseLinkContext } from '@/lib/modules/courses/website'

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
  /** Where the class panel's .ics download is served from (the same page gate); null = Google Calendar link only. */
  calendarEndpoint?: string | null
  pageId: string | null
  sectionKey: string
  profile: ProfileLinks
  /** Course pages (Courses module `courseSegment` in this language): the class panel links a course that has one. null = no links. */
  coursePage?: CourseLinkContext | null
  /** The site's host for the printed title (no www); null = left out. */
  siteHost?: string | null
  /** Where event pages live (`<site base>/events`); an event links to `<eventsBase>/<slug>`. */
  eventsBase?: string
  /** Notes under the timetable (server-rendered, shown to everyone) and members-only notes (present only when the server allowed them). */
  notes?: React.ReactNode
  membersNotes?: React.ReactNode
}

const MAX_MONTHS_FROM_TODAY = 24

const btn = 'inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-medium transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--color-text-primary)_6%,transparent)] disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]'
const iconBtn = btn.replace('gap-2 px-4', 'w-10 px-0')
const btnStyle = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' } as const

export function TimetableView({ locale, initial, defaultView, allowViewSwitch, showPrintButton, showCourseDescriptions = false, title, endpoint, calendarEndpoint = null, pageId, sectionKey, profile, coursePage = null, siteHost = null, eventsBase = '', notes = null, membersNotes = null }: TimetableViewProps) {
  const msg = useMemo(() => getTimetableMessages(locale), [locale])
  const [view, setView] = useState<View>(defaultView)
  const [anchor, setAnchor] = useState(initial.today)
  const [parts, setParts] = useState<TimetableData[]>([initial.data])
  const [covered, setCovered] = useState<Set<string>>(() => new Set(coveredMonths(initial.data.window)))
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState<Set<string>>(new Set())
  const inflight = useRef(new Map<string, Promise<boolean>>())
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  /** The session whose details panel is open (id), or null. */
  const [openId, setOpenId] = useState<string | null>(null)

  /** Phone layout (below md): null until known (server render and first paint show both, CSS picks one). */
  const [mobile, setMobile] = useState<boolean | null>(null)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(max-width: 767.98px)')
    const sync = () => setMobile(mq.matches)
    sync()
    mq.addEventListener?.('change', sync)
    return () => mq.removeEventListener?.('change', sync)
  }, [])

  const allData = useMemo(() => mergeTimetables(parts), [parts])
  /** Language, teacher, location and class filters (null = all). The printed month follows them. */
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const data = useMemo(() => applyFilters(allData, filters), [allData, filters])
  const today = initial.today
  const lastMonth = addMonths(monthOf(today), MAX_MONTHS_FROM_TODAY)
  const firstMonth = addMonths(monthOf(today), -MAX_MONTHS_FROM_TODAY)

  const fetchMonth = useCallback(
    (month: string): Promise<boolean> => {
      if (covered.has(month)) return Promise.resolve(true)
      const running = inflight.current.get(month)
      if (running) return running
      if (!endpoint || !pageId) return Promise.resolve(false)
      if (month < firstMonth || month > lastMonth) return Promise.resolve(false)
      setPending((s) => new Set(s).add(month))
      const job = (async (): Promise<boolean> => {
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
      })()
      inflight.current.set(month, job)
      return job
    },
    [covered, endpoint, pageId, sectionKey, firstMonth, lastMonth],
  )

  const monday = weekStart(anchor)
  const shownMonths = view === 'week' && mobile !== true ? monthsOfDates(weekDates(monday)) : [monthOf(anchor)]
  useEffect(() => {
    for (const m of shownMonths) if (!covered.has(m) && !failed.has(m)) void fetchMonth(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownMonths.join('|'), covered, failed])

  // The period on screen: the week or month on computers; on a phone, the week of the active day.
  const periodFrom = view === 'week' || mobile === true ? monday : monthRange(monthOf(anchor)).from
  const periodTo = view === 'week' || mobile === true ? addDays(monday, 6) : monthRange(monthOf(anchor)).to
  const periodSessions = useMemo(() => allData.occurrences.filter((o) => o.date >= periodFrom && o.date <= periodTo), [allData.occurrences, periodFrom, periodTo])
  const languages = useMemo(() => {
    const present = languagesIn(allData, mobile === true ? allData.occurrences : periodSessions, false)
    return filters.language && !present.includes(filters.language) ? [...present, filters.language].sort() : present
  }, [allData, periodSessions, filters.language, mobile])
  const choices = useMemo<FilterChoices>(() => ({ languages, ...filterOptions(allData, filters) }), [languages, allData, filters])
  const shownSessions = useMemo(() => (mobile === true ? data.occurrences : data.occurrences.filter((o) => o.date >= periodFrom && o.date <= periodTo)), [data.occurrences, periodFrom, periodTo, mobile])
  const volunteers = anyVolunteer(data, shownSessions)

  const loading = shownMonths.some((m) => pending.has(m)) || (mobile === true && pending.size > 0)
  const loadError = shownMonths.some((m) => failed.has(m)) || (mobile === true && failed.size > 0)

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
  const openOcc = useMemo(() => (openId ? (allData.occurrences.find((o) => o.id === openId) ?? null) : null), [openId, allData.occurrences])

  // Schedule updates: the changes in the period on screen, after the filters.
  const updates = useMemo(() => scheduleChangesIn(data, { from: periodFrom, to: periodTo }), [data, periodFrom, periodTo])
  const [focus, setFocus] = useState<{ date: string; nonce: number } | null>(null)
  const openUpdate = (id: string, date: string) => {
    setOpenId(id)
    if (mobile === true) setFocus((f) => ({ date, nonce: (f?.nonce ?? 0) + 1 }))
  }

  // ── Print: load the week / month on screen (and the neighbouring days a calendar row reaches into),
  // then open the print view — with the filters on screen.
  const printKind: 'week' | 'month' = view === 'week' ? 'week' : 'month'
  const [printOpen, setPrintOpen] = useState<{ kind: 'week' | 'month'; anchor: string; at: Date } | null>(null)
  const printDoc = useMemo(
    () =>
      printOpen
        ? buildPrintDoc(data, { kind: printOpen.kind, anchor: printOpen.anchor, title: title || msg.timetable, locale, msg, filters, allData, siteHost, eventsBase, now: printOpen.at, teacherHref: (t) => teacherHref(profile, t) })
        : null,
    [printOpen, data, title, msg, locale, filters, allData, siteHost, eventsBase, profile],
  )
  const onPrint = async () => {
    const kind = printKind
    const at = kind === 'week' ? monday : anchor
    await Promise.all(monthsForPrint(kind, at).map((m) => fetchMonth(m)))
    setPrintOpen({ kind, anchor: at, at: new Date() })
  }
  const closePrint = useCallback(() => setPrintOpen(null), [])

  const periodLabel =
    view === 'week'
      ? `${formatDate(locale, monday, { day: 'numeric', month: 'short' })} – ${formatDate(locale, addDays(monday, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`
      : monthTitle(locale, monthOf(anchor))

  const empty = allData.occurrences.length === 0 && allData.series.length === 0 && allData.events.length === 0
  const filterKey = `${filters.language}|${filters.teacher}|${filters.place}|${filters.course}`
  const desktopWrap = mobile === null ? 'hidden md:block' : ''
  const phoneWrap = mobile === null ? 'md:hidden' : ''
  const showDesktop = mobile !== true
  const showPhone = mobile !== false
  const onActiveChange = useCallback((d: string) => setAnchor(d), [])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3" data-timetable-toolbar>
        {showDesktop && (
          <div className={`${mobile === null ? 'hidden md:flex' : 'flex'} flex-wrap items-center gap-2`} role="group" aria-label={msg.navigation}>
            <button type="button" className={iconBtn} style={btnStyle} onClick={() => step(-1)} disabled={!canStep(-1)} aria-label={view === 'week' ? msg.previousWeek : msg.previousMonth}>
              <ChevronLeft aria-hidden="true" width={18} height={18} strokeWidth={1.75} />
            </button>
            <button type="button" className={iconBtn} style={btnStyle} onClick={() => step(1)} disabled={!canStep(1)} aria-label={view === 'week' ? msg.nextWeek : msg.nextMonth}>
              <ChevronRight aria-hidden="true" width={18} height={18} strokeWidth={1.75} />
            </button>
            <p className="mx-2 text-xl font-semibold" aria-live="polite" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
              {periodLabel}
            </p>
            <button type="button" className={btn} style={btnStyle} onClick={() => setAnchor(today)}>
              {msg.today}
            </button>
          </div>
        )}

        <div className={`${mobile === true ? 'hidden' : mobile === null ? 'hidden md:flex' : 'flex'} flex-wrap items-center gap-2`}>
          {allowViewSwitch && (
            <div className="flex p-1" role="group" aria-label={msg.viewSwitch} style={{ ...btnStyle, backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 5%, var(--color-surface))' }}>
              {(['week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className="h-8 px-4 text-sm font-medium transition-[background-color,box-shadow,color] duration-200"
                  style={{ borderRadius: 'var(--radius-btn)', color: view === v ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', backgroundColor: view === v ? 'var(--color-surface)' : 'transparent', boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === 'week' ? msg.viewWeek : msg.viewMonth}
                </button>
              ))}
            </div>
          )}
          <FilterBar filters={filters} onChange={setFilters} choices={choices} locale={locale} msg={msg} />
          {showPrintButton && (
            <button type="button" className={btn} style={btnStyle} onClick={onPrint}>
              <Printer aria-hidden="true" width={16} height={16} strokeWidth={1.75} />
              {printKind === 'week' ? msg.printWeek : msg.printMonth}
            </button>
          )}
        </div>
      </div>
      {mobile !== true && <ActiveFilters filters={filters} onChange={setFilters} choices={choices} locale={locale} msg={msg} className={mobile === null ? 'hidden md:flex' : ''} />}

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

      {!empty && mobile !== true && <ScheduleUpdates items={updates} data={data} locale={locale} msg={msg} onOpen={openUpdate} className={mobile === null ? 'hidden md:block' : ''} />}

      {empty && !loading && !loadError ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {msg.emptyTimetable}
        </p>
      ) : (
        <>
          {showDesktop && (
            <div className={desktopWrap}>
              {view === 'week' ? (
                <WeekView dates={weekDates(monday)} data={data} seriesById={seriesById} today={today} locale={locale} msg={msg} profile={profile} eventsBase={eventsBase} onOpen={setOpenId} />
              ) : (
                <MonthView month={monthOf(anchor)} data={data} seriesById={seriesById} today={today} locale={locale} msg={msg} profile={profile} eventsBase={eventsBase} onOpen={setOpenId} />
              )}
            </div>
          )}
          {showPhone && (
            <div className={phoneWrap}>
              <MobileAgenda
                data={data}
                seriesById={seriesById}
                today={today}
                initialDate={anchor}
                onActiveChange={onActiveChange}
                ensureMonth={fetchMonth}
                limits={{ first: firstMonth, last: lastMonth }}
                alignKey={filterKey}
                locale={locale}
                msg={msg}
                profile={profile}
                eventsBase={eventsBase}
                onOpen={setOpenId}
                enabled={mobile === true}
                headerExtra={<MobileScheduleUpdates items={updates} data={data} locale={locale} msg={msg} onOpen={openUpdate} />}
                filterButton={<FilterBar filters={filters} onChange={setFilters} choices={choices} locale={locale} msg={msg} compact />}
                focus={focus}
              />
            </div>
          )}
        </>
      )}

      {!empty && volunteers && <VolunteerNote text={msg.volunteerNote} />}
      {notes && <div className="mt-6" data-timetable-notes-wrap style={{ color: 'var(--color-text-secondary)' }}>{notes}</div>}
      {membersNotes && <div className="mt-4" data-members-notes style={{ color: 'var(--color-text-secondary)' }}>{membersNotes}</div>}

      <ClassPanel occ={openOcc} data={allData} seriesById={seriesById} locale={locale} msg={msg} profile={profile} coursePage={coursePage} calendar={{ endpoint: calendarEndpoint, pageId, sectionKey }} onClose={() => setOpenId(null)} />

      {showPrintButton && mounted && printDoc && (
        <PrintView open={!!printOpen} onClose={closePrint} doc={printDoc} msg={msg} notes={notes} membersNotes={membersNotes} showCourseDescriptions={showCourseDescriptions} />
      )}
    </div>
  )
}

// ── Desktop views ────────────────────────────────────────────────────────────

type ViewProps = {
  data: TimetableData
  seriesById: Map<string, TimetableSeries>
  today: string
  locale: string
  msg: ReturnType<typeof getTimetableMessages>
  profile: ProfileLinks
  eventsBase: string
  /** Opens the class details panel for a session id. */
  onOpen: (occurrenceId: string) => void
}

function WeekView({ dates, data, seriesById, today, locale, msg, profile, eventsBase, onOpen }: ViewProps & { dates: string[] }) {
  return (
    <div className="grid grid-cols-7 gap-3">
      {dates.map((date) => {
        const items = entriesOn(data, date)
        const closure = closureOn(data.closures, date)
        const isToday = date === today
        return (
          <section
            key={date}
            aria-label={formatDate(locale, date, { weekday: 'long', day: 'numeric', month: 'long' })}
            data-weekend={isWeekend(date) ? 'true' : undefined}
            className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-md)] p-1.5 pb-3"
            style={{ backgroundColor: isWeekend(date) ? WEEKEND_BG : 'transparent' }}
          >
            <h3 className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-1">
              <span className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: isToday ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                {weekdayName(locale, dates.indexOf(date) + 1, 'short')}
              </span>
              <span
                className="inline-flex h-8 min-w-8 items-center justify-center px-1.5 text-lg font-semibold tabular-nums"
                aria-current={isToday ? 'date' : undefined}
                style={{ fontFamily: 'var(--font-heading)', borderRadius: 'var(--radius-btn)', color: isToday ? 'var(--btn-primary-text, var(--color-background))' : 'var(--color-text-primary)', backgroundColor: isToday ? 'var(--color-primary)' : 'transparent' }}
              >
                {dayNumber(locale, date)}
              </span>
            </h3>
            {items.length === 0 ? (
              <p className="px-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {closure ? (closure.label ? `${msg.closed} · ${closure.label}` : msg.closed) : msg.noClasses}
              </p>
            ) : (
              items.map((entry) =>
                entry.kind === 'event' ? (
                  <EventCard key={entry.e.id} event={entry.e} variant="comfortable" msg={msg} eventsBase={eventsBase} />
                ) : (
                  <ClassCard key={entry.o.id} occ={entry.o} data={data} series={seriesById.get(entry.o.seriesId)} variant="comfortable" locale={locale} msg={msg} profile={profile} onOpen={onOpen} />
                ),
              )
            )}
          </section>
        )
      })}
    </div>
  )
}

function MonthView({ month, data, seriesById, today, locale, msg, profile, eventsBase, onOpen }: ViewProps & { month: string }) {
  const weeks = monthWeeks(month)
  const range = monthRange(month)

  return (
    <div role="table" aria-label={monthTitle(locale, month)} className="overflow-hidden" style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--color-border)' }}>
      <div className="grid grid-cols-7 gap-px" role="row">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} role="columnheader" className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--color-text-muted)', backgroundColor: i >= 5 ? WEEKEND_BG : 'var(--color-surface)' }}>
            {weekdayName(locale, i + 1, 'short')}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="mt-px grid grid-cols-7 gap-px" role="row">
          {week.map((date) => {
            const inMonth = date >= range.from && date <= range.to
            const items = inMonth ? entriesOn(data, date) : []
            const closure = inMonth ? closureOn(data.closures, date) : null
            const isToday = date === today
            return (
              <div
                key={date}
                role="cell"
                data-weekend={isWeekend(date) ? 'true' : undefined}
                className="flex min-h-28 min-w-0 flex-col gap-1.5 p-1.5"
                style={{ backgroundColor: isWeekend(date) ? WEEKEND_BG : 'var(--color-surface)' }}
              >
                <p className="flex items-center justify-between px-0.5">
                  <span
                    className="inline-flex h-6 min-w-6 items-center justify-center px-1 text-xs font-semibold tabular-nums"
                    aria-current={isToday ? 'date' : undefined}
                    style={{ borderRadius: 'var(--radius-btn)', color: isToday ? 'var(--btn-primary-text, var(--color-background))' : inMonth ? 'var(--color-text-primary)' : 'var(--color-text-muted)', backgroundColor: isToday ? 'var(--color-primary)' : 'transparent', opacity: inMonth ? 1 : 0.45 }}
                  >
                    {dayNumber(locale, date)}
                  </span>
                  {closure && items.length === 0 && (
                    <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                      {msg.closed}
                    </span>
                  )}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {items.map((entry) => (
                    <li key={entry.kind === 'class' ? entry.o.id : entry.e.id}>
                      {entry.kind === 'event' ? (
                        <EventCard event={entry.e} variant="compact" msg={msg} eventsBase={eventsBase} />
                      ) : (
                        <ClassCard occ={entry.o} data={data} series={seriesById.get(entry.o.seriesId)} variant="compact" locale={locale} msg={msg} profile={profile} onOpen={onOpen} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
