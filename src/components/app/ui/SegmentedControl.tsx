'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { nextSegmentIndex, segmentClass, segmentedGroupClass, type SegmentedAppearance } from './segmented-keys'

export type SegmentedOption<V extends string> = { value: V; label: ReactNode; disabled?: boolean }

/**
 * One choice out of a few, shown inline (page tabs, filters). radiogroup
 * semantics with roving focus: Tab enters on the selected option, arrow keys
 * move AND select (wrapping), Home/End jump. `appearance`: solid = action
 * colour on the selected option (page tabs), soft = muted fill (filters).
 *
 *   <SegmentedControl label="View" value={view} onChange={setView}
 *     options={[{ value: 'items', label: 'Items' }, …]} />
 */
export function SegmentedControl<V extends string>({
  label,
  value,
  onChange,
  options,
  appearance = 'solid',
  className = '',
}: {
  label: string
  value: V
  onChange: (value: V) => void
  options: SegmentedOption<V>[]
  appearance?: SegmentedAppearance
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((o) => o.value === value)
  // Tab stop: the selected option, or the first enabled one when nothing matches.
  const stop = selected >= 0 && !options[selected].disabled ? selected : options.findIndex((o) => !o.disabled)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = refs.current.findIndex((b) => b === document.activeElement)
    if (current < 0) return
    const next = nextSegmentIndex(e.key, current, options.map((o) => !!o.disabled))
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={segmentedGroupClass(appearance, className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === stop ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={segmentClass(appearance, value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
