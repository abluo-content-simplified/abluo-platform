import type { ComponentProps, ReactNode } from 'react'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextInput } from '@/components/app/ui/TextInput'

/**
 * The controls of the signed-out pages, in the Abluo App language.
 *
 * Buttons and text fields come from the shared App components (Button,
 * TextInput, FieldLabel); what is gathered here is only what is specific to
 * these pages, so the five auth pages cannot drift apart. Tokens only (they
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

/** A quiet text link or link-styled button (Forgot password, Back to sign in, Sign out). */
export const authQuietLinkClass = `inline-flex min-h-6 items-center rounded-md text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline ${FOCUS}`

export function AuthField({
  id,
  label,
  ...inputProps
}: Omit<ComponentProps<typeof TextInput>, 'id' | 'className'> & { id: string; label: string }) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <TextInput id={id} {...inputProps} />
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
