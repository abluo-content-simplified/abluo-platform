'use client'

import { pillToneClass, type PillTone } from './list/cells'

export type PillSelectOption<V extends string> = { value: V; label: string; tone: PillTone }

/**
 * A status you can change in place that looks like its Pill (e.g. a contact
 * request's New / Handled / Archived). The module maps each status to a tone;
 * this only draws it. Native <select>, so phones show their own picker.
 * size sm = the 1.5rem pill (table cells), lg = a 44px control (panels, phones).
 */
export function PillSelect<V extends string>({
  label,
  value,
  onChange,
  options,
  size = 'sm',
}: {
  /** Accessible name, e.g. "Status: Anna". */
  label: string
  value: V
  onChange: (value: V) => void
  options: PillSelectOption<V>[]
  size?: 'sm' | 'lg'
}) {
  const tone = options.find((o) => o.value === value)?.tone ?? 'muted'
  const box = size === 'lg' ? 'h-11 rounded-xl pr-9 pl-3 text-[0.9375rem]' : 'h-6 rounded-full pr-7 pl-2.5 text-xs'
  const border = tone === 'outline' ? '' : 'border border-transparent'
  return (
    <label className="relative inline-flex shrink-0 items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className={`appearance-none font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${box} ${border} ${pillToneClass(tone)}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className={`pointer-events-none absolute ${size === 'lg' ? 'right-3' : 'right-2'}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </label>
  )
}
