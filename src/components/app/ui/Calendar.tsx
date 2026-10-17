'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  addDays,
  addMonths,
  isInRange,
  monthGrid,
  monthOf,
  parseISO,
  pickDay,
  todayISO,
  weekdayOrder,
  weekStartForLocale,
  type DateRange,
  type YearMonth,
} from '@/lib/client/date-range'

/**
 * Just the calendar: a month grid (one month, or two side by side) with
 * month arrows and full keyboard support (arrows, PageUp/PageDown, Home/End).
 * No frame, no buttons, no sheet — put it inside whatever needs a calendar
 * (DateRangePicker's popover, DateTimePicker's sheet, an overlay with a close
 * button and extra information…).
 *
 *   mode="single": value is one ISO day (YYYY-MM-DD) or null.
 *   mode="range":  value is { from, to }; first tap = start, second = end
 *                  (swapped if earlier), hover previews the range.
 *
 * `min` / `max` (ISO days, inclusive) switch the days outside off.
 *
 *   <Calendar mode="single" value={day} onChange={setDay} min={today} />
 *   <Calendar mode="range" value={range} onChange={setRange} months={2} />
 */
type SingleProps = { mode: 'single'; value: string | null; onChange: (day: string) => void }
type RangeProps = { mode: 'range'; value: DateRange; onChange: (range: DateRange) => void }

export type CalendarProps = (SingleProps | RangeProps) & {
  /** Months shown side by side (2 = 17.5rem each, for wide popovers). */
  months?: 1 | 2
  /** First and last day that can be picked (inclusive). */
  min?: string
  max?: string
  className?: string
}

const NAV =
  'grid size-10 place-items-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent'
const arrow = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
// Every role="row" is its own seven-column grid (static class names so
// Tailwind always generates them). The cells must be direct children of the
// row: a wrapper in between, or an interpolated column class Tailwind never
// generated, leaves a one-column grid and the days stack.
const ROW = 'grid grid-cols-7'
const ym = (iso: string) => {
  const p = parseISO(iso)!
  return p.y * 12 + p.m
}

