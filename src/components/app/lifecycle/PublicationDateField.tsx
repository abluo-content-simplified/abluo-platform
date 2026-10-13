'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatInZone, fromLocalInput, offsetLabel, toLocalInput } from './zoned-time'

/**
 * ADR-032 slice 6 / D8 — one "Publish on" or "Unpublish on" field, entered in
 * the SITE's time zone (not the viewer's), with the zone named under it. A
 * time that does not exist (clocks go forward) moves to the next valid minute,
 * one that happens twice takes the first; either way the field says so.
 *
 * `value` / `onChange` speak UTC ISO; '' / null = no date.
 */
export function PublicationDateField({
  id,
  label,
  value,
  onChange,
  zone,
  className = '',
  inputClassName,
}: {
  id: string
  label: string
  value: string | null
  onChange: (utc: string | null) => void
  zone: string
  className?: string
  inputClassName?: string
}) {
  const t = useTranslations('app.lifecycle.dates')
  const locale = useLocale()
  // What the person typed (kept while incomplete); the UTC value is derived from it.
  const [text, setText] = useState(() => toLocalInput(value, zone))
  const [shownFor, setShownFor] = useState(value)
  // The offset shown before a date is chosen: the zone's offset when the field appeared.
  const [openedAt] = useState(() => Date.now())
  if (shownFor !== value && fromLocalInput(text, zone)?.utc !== value) {
    setShownFor(value)
    setText(toLocalInput(value, zone))
  }
  const parsed = fromLocalInput(text, zone)
  const city = zone.split('/').pop()?.replace(/_/g, ' ') ?? zone
  const at = parsed?.utc ?? value ?? openedAt
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[0.9375rem] font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const r = fromLocalInput(e.target.value, zone)
          setShownFor(r?.utc ?? null)
          onChange(r?.utc ?? null)
        }}
        aria-describedby={`${id}-zone`}
        className={
          inputClassName ??
          'mt-2 block min-h-[var(--control-height,56px)] w-full rounded-xl border border-border bg-background px-4 text-[1.0625rem] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
        }
      />
      <p id={`${id}-zone`} className="mt-2 text-sm text-muted-foreground">
        {parsed?.resolution === 'gap'
          ? t('gap', { date: formatInZone(parsed.utc, zone, locale) })
          : parsed?.resolution === 'overlap'
            ? t('overlap', { date: formatInZone(parsed.utc, zone, locale), offset: offsetLabel(parsed.utc, zone, locale) })
            : t('zone', { city, offset: offsetLabel(at, zone, locale) })}
      </p>
    </div>
  )
}
