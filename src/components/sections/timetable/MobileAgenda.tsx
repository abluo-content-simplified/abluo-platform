'use client'

// The phone timetable: ONE continuous vertical agenda (below the md
// breakpoint). Every day of the loaded range is listed (days without classes
// show a compact "No classes"), under a sticky 7-day date strip with the month
// and year and a "go to date" control. The active day follows the scroll: an
// IntersectionObserver watches a 1px band just under the strip and, when a day
// crosses it, the active day is picked from the day positions (pickActiveDay).
// The strip moves to the next / previous week when the active day leaves it.
// While the page scrolls because of a tap on the strip or the date picker the
// observer is ignored until the scroll settles, so the two never fight.
// Weeks are loaded on demand at either end through `ensureMonth` (the same
// month route the desktop navigation uses).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { closureOn, isWeekend, monthOf, monthRange, weekDates, weekStart, type TimetableData } from '@/lib/modules/courses/timetable'
import { addDays } from '@/lib/scheduling/recurrence'
import type { TimetableMessages } from '@/lib/i18n/timetable-messages'
import type { TimetableSeries } from '@/lib/modules/courses/timetable'
import { datesBetween, nextStripMonday, pickActiveDay } from './agenda'
import { ClassCard, EventCard } from './ClassCard'
import { entriesOn } from './entries'
import { formatDate, monthTitle, weekdayName, dayNumber } from './format'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ProfileLinks } from './PrintSheet'

export type MobileAgendaProps = {
  data: TimetableData
  seriesById: Map<string, TimetableSeries>
  today: string
  /** The day the agenda opens on. */
  initialDate: string
  /** Called whenever the active day changes. */
  onActiveChange: (date: string) => void
  /** Loads a month (true = its data is available). */
  ensureMonth: (month: string) => Promise<boolean>
  /** The first and last month that may be loaded. */
  limits: { first: string; last: string }
  /** Changes whenever the filters change: the agenda re-aligns on the active day. */
  alignKey: string
  locale: string
  msg: TimetableMessages
  profile: ProfileLinks
  eventsBase: string
  onOpen: (occurrenceId: string) => void
  /** True only when the phone layout is on screen. Until then (server render, desktop) nothing observes, scrolls or reports. */
  enabled: boolean
  /** Rendered inside the sticky header, under the strip (constant height): the schedule-updates pill. */
  headerExtra?: React.ReactNode
  /** A date to bring into view (set by "schedule updates"); `nonce` makes the same date repeatable. */
  focus: { date: string; nonce: number } | null
  /** The Filters button, shown in the sticky header. */
  filterButton?: React.ReactNode
}

/** How far back the phone agenda goes: two weeks before the current week. */
export const PAST_WEEKS = 2

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const GAP = 8

