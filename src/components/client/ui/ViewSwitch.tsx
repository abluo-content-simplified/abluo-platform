'use client'

import type { ReactNode } from 'react'

export type ViewSwitchOption<V extends string> = { value: V; label: string; icon: ReactNode }

/**
 * Icon radio group for switching a list's view (List / Cards …). 2.75rem tall
 * so it sits centred beside the primary button in the PageHeader. Shown from
 * `md` up (phones have one view).
 *
 *   <ViewSwitch label="View" value={view} onChange={setView}
 *     options={[{ value: 'list', label: 'List', icon }, { value: 'cards', label: 'Cards', icon }]} />
 */
export function ViewSwitch<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: V
  onChange: (value: V) => void
  options: ViewSwitchOption<V>[]
}) {
  return (
    <div role="radiogroup" aria-label={label} className="hidden h-11 items-center gap-0.5 rounded-xl border border-border p-0.5 md:flex">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={`grid h-full w-10 place-items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
            value === o.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}
