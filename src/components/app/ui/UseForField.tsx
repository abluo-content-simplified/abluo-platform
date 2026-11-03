'use client'

import { useId } from 'react'
import { CheckboxCard } from './CheckboxCard'

export type UseForOption = { value: string; label: string }

/**
 * "Use for" (Catalogue D-22): which item types something applies to — square checkboxes, one per
 * type, plus "All item types". An EMPTY value means all types: ticking "All item types" clears the
 * others, and unticking the last type returns to "All item types" (never "none"). Pure UI and
 * language-agnostic: every text comes from the caller.
 *
 *   <UseForField legend={t('legend')} allLabel={t('all')} options={profiles} value={useFor} onChange={setUseFor} />
 */
export function UseForField({
  legend,
  hint,
  allLabel,
  options,
  value,
  onChange,
  disabledReason,
}: {
  legend: string
  hint?: string
  allLabel: string
  options: readonly UseForOption[]
  /** The chosen values in `options` order; [] = all item types. */
  value: readonly string[]
  onChange: (next: string[]) => void
  /** Shown above the boxes, which are then disabled (Tom's rule: a disabled control says why). */
  disabledReason?: string
}) {
  const id = useId()
  const disabled = !!disabledReason
  const set = new Set(value)
  const toggle = (v: string, on: boolean) => onChange(options.map((o) => o.value).filter((x) => (x === v ? on : set.has(x))))
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={hint || disabledReason ? `${id}-hint` : undefined}>
      <legend className="text-[0.9375rem] font-semibold text-foreground">{legend}</legend>
      {hint || disabledReason ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {disabledReason ?? hint}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxCard label={allLabel} checked={value.length === 0} disabled={disabled} onChange={(on) => on && onChange([])} />
        {options.map((o) => (
          <CheckboxCard key={o.value} label={o.label} checked={set.has(o.value)} disabled={disabled} onChange={(on) => toggle(o.value, on)} />
        ))}
      </div>
    </fieldset>
  )
}

/** The chips text of a value: the labels of the chosen types, or `allLabel` for []. */
export function labelsForUseFor(value: readonly string[], options: readonly UseForOption[], allLabel: string): string[] {
  if (!value.length) return [allLabel]
  return options.filter((o) => value.includes(o.value)).map((o) => o.label)
}