export function MobileAgenda({ data, seriesById, today, initialDate, onActiveChange, ensureMonth, limits, alignKey, locale, msg, profile, eventsBase, onOpen, enabled, headerExtra, focus, filterButton }: MobileAgendaProps) {
  /** The earliest day the agenda shows: the Monday two weeks before this week. */
  const minDate = addDays(weekStart(today), -7 * PAST_WEEKS)
  const [range, setRange] = useState(() => {
    const start = initialDate < minDate ? minDate : initialDate
    const m = monthOf(start)
    const from = weekStart(start) > monthRange(m).from ? weekStart(start) : monthRange(m).from
    return { from: from < minDate ? minDate : from, to: monthRange(m).to }
  })
  const [active, setActive] = useState(initialDate)
  const [stripWeek, setStripWeek] = useState(() => weekStart(initialDate))
  // The strip keeps its week while the active day is inside it and moves to the active day's week when it leaves.
  const stripMonday = nextStripMonday(active, stripWeek)
  if (stripMonday !== stripWeek) setStripWeek(stripMonday)

  const stripRef = useRef<HTMLDivElement | null>(null)
  const dayEls = useRef(new Map<string, HTMLElement>())
  const topSentinel = useRef<HTMLDivElement | null>(null)
  const bottomSentinel = useRef<HTMLDivElement | null>(null)
  const programmatic = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interacted = useRef(false)
  const shift = useRef<{ date: string; top: number } | null>(null)
  const pendingScroll = useRef<string | null>(null)
  const extending = useRef(false)
  const enabledRef = useRef(enabled)
  /** True once the agenda has been aligned on its first day: only then does it report the active day. */
  const [ready, setReady] = useState(false)
  const latest = useRef({ ensureMonth, limits, range, minDate })
  useLayoutEffect(() => {
    latest.current = { ensureMonth, limits, range, minDate }
    enabledRef.current = enabled
  })

  const dates = useMemo(() => datesBetween(range.from, range.to), [range.from, range.to])

  const lineOf = useCallback(() => (stripRef.current ? stripRef.current.getBoundingClientRect().bottom : 0) + GAP, [])

  const choose = useCallback(() => {
    // A hidden agenda (desktop) has no layout: every day would read as 0 and the last one would win.
    if (!enabledRef.current || !stripRef.current || stripRef.current.offsetParent === null) return
    const days = [...dayEls.current.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, el]) => ({ date, top: el.getBoundingClientRect().top }))
    const next = pickActiveDay(days, lineOf())
    if (next) setActive((cur) => (cur === next ? cur : next))
  }, [lineOf])

  // ── Programmatic scrolling: ignore the observer until the page settles. ────
  const settle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      programmatic.current = false
      settleTimer.current = null
      choose()
      setReady(true)
    }, 140)
  }, [choose])

  const scrollToEl = useCallback(
    (el: HTMLElement, smooth: boolean) => {
      programmatic.current = true
      const top = el.getBoundingClientRect().top + window.scrollY - lineOf() + 1
      window.scrollTo({ top: Math.max(0, top), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
      settle()
    },
    [lineOf, settle],
  )

  const goTo = useCallback(
    async (target: string, smooth = true) => {
      const date = target < latest.current.minDate ? latest.current.minDate : target
      setActive(date)
      programmatic.current = true
      const el = dayEls.current.get(date)
      if (el) {
        scrollToEl(el, smooth)
        return
      }
      // Outside the rendered range: load that month, show just it, scroll once it is in the DOM.
      const m = monthOf(date)
      if (m < latest.current.limits.first || m > latest.current.limits.last) {
        programmatic.current = false
        return
      }
      const ok = await latest.current.ensureMonth(m)
      if (!ok) {
        programmatic.current = false
        return
      }
      pendingScroll.current = date
      const r = monthRange(m)
      setRange({ from: r.from < latest.current.minDate ? latest.current.minDate : r.from, to: r.to })
    },
    [scrollToEl],
  )

  // After the range changed: finish a pending jump, or keep the reading position when days were added above.
  useLayoutEffect(() => {
    if (pendingScroll.current) {
      const date = pendingScroll.current
      const el = dayEls.current.get(date)
      if (el) {
        pendingScroll.current = null
        scrollToEl(el, false)
      }
      return
    }
    if (shift.current) {
      const { date, top } = shift.current
      shift.current = null
      const el = dayEls.current.get(date)
      if (el) {
        programmatic.current = true
        const delta = el.getBoundingClientRect().top - top
        if (delta !== 0) window.scrollBy({ top: delta, behavior: 'auto' })
        settle()
      }
    }
  }, [range.from, range.to, scrollToEl, settle])

  // ── Active day → parent, strip week ───────────────────────────────────────
  useEffect(() => {
    if (enabled && ready) onActiveChange(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready, enabled])

  // First alignment, once the phone layout is on screen: the initial day sits on the threshold line (instant, no
  // smooth scroll); the days before it stay above, reachable by scrolling up.
  useEffect(() => {
    if (!enabled) return
    const align = () => {
      if (interacted.current) return
      const el = dayEls.current.get(active)
      if (el) scrollToEl(el, false)
      else settle()
    }
    align()
    // Web fonts and images change the heights above the day: align again once they have loaded, unless the person
    // already scrolled.
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) align()
    })
    const late = setTimeout(align, 400)
    return () => {
      cancelled = true
      clearTimeout(late)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // ── Active day from scroll: IntersectionObserver on a 1px band under the strip. ──
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return
    let io: IntersectionObserver | null = null
    const connect = () => {
      io?.disconnect()
      const line = Math.round(lineOf())
      const bottom = Math.max(0, window.innerHeight - line - 1)
      io = new IntersectionObserver(
        () => {
          if (!programmatic.current) choose()
        },
        { rootMargin: `-${line}px 0px -${bottom}px 0px`, threshold: 0 },
      )
      for (const el of dayEls.current.values()) io.observe(el)
    }
    connect()
    window.addEventListener('resize', connect)
    return () => {
      window.removeEventListener('resize', connect)
      io?.disconnect()
    }
  }, [dates, lineOf, choose, enabled])

  // A real scroll (touch, wheel, keys) from the person ends "programmatic" suppression early and allows loading upwards.
  useEffect(() => {
    const mark = () => {
      interacted.current = true
    }
    const onScroll = () => {
      if (programmatic.current) settle()
    }
    window.addEventListener('wheel', mark, { passive: true })
    window.addEventListener('touchstart', mark, { passive: true })
    window.addEventListener('keydown', mark)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('wheel', mark)
      window.removeEventListener('touchstart', mark)
      window.removeEventListener('keydown', mark)
      window.removeEventListener('scroll', onScroll)
      if (settleTimer.current) clearTimeout(settleTimer.current)
    }
  }, [settle])

  // ── Loading more at either end ─────────────────────────────────────────────
  const extend = useCallback(
    async (dir: 1 | -1) => {
      if (extending.current) return
      const { range: r, limits: l, ensureMonth: ensure } = latest.current
      if (dir === 1) {
        const next = monthOf(addDays(r.to, 1))
        if (next > l.last) return
        extending.current = true
        try {
          if (await ensure(next)) setRange((cur) => ({ ...cur, to: monthRange(next).to }))
        } finally {
          extending.current = false
        }
        return
      }
      const floor = latest.current.minDate
      if (r.from <= floor) return
      const startOfMonth = monthRange(monthOf(r.from)).from
      const prev = monthOf(addDays(startOfMonth, -1))
      const needsFetch = r.from <= startOfMonth
      if (needsFetch && prev < l.first) return
      extending.current = true
      try {
        const ok = needsFetch ? await ensure(prev) : true
        if (!ok) return
        const anchorEl = dayEls.current.get(r.from)
        if (anchorEl) shift.current = { date: r.from, top: anchorEl.getBoundingClientRect().top }
        setRange((cur) => {
          const from = needsFetch ? monthRange(prev).from : startOfMonth
          return { ...cur, from: from < floor ? floor : from }
        })
      } finally {
        extending.current = false
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !ready || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          if (e.target === bottomSentinel.current) void extend(1)
          else if (e.target === topSentinel.current && interacted.current) void extend(-1)
        }
      },
      { rootMargin: '400px 0px 400px 0px' },
    )
    if (topSentinel.current) io.observe(topSentinel.current)
    if (bottomSentinel.current) io.observe(bottomSentinel.current)
    return () => io.disconnect()
  }, [range.from, range.to, extend, enabled, ready])

  // Filters changed: the content reflowed, so bring the selected day back under the strip.
  const firstAlign = useRef(true)
  useEffect(() => {
    if (firstAlign.current) {
      firstAlign.current = false
      return
    }
    if (!enabledRef.current) return
    const el = dayEls.current.get(active)
    if (el) scrollToEl(el, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alignKey])

  // A "schedule updates" item asked for a date.
  useEffect(() => {
    if (focus && enabledRef.current) queueMicrotask(() => void goTo(focus.date, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])

  const stripDates = weekDates(stripMonday)
  const setEl = (date: string) => (el: HTMLElement | null) => {
    if (el) dayEls.current.set(date, el)
    else dayEls.current.delete(date)
  }
  const hasClasses = (d: string) => data.occurrences.some((o) => o.date === d && o.status !== 'cancelled') || data.events.some((e) => e.date === d)
  const canBack = addDays(stripMonday, -1) >= minDate
  const stepWeek = (dir: 1 | -1) => {
    const target = addDays(stripMonday, 7 * dir)
    void goTo(dir === -1 && target < minDate ? minDate : target)
  }
  // Swipe the strip sideways to change weeks.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const dateInput = useRef<HTMLInputElement | null>(null)
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try {
      ;(el as HTMLInputElement & { showPicker?: () => void }).showPicker?.()
    } catch {
      el.focus()
    }
  }

  return (
    <div data-agenda aria-label={msg.agendaLabel} role="region">
      <div
        ref={stripRef}
        data-agenda-strip
        className="sticky z-10 -mx-4 px-4 pb-3 pt-3 backdrop-blur-xl"
        style={{ top: 'var(--site-header-h, 0px)', backgroundColor: 'color-mix(in srgb, var(--color-background) 92%, transparent)', boxShadow: '0 1px 0 var(--color-border)' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button type="button" className={ROUND} style={ROUND_STYLE} onClick={() => stepWeek(-1)} disabled={!canBack} aria-label={msg.previousWeekShort}>
              <ChevronLeft aria-hidden="true" width={18} height={18} strokeWidth={1.75} />
            </button>
            <span className="relative">
              <button type="button" onClick={openPicker} className="whitespace-nowrap px-1.5 text-[17px] font-semibold" aria-live="polite" data-agenda-month style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }} aria-label={`${monthTitle(locale, monthOf(active))} — ${msg.jumpToDate}`}>
                {monthTitle(locale, monthOf(active))}
              </button>
              <input
                ref={dateInput}
                type="date"
                aria-label={msg.jumpToDate}
                tabIndex={-1}
                value={active}
                min={minDate}
                max={monthRange(limits.last).to}
                onChange={(e) => e.target.value && void goTo(e.target.value)}
                className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
              />
            </span>
            <button type="button" className={ROUND} style={ROUND_STYLE} onClick={() => stepWeek(1)} aria-label={msg.nextWeekShort}>
              <ChevronRight aria-hidden="true" width={18} height={18} strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {active !== today && (
              <button type="button" className="h-9 px-3 text-sm font-medium" style={ROUND_STYLE} onClick={() => void goTo(today)}>
                {msg.today}
              </button>
            )}
            {filterButton}
          </div>
        </div>
        <div
          className="grid touch-pan-y grid-cols-7 gap-1.5"
          role="group"
          aria-label={msg.weekStripLabel}
          onTouchStart={(e) => {
            const t = e.touches[0]
            swipe.current = { x: t.clientX, y: t.clientY }
          }}
          onTouchEnd={(e) => {
            const start = swipe.current
            swipe.current = null
            if (!start) return
            const t = e.changedTouches[0]
            const dx = t.clientX - start.x
            const dy = t.clientY - start.y
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              if (dx < 0) stepWeek(1)
              else if (canBack) stepWeek(-1)
            }
          }}
        >
          {stripDates.map((d, i) => {
            const isActive = d === active
            const isToday = d === today
            const disabled = d < minDate
            return (
              <button
                key={d}
                type="button"
                data-strip-day={d}
                disabled={disabled}
                aria-current={isActive ? 'date' : undefined}
                aria-label={formatDate(locale, d, { weekday: 'long', day: 'numeric', month: 'long' })}
                onClick={() => void goTo(d)}
                className="flex flex-col items-center gap-1 py-2 transition-[background-color,border-color] duration-200 disabled:opacity-35"
                style={{
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid',
                  borderColor: isActive ? 'color-mix(in srgb, var(--color-primary) 35%, transparent)' : 'transparent',
                  backgroundColor: isActive ? 'color-mix(in srgb, var(--color-primary) 18%, var(--color-surface))' : 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                }}
              >
                <span className="text-[11px] font-medium uppercase" style={{ color: 'var(--color-text-muted)' }}>
                  {weekdayName(locale, i + 1, 'narrow')}
                </span>
                <span className="text-lg leading-none tabular-nums" style={{ fontWeight: isActive || isToday ? 700 : 500, color: isToday && !isActive ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>
                  {dayNumber(locale, d)}
                </span>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hasClasses(d) ? (isActive ? 'var(--color-primary)' : 'var(--color-text-muted)') : 'transparent' }} />
              </button>
            )
          })}
        </div>
        {headerExtra}
      </div>

      <div ref={topSentinel} aria-hidden="true" />
      <div className="mt-5 flex flex-col gap-7">
        {dates.map((date) => {
          const items = entriesOn(data, date)
          const closure = closureOn(data.closures, date)
          const label = formatDate(locale, date, { weekday: 'long', day: 'numeric', month: 'long' })
          const isToday = date === today
          const count = items.filter((e) => e.kind !== 'class' || e.o.status !== 'cancelled').length
          return (
            <section key={date} ref={setEl(date)} data-date={date} data-weekend={isWeekend(date) ? 'true' : undefined} aria-labelledby={`ab-ag-${date}`}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 id={`ab-ag-${date}`} className="text-[17px] font-semibold" style={{ color: isToday ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>
                  <time dateTime={date}>{label}</time>
                </h3>
                <p className="shrink-0 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {items.length === 0 ? (closure ? (closure.label ? `${msg.closed} · ${closure.label}` : msg.closed) : msg.noClasses) : msg.classesCount(count)}
                </p>
              </div>
              {items.length > 0 && (
                <ul className="flex flex-col gap-3">
                  {items.map((entry) => (
                    <li key={entry.kind === 'class' ? entry.o.id : entry.e.id}>
                      {entry.kind === 'event' ? (
                        <EventCard event={entry.e} variant="mobile" msg={msg} eventsBase={eventsBase} />
                      ) : (
                        <ClassCard occ={entry.o} data={data} series={seriesById.get(entry.o.seriesId)} variant="mobile" locale={locale} msg={msg} profile={profile} onOpen={onOpen} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
      <div ref={bottomSentinel} aria-hidden="true" className="h-px" />
    </div>
  )
}

const ROUND = 'inline-flex h-9 w-9 items-center justify-center transition-colors disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]'
const ROUND_STYLE = { border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-surface)' } as const
