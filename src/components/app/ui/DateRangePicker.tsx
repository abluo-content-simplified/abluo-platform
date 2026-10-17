'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { createPortal } from 'react-dom'
import { BottomSheet } from './BottomSheet'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from './anchored-popover'
import { Button } from './Button'
import { Calendar } from './Calendar'
import { parseISO, presetRange, todayISO, type DateRange, type RangePreset } from '@/lib/client/date-range'

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

/** The range calendar plus its help line, "Now pick the end date" and Clear / Apply. */
function CalendarPanel({
  initial,
  months,
  onApply,
  onClear,
}: {
  initial: DateRange
  months: 1 | 2
  onApply: (r: DateRange) => void
  onClear: () => void
}) {
  const t = useTranslations('app.ui.dateRange')
  const [draft, setDraft] = useState<DateRange>({ from: initial.from, to: initial.to })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9375rem] leading-6 text-foreground">{t('help')}</p>
      <Calendar mode="range" value={draft} onChange={setDraft} months={months} />
      <p className="min-h-6 text-[0.875rem] text-muted-foreground" aria-live="polite">
        {draft.from && !draft.to ? t('selectEnd') : ''}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button variant="quiet" onClick={onClear}>
          {t('clear')}
        </Button>
        <Button variant="primary" disabled={!draft.from} onClick={() => onApply({ from: draft.from, to: draft.to ?? draft.from })}>
          {t('apply')}
        </Button>
      </div>
    </div>
  )
}
