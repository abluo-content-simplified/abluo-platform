'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { BottomSheet } from './BottomSheet'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from './anchored-popover'
import {
  addDays,
  addMonths,
  isInRange,
  monthGrid,
  monthOf,
  parseISO,
  pickDay,
  presetRange,
  todayISO,
  weekdayOrder,
  weekStartForLocale,
  type DateRange,
  type RangePreset,
  type YearMonth,
} from '@/lib/client/date-range'

/**
 * Date range filter for a FilterBar. Renders, in a row: quick-range toggle
 * chips ("Last 7 days", "Last 30 days"; 44px, active = bg-action), then a
 * calendar button for a custom range. With a custom range set, the button
 * shows it ("3 Oct – 12 Oct") and an × clears it. The calendar is a popover
 * with two months (md+, portalled with fixed positioning so nothing clips it)
 * or a bottom sheet with one month (phones). First tap = start, second = end
 * (swapped if earlier), hover previews the range, Apply / Clear at the bottom.
 * Values are ISO days (YYYY-MM-DD).
 *
 * Quick ranges are either derived from the dates (uncontrolled: a chip is on
 * when `value` equals its range today) or controlled with `preset` /
 * `onPresetChange`, for lists that keep "last 7 days" as a relative choice.
 * Tapping the active chip again turns it off (any date).
 *
 *   <DateRangePicker label="Date" value={{ from, to }} onChange={setRange} />
 *   <DateRangePicker label="Date" value={{ from, to }} onChange={setCustom}
 *     preset="last7" onPresetChange={setPreset} presetLabel={(p) => t(`inline.${p}`)} />
 */
export type { DateRange }

const CHIP =
  'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-[0.9375rem] leading-6 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const CHIP_OFF = 'border-border bg-background text-foreground hover:bg-hover'
const CHIP_ON = 'border-transparent bg-action text-action-foreground hover:opacity-90'
const BTN =
  'inline-flex h-11 items-center justify-center rounded-xl px-4 text-[0.9375rem] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 48rem)')
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return desktop
}

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
)

