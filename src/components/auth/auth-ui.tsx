import type { ComponentProps, ReactNode } from 'react'
import { PasswordInput } from '@/components/ui/PasswordInput'

/**
 * The controls of the signed-out pages, in the Abluo App language.
 *
 * These are the same recipes the App already uses — the primary / secondary
 * buttons of `ConfirmDialog`, the field of `FilterBar` / the account forms —
 * gathered once so the five auth pages cannot drift apart. Tokens only (they
 * render inside `.abluo-app`), rem text, controls at `--control-height`
 * (44px) so they are comfortable to tap on a phone.
 *
 * Language-agnostic: every label and message is passed in by the page.
 */

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

/** A text field, also used by PasswordInput (`authInputClass` + room for the reveal toggle). */
export const authInputClass = `block min-h-[var(--control-height,44px)] w-full rounded-xl border border-input bg-background px-4 text-base text-foreground placeholder:text-muted-foreground transition-colors ${FOCUS}`

export const authLabelClass = 'mb-1.5 block text-sm font-medium text-foreground'

/** The reveal toggle inside PasswordInput. */
export const authToggleClass = `absolute inset-y-0 right-0 rounded-r-xl px-4 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground ${FOCUS}`

const BUTTON = `inline-flex min-h-12 w-full items-center justify-center rounded-xl px-5 text-[0.9375rem] font-semibold transition-colors disabled:opacity-60 ${FOCUS}`

/** Primary action — also for a Link that reads as a button. */
export const authPrimaryClass = `${BUTTON} bg-action text-action-foreground hover:opacity-90`

/** Secondary action. */
export const authSecondaryClass = `${BUTTON} border border-border text-foreground hover:bg-hover`

/** A quiet text link or link-styled button (Forgot password, Back to sign in, Sign out). */
export const authQuietLinkClass = `inline-flex min-h-6 items-center rounded-md text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline ${FOCUS}`

export function AuthField({
  id,
  label,
  className,
  ...inputProps
}: ComponentProps<'input'> & { id: string; label: string }) {
  return (
    <div>
      <label htmlFor={id} className={authLabelClass}>
        {label}
      </label>
      <input id={id} {...inputProps} className={className ? `${authInputClass} ${className}` : authInputClass} />
    </div>
  )
}

/** PasswordInput (reveal toggle, hides on blur) drawn in the App tokens. */
export function AuthPasswordInput(props: Omit<ComponentProps<typeof PasswordInput>, 'className' | 'labelClassName' | 'toggleClassName'>) {
  return <PasswordInput {...props} className={`${authInputClass} pr-20`} labelClassName={authLabelClass} toggleClassName={authToggleClass} />
}

/** An inline error under a form. Rendered only when there is one, as before. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  )
}

/** Muted helper copy inside the card. */
export function AuthNote({ children }: { children: ReactNode }) {
  return <p className="text-[0.9375rem] leading-6 text-muted-foreground">{children}</p>
}
