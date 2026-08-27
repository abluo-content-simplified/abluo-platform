'use client'

import { useId, useState } from 'react'

/**
 * PasswordInput — a password field with a reveal toggle.
 *
 * Every password field on the platform goes through this component. Typing a
 * password blind is the main reason people mistype one, and the failure is
 * silent: the form just says the credentials are wrong. On a phone, where the
 * client dashboard is meant to be used, it is worse again.
 *
 * The toggle is a button rather than a checkbox so it can sit inside the field
 * without disturbing the layout, and it is `tabIndex={-1}` so tabbing runs
 * Email → Password → Submit as expected. It is still reachable by click and by
 * screen reader, which is what matters.
 *
 * The field reverts to hidden whenever it loses focus. Revealing a password is
 * for checking what you typed, not for leaving it on screen while you walk away
 * from a laptop.
 *
 * Props pass straight through to the underlying input, so autoComplete,
 * minLength, required and the rest behave exactly as they would on a plain
 * <input>. That matters for password managers: `autoComplete="current-password"`
 * and `"new-password"` are what tell them whether to fill or to offer a new one.
 */

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string
  /** Overridable for localisation; these are the only two strings here. */
  showLabel?: string
  hideLabel?: string
}

const FIELD_CLASS =
  'w-full rounded border border-zinc-200 bg-white px-3 py-2.5 pr-16 text-sm text-zinc-900 placeholder-zinc-300 outline-none transition-colors focus:border-zinc-400'

export function PasswordInput({
  label,
  showLabel = 'Show',
  hideLabel = 'Hide',
  className,
  onBlur,
  ...inputProps
}: Props) {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-zinc-600">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          {...inputProps}
          id={id}
          type={visible ? 'text' : 'password'}
          className={className ?? FIELD_CLASS}
          onBlur={(e) => {
            // Never leave a password on screen once the field is done with.
            setVisible(false)
            onBlur?.(e)
          }}
        />
        <button
          type="button"
          // Excluded from the tab order so it cannot sit between the password
          // field and the submit button.
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 px-3 text-[10px] font-medium uppercase tracking-widest text-zinc-400 transition-colors hover:text-zinc-600"
        >
          {visible ? hideLabel : showLabel}
        </button>
      </div>
    </div>
  )
}
