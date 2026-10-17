'use client'

import { useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Calendar } from './Calendar'
import { Select } from './Select'
import { FieldLabel } from './FieldLabel'
import { inputClass } from './field-styles'
import { timeSteps } from '@/lib/client/date-range'
import { formatInZone, fromLocalInput, offsetLabel, toLocalInput } from '../lifecycle/zoned-time'

/**
 * A date + time, entered in a given time zone (the SITE's, ADR-032 D8).
 *
 *   DateTimePicker — the field: a button styled like a TextInput showing the
 *                    chosen moment ("3 Nov 2026, 09:00") or a placeholder;
 *                    tapping it opens the sheet.
 *   DateTimeSheet  — the sheet on its own, for screens that open it from
 *                    their own row or button (PublishChoice's "Change").
 *
 * The sheet holds the Calendar, a time list in 15-minute steps (09:00 by
 * default), the zone ("Rome time (GMT+1)") and Done. A time that does not
 * exist (clocks go forward) moves to the next valid minute, one that happens
 * twice takes the first; the sheet says so before Done. Days before `after`
 * (default: now) are switched off, and Done explains why it is off.
 *
 * Values are UTC ISO strings; null = no date.
 *
 *   <DateTimePicker id="end" value={iso} onChange={setIso} zone={zone} />
 *   <DateTimeSheet open={open} title="Goes live" value={iso} zone={zone} onDone={setIso} onClose={close} />
 */

const DEFAULT_TIME = '09:00'

/** "Rome time (GMT+1)" for a zone at a moment. */
function useZoneNote(zone: string) {
  const t = useTranslations('app.ui.dateTime')
  const locale = useLocale()
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone
  return (at: string | number) => t('zone', { city, offset: offsetLabel(at, zone, locale) })
}

export function DateTimeSheet({
  open,
  title,
  value,
  zone,
  after,
  onDone,
  onClose,
}: {
  open: boolean
  title: string
  value: string | null
  /** The IANA zone the date and time are entered in. */
  zone: string
  /** The moment must be later than this (UTC ISO); default: now. */
  after?: string | null
  onDone: (utc: string) => void
  onClose: () => void
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {open ? <SheetBody value={value} zone={zone} after={after} onDone={onDone} /> : null}
    </BottomSheet>
  )
}

function SheetBody({ value, zone, after, onDone }: { value: string | null; zone: string; after?: string | null; onDone: (utc: string) => void }) {
  const t = useTranslations('app.ui.dateTime')
  const locale = useLocale()
  const zoneNote = useZoneNote(zone)
  const timeId = useId()
  const initial = toLocalInput(value, zone)
  const [day, setDay] = useState<string | null>(initial ? initial.slice(0, 10) : null)
  const [time, setTime] = useState<string>(initial ? initial.slice(11, 16) : DEFAULT_TIME)
  const [openedAt] = useState(() => new Date().toISOString())
  const limit = after ?? openedAt
  const minDay = toLocalInput(limit, zone).slice(0, 10) || undefined
  const steps = useMemo(() => timeSteps(initial ? initial.slice(11, 16) : undefined), [initial])
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }), [locale])
  const parsed = day ? fromLocalInput(`${day}T${time}`, zone) : null
  const tooEarly = !!parsed && Date.parse(parsed.utc) <= Date.parse(limit)
  const reason = !day ? t('pickDay') : tooEarly ? (after ? t('mustBeAfter', { date: formatInZone(after, zone, locale) }) : t('mustBeFuture')) : null

  return (
    <div className="flex flex-col gap-4">
      <Calendar mode="single" value={day} onChange={setDay} min={minDay} />
      <div>
        <FieldLabel htmlFor={timeId}>{t('time')}</FieldLabel>
        <Select id={timeId} value={time} onChange={(e) => setTime(e.target.value)}>
          {steps.map((s) => (
            <option key={s} value={s}>
              {timeFmt.format(new Date(`2026-01-01T${s}:00Z`))}
            </option>
          ))}
        </Select>
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
          {parsed?.resolution === 'gap'
            ? t('gap', { date: formatInZone(parsed.utc, zone, locale) })
            : parsed?.resolution === 'overlap'
              ? t('overlap', { date: formatInZone(parsed.utc, zone, locale), offset: offsetLabel(parsed.utc, zone, locale) })
              : zoneNote(parsed?.utc ?? openedAt)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {reason}
        </p>
        <Button variant="primary" size="lg" fullWidth disabled={!parsed || tooEarly} onClick={() => parsed && onDone(parsed.utc)}>
          {t('done')}
        </Button>
      </div>
    </div>
  )
}

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
)

export function DateTimePicker({
  id,
  value,
  onChange,
  zone,
  after,
  title,
  placeholder,
  invalid,
  describedBy,
  showZone = true,
  className = '',
}: {
  id: string
  value: string | null
  onChange: (utc: string) => void
  zone: string
  /** The moment must be later than this (UTC ISO); default: now. */
  after?: string | null
  /** The sheet's title (default "Pick a date and time"). */
  title?: string
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  /** The zone note under the field (default on). */
  showZone?: boolean
  className?: string
}) {
  const t = useTranslations('app.ui.dateTime')
  const locale = useLocale()
  const zoneNote = useZoneNote(zone)
  const [open, setOpen] = useState(false)
  const [openedAt] = useState(() => Date.now())
  const text = formatInZone(value, zone, locale)
  return (
    <div className={className}>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-describedby={[showZone ? `${id}-zone` : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
        onClick={() => setOpen(true)}
        className={inputClass({ className: `flex items-center justify-between gap-3 text-left ${invalid ? 'border-destructive' : ''}` })}
      >
        <span className={`truncate ${text ? '' : 'text-muted-foreground'}`}>{text || placeholder || t('placeholder')}</span>
        <CalendarIcon />
      </button>
      {showZone ? (
        <p id={`${id}-zone`} className="mt-2 text-sm text-muted-foreground">
          {zoneNote(value ?? openedAt)}
        </p>
      ) : null}
      <DateTimeSheet
        open={open}
        title={title ?? t('placeholder')}
        value={value}
        zone={zone}
        after={after}
        onClose={() => setOpen(false)}
        onDone={(utc) => {
          onChange(utc)
          setOpen(false)
        }}
      />
    </div>
  )
}
