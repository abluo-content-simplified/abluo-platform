'use client'

import { FieldLabel } from '../ui/FieldLabel'
import { DateTimePicker } from '../ui/DateTimePicker'

/**
 * ADR-032 slice 6 / D8 — one "Publish on" or "Unpublish on" field: a label
 * over the shared DateTimePicker, entered in the SITE's time zone (not the
 * viewer's), with the zone named under it. Clock changes are explained in the
 * picker before Done.
 *
 * `value` / `onChange` speak UTC ISO; null = no date.
 */
export function PublicationDateField({
  id,
  label,
  value,
  onChange,
  zone,
  after,
  className = '',
}: {
  id: string
  label: string
  value: string | null
  onChange: (utc: string | null) => void
  zone: string
  /** Must be later than this (UTC ISO); default: now. */
  after?: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DateTimePicker id={id} title={label} value={value} onChange={onChange} zone={zone} after={after} />
    </div>
  )
}
