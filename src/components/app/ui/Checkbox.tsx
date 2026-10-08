'use client'

import { useEffect, useRef, type ChangeEvent } from 'react'
import { OVERLAY_CHIP } from './list/overlay-chip'

/**
 * Square checkbox for lists. A real `<input type="checkbox">` (so keyboard,
 * forms and screen readers just work) with a 1.25rem visual box inside a 44px
 * hit area. Supports a mixed ("select all") state. `variant="chip"`: the same
 * 1.25rem box inside a 2rem round overlay chip (card media controls).
 *
 *   <Checkbox checked={all} indeterminate={some && !all} aria-label="Select all"
 *     onChange={(checked, e) => toggle(checked, isShiftChange(e))} />
 */
export function isShiftChange(e: ChangeEvent<HTMLInputElement>): boolean {
  return Boolean((e.nativeEvent as MouseEvent).shiftKey)
}

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  variant = 'default',
  className = '',
}: {
  checked: boolean
  indeterminate?: boolean
  /** The change event is passed so callers can read shift-click via `isShiftChange(e)`. */
  onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void
  'aria-label': string
  disabled?: boolean
  variant?: 'default' | 'chip'
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  const on = checked || indeterminate
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${variant === 'chip' ? OVERLAY_CHIP : 'size-11'} ${className}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(e) => onChange(e.target.checked, e)}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none grid size-5 place-items-center rounded-[0.3rem] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50 ${
          on ? 'border-transparent bg-action text-action-foreground' : 'border-border bg-background'
        }`}
      >
        {indeterminate ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        ) : checked ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
      </span>
    </span>
  )
}
