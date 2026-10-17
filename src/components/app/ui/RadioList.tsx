'use client'

import type { ReactNode } from 'react'

export type RadioOption<V extends string> = { value: V; label: ReactNode; description?: ReactNode; disabled?: boolean }

/**
 * One choice from a short list where each option needs a sentence of
 * explanation (a role, which site to connect). Bordered rows, the chosen one
 * with the action ring; native radios, so arrow keys and forms work.
 *
 *   <RadioList legend={t('role')} name="role" value={role} onChange={setRole}
 *     options={roles.map((r) => ({ value: r, label: roleLabel(r), description: t(`roleHelp.${r}`) }))} />
 *
 * Big icon tiles for a question are ChoiceCard; a few short inline options
 * are SegmentedControl.
 */
export function RadioList<V extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  className = '',
}: {
  legend: ReactNode
  name: string
  value: V | null
  onChange: (value: V) => void
  options: RadioOption<V>[]
  className?: string
}) {
  return (
    <fieldset className={`space-y-2 ${className}`}>
      <legend className="mb-2 text-[0.9375rem] font-medium text-foreground">{legend}</legend>
      {options.map((o) => {
        const on = value === o.value
        return (
          <label
            key={o.value}
            className={`flex min-h-12 items-start gap-3 rounded-xl border px-4 py-3 ${o.disabled ? 'opacity-50' : 'cursor-pointer'} ${on ? 'border-action ring-1 ring-action' : 'border-border'}`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="mt-0.5 size-5 shrink-0 accent-action focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-medium text-foreground">{o.label}</span>
              {o.description ? <span className="block text-sm text-muted-foreground">{o.description}</span> : null}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
