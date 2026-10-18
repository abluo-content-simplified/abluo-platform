'use client'

/**
 * A one-time code entered as N single-digit boxes (default 6) with large digits.
 * (Moved here from components/auth so every surface can use it.)
 *
 * Behaves like one field for everything that matters:
 *   - typing a digit moves to the next box; Backspace on an empty box goes back;
 *     ← / → move between boxes;
 *   - pasting (or an autofill that drops the whole code into one box — iOS
 *     "From Messages", password managers) spreads the digits across the boxes;
 *   - `autoComplete="one-time-code"` sits on the first box so the OS offers it;
 *   - `onComplete` fires once all boxes are filled (the MFA page submits then).
 *
 * Language-agnostic: the group label and the per-box label are passed in
 * (`digitLabel` receives the 1-based position and the length).
 */

import { useRef } from 'react'
import { FieldLabel } from './FieldLabel'

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const BOX =
  `h-14 w-11 sm:h-16 sm:w-12 rounded-xl border border-input bg-background text-center ` +
  `font-mono text-2xl font-semibold tabular-nums text-foreground caret-transparent ` +
  `transition-colors focus:border-ring disabled:opacity-60 ${FOCUS}`

export interface CodeInputProps {
  id: string
  /** Visible label above the boxes. */
  label: string
  /** Accessible name of one box, e.g. (1, 6) → "Digit 1 of 6". */
  digitLabel: (position: number, length: number) => string
  value: string
  onChange: (value: string) => void
  /** Called with the full code when the last box is filled. */
  onComplete?: (value: string) => void
  length?: number
  disabled?: boolean
  autoFocus?: boolean
}

export function CodeInput({
  id, label, digitLabel, value, onChange, onComplete, length = 6, disabled, autoFocus,
}: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  // A cleared box in the middle stays a gap (a space) so later digits keep their place.
  const digits = Array.from({ length }, (_, i) => (value[i] ?? '').trim())
  const serialise = (arr: string[]) => arr.map((c) => c || ' ').join('').trimEnd()

  const focusBox = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))]
    el?.focus()
    el?.select()
  }

  /** Write `incoming` digits starting at box `start`; returns the new value. */
  const write = (start: number, incoming: string) => {
    const clean = incoming.replace(/\D/g, '')
    if (!clean) return
    const next = digits.slice()
    let i = start
    for (const ch of clean) {
      if (i >= length) break
      next[i++] = ch
    }
    const joined = serialise(next)
    onChange(joined)
    focusBox(Math.min(i, length - 1))
    if (/^\d+$/.test(joined) && joined.length === length) onComplete?.(joined)
  }

  return (
    <div>
      <FieldLabel id={`${id}-label`} htmlFor={`${id}-0`}>
        {label}
      </FieldLabel>
      <div role="group" aria-labelledby={`${id}-label`} className="flex justify-between gap-2 sm:justify-start sm:gap-3">
        {digits.map((d, i) => (
          <input
            key={i}
            id={`${id}-${i}`}
            ref={(el) => { refs.current[i] = el }}
            className={BOX}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            // Room for a whole pasted / autofilled code; each box keeps one digit.
            maxLength={i === 0 ? length : 1}
            aria-label={digitLabel(i + 1, length)}
            value={d}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '')
              if (!raw) {
                const next = digits.slice()
                next[i] = ''
                onChange(serialise(next))
                return
              }
              // A single keystroke replaces this box; more than one char is a paste/autofill.
              write(i, raw.length > 1 && d ? raw.replace(d, '') || raw : raw)
            }}
            onPaste={(e) => {
              e.preventDefault()
              write(i, e.clipboardData.getData('text'))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digits[i] && i > 0) {
                e.preventDefault()
                const next = digits.slice()
                next[i - 1] = ''
                onChange(serialise(next))
                focusBox(i - 1)
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                focusBox(i - 1)
              } else if (e.key === 'ArrowRight') {
                e.preventDefault()
                focusBox(i + 1)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}
