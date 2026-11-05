'use client'

import { useId, type ReactNode } from 'react'
import { FieldError, FieldLabel } from './FieldLabel'

export type FieldControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/**
 * One form field: label, the control, optional hint and error — with the ids
 * and aria wiring done once, here. The control is a render function so any
 * input works (TextInput, TextArea, Select, DateInput, a custom picker):
 *
 *   <Field label={t('name')} hint={t('nameHint')} error={errors.name}>
 *     {(p) => <TextInput {...p} value={name} onChange={…} />}
 *   </Field>
 *
 * `p` carries id, aria-describedby (hint + error) and aria-invalid.
 *
 * `hintBelow` puts the hint under the control instead of under the label — for
 * fields that sit side by side (a two-column form row, search + filter in a
 * toolbar), so every control starts right below its label and the inputs line
 * up. Required there: `field-alignment.test.ts` fails on a hinted Field in a
 * multi-column row without it (Tom, 2026-11-05).
 *
 * The label is a block, so a narrow control (a Select with a max width) still
 * starts on the line below it, never beside it.
 */
export function Field({
  label,
  hint,
  error,
  className = '',
  hintBelow = false,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  /** Render the hint under the control (side-by-side toolbar fields), not under the label. */
  hintBelow?: boolean
  error?: ReactNode
  className?: string
  children: (control: FieldControlProps) => ReactNode
}) {
  const base = useId()
  const id = `${base}-control`
  const hintId = hint ? `${base}-hint` : undefined
  const errorId = error ? `${base}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hintBelow ? undefined : hint} hintId={hintId} className="block">
        {label}
      </FieldLabel>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hintBelow && hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  )
}
