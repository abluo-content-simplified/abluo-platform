import type { ReactNode } from 'react'
import { LABEL_CLASS } from './field-styles'

/**
 * A form label. `as` picks the element: label (default, give it `htmlFor`),
 * legend (fieldset) or p (a group heading). `hint` renders quiet helper text
 * under it (give it `hintId` to wire aria-describedby). <FieldError> goes under
 * the control.
 */
export function FieldLabel({
  as = 'label',
  htmlFor,
  id,
  hint,
  hintId,
  className = '',
  children,
}: {
  as?: 'label' | 'legend' | 'p'
  htmlFor?: string
  id?: string
  hint?: ReactNode
  hintId?: string
  className?: string
  children: ReactNode
}) {
  const cls = className ? `${LABEL_CLASS} ${className}` : LABEL_CLASS
  const el =
    as === 'legend' ? (
      <legend id={id} className={cls}>
        {children}
      </legend>
    ) : as === 'p' ? (
      <p id={id} className={cls}>
        {children}
      </p>
    ) : (
      <label id={id} htmlFor={htmlFor} className={cls}>
        {children}
      </label>
    )
  if (!hint) return el
  return (
    <>
      {el}
      <p id={hintId} className="mt-0.5 text-sm text-muted-foreground">
        {hint}
      </p>
    </>
  )
}

/** The error slot under a control. role="alert" so it is announced. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">
      {children}
    </p>
  )
}
