'use client'

import { useRef, type KeyboardEvent } from 'react'
import { nextSegmentIndex } from './segmented-keys'

export type ColorSwatchOption = {
  value: string
  /** The accessible name ("Colour 3", "No colour"). */
  label: string
  /** A CSS colour or `var(--…)`; null = "no colour" (a slashed circle). */
  color: string | null
}

/**
 * Pick one colour among round swatches (a course's colour, a tag colour): a
 * WAI-ARIA radiogroup — arrows move and choose, Home / End jump — with a check
 * on the chosen swatch, 44px targets and the name of each colour for screen
 * readers and on hover. Colours come from the caller (e.g. derived from the
 * site's design system); the chosen colour's name is shown beside the swatches
 * so the choice never depends on seeing the colour.
 *
 *   <ColorSwatches label="Colour" value={color} onChange={setColor}
 *     options={[{ value: 'none', label: 'No colour', color: null }, { value: 'c1', label: 'Colour 1', color: 'var(--course-c1-dot)' }]} />
 */
export function ColorSwatches({
  label,
  value,
  onChange,
  options,
  disabled = false,
  showName = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly ColorSwatchOption[]
  disabled?: boolean
  /** Shows the chosen colour's name after the swatches (default on). */
  showName?: boolean
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const current = Math.max(0, options.findIndex((o) => o.value === value))
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const next = nextSegmentIndex(e.key, current, options.map(() => false))
    if (next === null) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  const chosen = options[current]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-0 sm:gap-1">
        {options.map((o, i) => {
          const on = i === current
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              title={o.label}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className="grid size-11 shrink-0 place-items-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
            >
              <span
                aria-hidden="true"
                className={`relative grid size-8 place-items-center rounded-full border transition-shadow duration-200 motion-reduce:transition-none ${on ? 'border-foreground ring-2 ring-foreground ring-offset-2 ring-offset-card' : 'border-border'}`}
                style={o.color ? { backgroundColor: o.color } : undefined}
              >
                {o.color === null ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="text-muted-foreground">
                    <path d="M5 19 19 5" />
                  </svg>
                ) : on ? (
                  <span className="grid size-4 place-items-center rounded-full bg-foreground text-background">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
      {showName && chosen ? <span className="text-sm leading-5 text-muted-foreground">{chosen.label}</span> : null}
    </div>
  )
}