export function Calendar(props: CalendarProps) {
  const { months = 1, min, max, className = '' } = props
  const t = useTranslations('app.ui.calendar')
  const locale = useLocale()
  const today = useMemo(() => todayISO(), [])
  const weekStart = useMemo(() => weekStartForLocale(locale), [locale])
  const range: DateRange = props.mode === 'range' ? props.value : { from: props.value, to: props.value }
  const start = range.from ?? (min && today < min ? min : today)
  const [view, setView] = useState<YearMonth>(() => monthOf(start) ?? { y: 2026, m: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [focus, setFocus] = useState<string>(start)
  const gridRef = useRef<HTMLDivElement>(null)
  const wantFocus = useRef(false)

  const monthFmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }), [locale])
  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), [locale])
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }), [locale])
  const weekdays = useMemo(
    () => weekdayOrder(weekStart).map((w) => weekdayFmt.format(new Date(Date.UTC(2026, 0, 4 + w))).replace('.', '').slice(0, 2)),
    [weekStart, weekdayFmt]
  )
  const shown = useMemo(() => Array.from({ length: months }, (_, i) => addMonths(view, i)), [view, months])
  const outside = (iso: string) => (min ? iso < min : false) || (max ? iso > max : false)
  const canPrev = !min || view.y * 12 + view.m > ym(min)
  const lastShown = shown[shown.length - 1]
  const canNext = !max || lastShown.y * 12 + lastShown.m < ym(max)

  // Range mode previews the range while hovering after the first tap.
  const previewTo = props.mode === 'range' && range.from && !range.to ? hover : range.to

  const moveFocus = (iso: string) => {
    if (outside(iso)) return
    setFocus(iso)
    const idx = ym(iso)
    const p = parseISO(iso)!
    if (idx < shown[0].y * 12 + shown[0].m) setView({ y: p.y, m: p.m })
    else if (idx > lastShown.y * 12 + lastShown.m) setView(addMonths({ y: p.y, m: p.m }, -(months - 1)))
    wantFocus.current = true
  }
  useEffect(() => {
    if (!wantFocus.current) return
    wantFocus.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus()
  })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (e.key in step) {
      e.preventDefault()
      moveFocus(addDays(focus, step[e.key]))
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const p = parseISO(focus)!
      const n = addMonths({ y: p.y, m: p.m }, e.key === 'PageUp' ? -1 : 1)
      moveFocus(`${String(n.y).padStart(4, '0')}-${String(n.m + 1).padStart(2, '0')}-${String(Math.min(p.d, 28)).padStart(2, '0')}`)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const p = parseISO(focus)!
      const off = (new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay() - weekStart + 7) % 7
      moveFocus(addDays(focus, e.key === 'Home' ? -off : 6 - off))
    }
    // Enter / Space activate the focused day button natively.
  }

  const pick = (iso: string) => {
    if (props.mode === 'range') props.onChange(pickDay(props.value, iso))
    else props.onChange(iso)
    setFocus(iso)
    setHover(null)
  }

  const cellH = months === 2 ? 'h-10' : 'h-11'
  const lo = range.from && previewTo ? (range.from <= previewTo ? range.from : previewTo) : range.from
  const hi = range.from && previewTo ? (range.from <= previewTo ? previewTo : range.from) : range.from

  return (
    <div ref={gridRef} className={`flex items-start gap-6 ${className}`} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
      {shown.map((month, i) => {
        const monthName = monthFmt.format(new Date(month.y, month.m, 1, 12))
        return (
          <div key={`${month.y}-${month.m}`} className={months === 2 ? 'w-[17.5rem] shrink-0' : 'w-full'}>
            <div className="mb-1 flex h-10 items-center justify-between gap-2">
              {i === 0 ? (
                <button type="button" aria-label={t('prevMonth')} disabled={!canPrev} onClick={() => setView(addMonths(view, -1))} className={NAV}>
                  {arrow('m15 6-6 6 6 6')}
                </button>
              ) : (
                <span className="size-10" aria-hidden="true" />
              )}
              <h3 className="truncate text-[0.9375rem] font-semibold whitespace-nowrap first-letter:uppercase" aria-live="polite">
                {monthName}
              </h3>
              {i === shown.length - 1 ? (
                <button type="button" aria-label={t('nextMonth')} disabled={!canNext} onClick={() => setView(addMonths(view, 1))} className={NAV}>
                  {arrow('m9 6 6 6-6 6')}
                </button>
              ) : (
                <span className="size-10" aria-hidden="true" />
              )}
            </div>
            <div role="grid" aria-label={monthName} className="flex flex-col">
              <div role="row" className={ROW}>
                {weekdays.map((w, wi) => (
                  <span key={wi} role="columnheader" className="grid h-8 place-items-center text-[0.8125rem] font-medium text-muted-foreground capitalize">
                    {w}
                  </span>
                ))}
              </div>
              {monthGrid(month.y, month.m, weekStart).map((week, wi) => (
                <div key={wi} role="row" className={ROW}>
                  {week.map((c) => {
                    if (!c.inMonth) return <span key={c.iso} role="gridcell" aria-hidden="true" className={cellH} />
                    const off = outside(c.iso)
                    const inside = props.mode === 'range' && isInRange(c.iso, range.from, previewTo)
                    const edge = c.iso === lo || c.iso === hi
                    const selected = c.iso === range.from || (!!range.to && c.iso === range.to)
                    const span = inside && lo !== hi
                    const p = parseISO(c.iso)!
                    return (
                      <span
                        key={c.iso}
                        role="gridcell"
                        aria-selected={selected || inside}
                        className={`flex ${cellH} items-center justify-center ${span ? 'bg-action/15' : ''} ${span && c.iso === lo ? 'rounded-l-full' : ''} ${
                          span && c.iso === hi ? 'rounded-r-full' : ''
                        }`}
                      >
                        <button
                          type="button"
                          data-iso={c.iso}
                          disabled={off}
                          tabIndex={c.iso === focus ? 0 : -1}
                          aria-label={dayFmt.format(new Date(p.y, p.m, c.day, 12))}
                          aria-current={c.iso === today ? 'date' : undefined}
                          onClick={() => pick(c.iso)}
                          onMouseEnter={() => setHover(c.iso)}
                          onFocus={() => setFocus(c.iso)}
                          className={`grid size-10 place-items-center rounded-full text-center text-[0.9375rem] tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent ${
                            edge ? 'bg-action font-semibold text-action-foreground' : 'text-foreground hover:bg-hover'
                          } ${c.iso === today ? 'underline decoration-2 underline-offset-4' : ''}`}
                        >
                          {c.day}
                        </button>
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
