'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Calendar } from './Calendar'
import { inputClass } from './field-styles'
import { formatDateTime } from '@/lib/i18n/date-locale'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

/**
 * A calendar DAY (no time, no zone): a field that opens a sheet with the
 * shared Calendar and Done. The date-only sibling of DateTimePicker — use it
 * instead of a native <input type="date">.
 *
 * Values are ISO days (YYYY-MM-DD); '' / null = no date. `min` / `max`
 * (ISO days, inclusive) switch the days outside off. `clearable` adds a
 * "Clear" button to the sheet (onChange('')) for optional dates. `isDisabled`
 * switches single days off (only a class's days, no weekends …).
 *
 *   <Field label="Start">{(p) => <DatePicker {...p} value={day} onChange={setDay} />}</Field>
 */
const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted-foreground">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
)

export function DatePickerSheet({
  open,
  title,
  value,
  min,
  max,
  isDisabled,
  clearable = false,
  onDone,
  onClose,
}: {
  open: boolean
  title: string
  value: string | null
  min?: string
  max?: string
  isDisabled?: (day: string) => boolean
  clearable?: boolean
  onDone: (day: string) => void
  onClose: () => void
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {open ? <SheetBody value={value} min={min} max={max} isDisabled={isDisabled} clearable={clearable} onDone={onDone} /> : null}
    </BottomSheet>
  )
}

function SheetBody({ value, min, max, isDisabled, clearable, onDone }: { value: string | null; min?: string; max?: string; isDisabled?: (day: string) => boolean; clearable: boolean; onDone: (day: string) => void }) {
  const t = useTranslations('app.ui.datePicker')
  const [day, setDay] = useState<string | null>(value || null)
  return (
    <div className="flex flex-col gap-4">
      <Calendar mode="single" value={day} onChange={setDay} min={min} max={max} isDisabled={isDisabled} />
      <div className="flex flex-col gap-2">
        <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {day ? '' : t('pickDay')}
        </p>
        <Button variant="primary" size="lg" fullWidth disabled={!day} onClick={() => day && onDone(day)}>
          {t('done')}
        </Button>
        {clearable && value ? (
          <Button variant="secondary" size="lg" fullWidth onClick={() => onDone('')}>
            {t('clear')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  isDisabled,
  clearable,
  title,
  placeholder,
  disabled,
  invalid,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  className = '',
}: {
  id: string
  /** ISO day (YYYY-MM-DD); '' or null = no date. */
  value: string | null
  /** The chosen ISO day, or '' when cleared. */
  onChange: (day: string) => void
  min?: string
  max?: string
  /** Days that cannot be picked (a pure function of the ISO day), on top of min / max. */
  isDisabled?: (day: string) => boolean
  /** Optional date: the sheet offers "Clear". */
  clearable?: boolean
  /** The sheet's title (default "Pick a date"). */
  title?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  className?: string
}) {
  const t = useTranslations('app.ui.datePicker')
  const dateLocale = useDateLocale()
  const [open, setOpen] = useState(false)
  const parsed = value ? new Date(`${value}T00:00:00Z`) : null
  const text = parsed && !Number.isNaN(parsed.getTime()) ? formatDateTime(dateLocale, parsed, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
  const isInvalid = invalid || ariaInvalid === true || ariaInvalid === 'true'
  return (
    <div className={className}>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={inputClass({ className: `flex items-center justify-between gap-3 text-left ${isInvalid ? 'border-destructive' : ''}` })}
      >
        <span className={`truncate ${text ? '' : 'text-muted-foreground'}`}>{text || placeholder || t('placeholder')}</span>
        <CalendarIcon />
      </button>
      <DatePickerSheet
        open={open}
        title={title ?? t('placeholder')}
        value={value}
        min={min}
        max={max}
        isDisabled={isDisabled}
        clearable={clearable}
        onClose={() => setOpen(false)}
        onDone={(day) => {
          onChange(day)
          setOpen(false)
        }}
      />
    </div>
  )
}