export function DateRangePicker({
  value,
  onChange,
  label,
  presets = ['last7', 'last30'],
  preset,
  onPresetChange,
  presetLabel,
  className = '',
}: {
  value: DateRange
  /** A custom range picked in the calendar (or cleared with ×). */
  onChange: (value: DateRange) => void
  label: string
  /** Quick ranges shown as toggle chips before the calendar button. */
  presets?: RangePreset[]
  /** Controlled quick range (with onPresetChange); null = none. Ignored while a custom range is set. */
  preset?: RangePreset | null
  onPresetChange?: (preset: RangePreset | null) => void
  /** Chip text; defaults to "Last 7 days" etc. */
  presetLabel?: (preset: RangePreset) => string
  className?: string
}) {
  const t = useTranslations('app.ui.dateRange')
  const locale = useLocale()
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogId = useId()

  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }), [locale])
  const fmtDay = useCallback(
    (iso: string) => {
      const p = parseISO(iso)
      return p ? fmt.format(new Date(p.y, p.m, p.d, 12)) : iso
    },
    [fmt]
  )

  const today = todayISO()
  const controlled = Boolean(onPresetChange)
  const activePreset = controlled
    ? value.from
      ? undefined
      : (preset ?? undefined)
    : value.from
      ? presets.find((p) => {
          const r = presetRange(p, today)
          return r.from === value.from && r.to === (value.to ?? value.from)
        })
      : undefined
  const custom = Boolean(value.from) && (controlled || !activePreset)
  const text = value.from
    ? value.to && value.to !== value.from
      ? `${fmtDay(value.from)} – ${fmtDay(value.to)}`
      : fmtDay(value.from)
    : ''

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])
  useAnchoredPopover({ open: open && desktop, anchorRef, panelRef, align: 'left', gap: 8, onDismiss: close })

  const panel = (
    <CalendarPanel
      initial={value}
      months={desktop ? 2 : 1}
      locale={locale}
      onApply={(r) => {
        onChange(r)
        close()
      }}
      onClear={() => {
        onChange({ from: null, to: null })
        close()
      }}
    />
  )

  return (
    <div role="group" aria-label={label} className={`flex flex-wrap items-center gap-2 ${className}`}>
      {presets.map((p) => {
        const on = activePreset === p
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onPresetChange ? onPresetChange(on ? null : p) : onChange(on ? { from: null, to: null } : presetRange(p, todayISO()))
            }
            className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
          >
            {presetLabel ? presetLabel(p) : t(p)}
          </button>
        )
      })}
      <div ref={anchorRef} className={`inline-flex h-11 shrink-0 items-stretch overflow-hidden rounded-xl border ${custom ? 'border-transparent bg-action text-action-foreground' : 'border-border bg-background text-foreground'}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={custom ? `${t('custom')}: ${text}` : t('custom')}
          title={custom ? undefined : t('custom')}
          onClick={(e) => {
            setTarget(portalTarget(e.currentTarget))
            setOpen((o) => !o)
          }}
          className={`inline-flex items-center gap-2 text-[0.9375rem] leading-6 whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset ${
            custom ? 'pr-1 pl-3 hover:opacity-90' : 'w-11 justify-center hover:bg-hover'
          }`}
        >
          <CalendarIcon />
          {custom ? <span>{text}</span> : null}
        </button>
        {custom ? (
          <button
            type="button"
            aria-label={t('clearRange')}
            onClick={() => onChange({ from: null, to: null })}
            className="grid w-10 place-items-center hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </div>
      {desktop ? (
        open && target
          ? createPortal(
              <div
                ref={panelRef}
                id={dialogId}
                role="dialog"
                aria-label={label}
                style={FLOATING_STYLE}
                className="z-50 w-max max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-raise)]"
              >
                {panel}
              </div>,
              target
            )
          : null
      ) : (
        <BottomSheet open={open} title={label} onClose={() => setOpen(false)}>
          {open && panel}
        </BottomSheet>
      )}
    </div>
  )
}

function CalendarPanel({
  initial,
  months,
  locale,
  onApply,
  onClear,
}: {
  initial: DateRange
  months: 1 | 2
  locale: string
  onApply: (r: DateRange) => void
  onClear: () => void
}) {
  const t = useTranslations('app.ui.dateRange')
  const today = useMemo(() => todayISO(), [])
  const weekStart = useMemo(() => weekStartForLocale(locale), [locale])
  const [draft, setDraft] = useState<DateRange>({ from: initial.from, to: initial.to })
  const [view, setView] = useState<YearMonth>(() => monthOf(initial.from ?? today) ?? { y: 2026, m: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [focus, setFocus] = useState<string>(initial.from ?? today)
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

  // Preview the range while hovering after the first tap (desktop).
  const previewTo = draft.from && !draft.to ? hover : draft.to

  const moveFocus = (iso: string) => {
    setFocus(iso)
    const p = parseISO(iso)!
    const first = shown[0]
    const last = shown[shown.length - 1]
    const idx = p.y * 12 + p.m
    if (idx < first.y * 12 + first.m) setView({ y: p.y, m: p.m })
    else if (idx > last.y * 12 + last.m) setView(addMonths({ y: p.y, m: p.m }, -(months - 1)))
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
      const off = (new Date(Date.UTC(parseISO(focus)!.y, parseISO(focus)!.m, parseISO(focus)!.d)).getUTCDay() - weekStart + 7) % 7
      moveFocus(addDays(focus, e.key === 'Home' ? -off : 6 - off))
    }
    // Enter / Space activate the focused day button natively.
  }

  const pick = (iso: string) => {
    setDraft((d) => pickDay(d, iso))
    setFocus(iso)
    setHover(null)
  }

  const NAV =
    'grid size-10 place-items-center rounded-full text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
  const arrow = (d: string) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
  // Every role="row" is its own seven-column grid (`grid grid-cols-7`, static
  // class names so Tailwind always generates them). The month is 17.5rem wide
  // in the two-month popover (seven 2.5rem columns) and the sheet's width on
  // phones. The cells must be direct children of the grid row: a wrapper in
  // between, or a column class Tailwind never generated (an interpolated
  // `grid-cols-[…${x}]`), leaves a one-column grid and the days stack.
  const ROW = 'grid grid-cols-7'
  const cellH = months === 2 ? 'h-10' : 'h-11'

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <p className="text-[0.9375rem] leading-6 text-foreground">{t('help')}</p>
      <div ref={gridRef} className="flex items-start gap-6" onMouseLeave={() => setHover(null)}>
        {shown.map((ym, i) => {
          const monthName = monthFmt.format(new Date(ym.y, ym.m, 1, 12))
          return (
            <div key={`${ym.y}-${ym.m}`} className={months === 2 ? 'w-[17.5rem] shrink-0' : 'w-full'}>
              <div className="mb-1 flex h-10 items-center justify-between gap-2">
                {i === 0 ? (
                  <button type="button" aria-label={t('prevMonth')} onClick={() => setView(addMonths(view, -1))} className={NAV}>
                    {arrow('m15 6-6 6 6 6')}
                  </button>
                ) : (
                  <span className="size-10" aria-hidden="true" />
                )}
                <h3 className="truncate text-[0.9375rem] font-semibold whitespace-nowrap first-letter:uppercase" aria-live="polite">
                  {monthName}
                </h3>
                {i === shown.length - 1 ? (
                  <button type="button" aria-label={t('nextMonth')} onClick={() => setView(addMonths(view, 1))} className={NAV}>
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
                {monthGrid(ym.y, ym.m, weekStart).map((week, wi) => (
                  <div key={wi} role="row" className={ROW}>
                    {week.map((c) => {
                      if (!c.inMonth) return <span key={c.iso} role="gridcell" aria-hidden="true" className={cellH} />
                      const lo = draft.from && previewTo ? (draft.from <= previewTo ? draft.from : previewTo) : draft.from
                      const hi = draft.from && previewTo ? (draft.from <= previewTo ? previewTo : draft.from) : draft.from
                      const inside = isInRange(c.iso, draft.from, previewTo)
                      const edge = c.iso === lo || c.iso === hi
                      const selected = c.iso === draft.from || (!!draft.to && c.iso === draft.to)
                      const span = inside && lo !== hi
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
                            tabIndex={c.iso === focus ? 0 : -1}
                            aria-label={dayFmt.format(new Date(parseISO(c.iso)!.y, parseISO(c.iso)!.m, c.day, 12))}
                            aria-current={c.iso === today ? 'date' : undefined}
                            onClick={() => pick(c.iso)}
                            onMouseEnter={() => setHover(c.iso)}
                            onFocus={() => setFocus(c.iso)}
                            className={`grid size-10 place-items-center rounded-full text-center text-[0.9375rem] tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
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

      <p className="min-h-6 text-[0.875rem] text-muted-foreground" aria-live="polite">
        {draft.from && !draft.to ? t('selectEnd') : ''}
      </p>

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClear} className={`${BTN} text-foreground hover:bg-hover`}>
          {t('clear')}
        </button>
        <button
          type="button"
          disabled={!draft.from}
          onClick={() => onApply({ from: draft.from, to: draft.to ?? draft.from })}
          className={`${BTN} bg-action text-action-foreground hover:opacity-90 disabled:opacity-50`}
        >
          {t('apply')}
        </button>
      </div>
    </div>
  )
}
